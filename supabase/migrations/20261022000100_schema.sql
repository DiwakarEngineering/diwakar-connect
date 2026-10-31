-- Diwakar Connect: core schema
-- Single-organization deployment. One Supabase project = one company.
--
-- Conversation model (see README "Data model"):
--   * Every message belongs to exactly one row in public.conversations.
--   * kind = 'direct' | 'group'  -> membership lives in public.conversation_members.
--   * kind = 'channel'           -> 1:1 with public.channels; access is derived from
--                                   team_members (+ channel_members for private channels).
--                                   conversation_members is never used for channels.
--   * Per-user read state / pin / mute for all kinds lives in public.conversation_user_state.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('owner', 'admin', 'manager', 'employee');
create type public.employment_status as enum ('invited', 'active', 'suspended', 'deactivated');
create type public.availability as enum ('available', 'busy', 'do_not_disturb', 'away', 'offline');
create type public.conversation_kind as enum ('direct', 'group', 'channel');
create type public.team_visibility as enum ('public', 'private');
create type public.channel_visibility as enum ('standard', 'private');
create type public.team_member_role as enum ('owner', 'member');
create type public.conversation_member_role as enum ('owner', 'member');
create type public.notification_kind as enum ('mention', 'reply', 'team_invite', 'call', 'system');
create type public.call_status as enum ('active', 'ended');
create type public.call_media as enum ('audio', 'video');
create type public.team_creation_policy as enum ('admins', 'managers', 'everyone');
create type public.message_kind as enum ('user', 'system');

-- ---------------------------------------------------------------------------
-- Shared trigger: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create table public.organization_settings (
  id boolean primary key default true check (id),
  organization_name text not null default 'Diwakar Solar'
    check (char_length(btrim(organization_name)) between 1 and 120),
  -- Lower-case domains such as 'diwakarsolar.com'. Empty = no restriction.
  -- Enforced in the database when auth users are created (see handle_new_auth_user).
  allowed_email_domains text[] not null default '{}',
  team_creation public.team_creation_policy not null default 'managers',
  directory_show_email boolean not null default true,
  directory_show_phone boolean not null default false,
  directory_show_work_location boolean not null default true,
  -- null = members may edit their messages at any time
  message_edit_window_minutes integer
    check (message_edit_window_minutes is null or message_edit_window_minutes between 1 and 10080),
  allow_message_delete boolean not null default true,
  max_attachment_mb integer not null default 25 check (max_attachment_mb between 1 and 50),
  calls_enabled boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.organization_settings (id) values (true);

create trigger organization_settings_updated_at
  before update on public.organization_settings
  for each row execute function public.set_updated_at();

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index departments_name_unique on public.departments (lower(name));

create trigger departments_updated_at
  before update on public.departments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
-- Columns every active member may read (names, titles, presence).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 300),
  title text check (title is null or char_length(title) <= 100),
  department_id uuid references public.departments (id) on delete set null,
  availability public.availability not null default 'available',
  status_message text check (status_message is null or char_length(status_message) <= 140),
  employment_status public.employment_status not null default 'invited',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_department_idx on public.profiles (department_id);
create index profiles_status_idx on public.profiles (employment_status);
create index profiles_display_name_idx on public.profiles (lower(display_name));

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Contact details. Readable by the person and admins; everyone else reads them
-- through search_directory(), which applies the organization's directory settings.
create table public.profile_details (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  email text not null,
  phone text check (phone is null or phone ~ '^[0-9+()\- ]{3,30}$'),
  work_location text check (work_location is null or char_length(work_location) <= 120),
  updated_at timestamptz not null default now()
);

create index profile_details_email_idx on public.profile_details (lower(email));

create trigger profile_details_updated_at
  before update on public.profile_details
  for each row execute function public.set_updated_at();

-- One organization-wide role per person. Written only by trusted server code.
create table public.user_roles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  role public.app_role not null default 'employee',
  assigned_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index user_roles_role_idx on public.user_roles (role);

create trigger user_roles_updated_at
  before update on public.user_roles
  for each row execute function public.set_updated_at();

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  mentions boolean not null default true,
  replies boolean not null default true,
  team_invites boolean not null default true,
  calls boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Teams and channels
-- ---------------------------------------------------------------------------
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  -- public  = discoverable and joinable by any active employee
  -- private = visible only to members (and admins, for management)
  visibility public.team_visibility not null default 'public',
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index teams_name_unique on public.teams (lower(name)) where archived_at is null;

create trigger teams_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.team_member_role not null default 'member',
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index team_members_user_idx on public.team_members (user_id);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 50),
  description text check (description is null or char_length(description) <= 300),
  -- standard = every team member; private = only rows in channel_members
  visibility public.channel_visibility not null default 'standard',
  is_general boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index channels_team_name_unique on public.channels (team_id, lower(name));
create unique index channels_one_general on public.channels (team_id) where is_general;

create trigger channels_updated_at
  before update on public.channels
  for each row execute function public.set_updated_at();

-- Only used for private channels.
create table public.channel_members (
  channel_id uuid not null references public.channels (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index channel_members_user_idx on public.channel_members (user_id);

-- ---------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind public.conversation_kind not null,
  title text check (title is null or char_length(btrim(title)) between 1 and 80),
  channel_id uuid unique references public.channels (id) on delete cascade,
  -- 'smaller-uuid:larger-uuid' for direct chats, guarantees one chat per pair
  direct_key text unique,
  created_by uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_channel_kind check ((kind = 'channel') = (channel_id is not null)),
  constraint conversations_direct_kind check ((kind = 'direct') = (direct_key is not null))
);

create index conversations_last_message_idx on public.conversations (last_message_at desc nulls last);

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

-- Membership for direct and group conversations only.
create table public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.conversation_member_role not null default 'member',
  added_by uuid references public.profiles (id) on delete set null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id)
);

create index conversation_members_user_idx on public.conversation_members (user_id) where left_at is null;

-- Per-user read marker, pin and mute for every conversation kind.
create table public.conversation_user_state (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz,
  is_pinned boolean not null default false,
  is_muted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index conversation_user_state_user_idx on public.conversation_user_state (user_id);

create trigger conversation_user_state_updated_at
  before update on public.conversation_user_state
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid references public.profiles (id) on delete set null,
  kind public.message_kind not null default 'user',
  body text not null default '' check (char_length(body) <= 8000),
  reply_to_id uuid references public.messages (id) on delete set null,
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 50),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  search tsvector generated always as (to_tsvector('simple', body)) stored
);

create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);
create index messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;
create index messages_sender_idx on public.messages (sender_id);
create index messages_search_idx on public.messages using gin (search);

create table public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index message_reactions_user_idx on public.message_reactions (user_id);

-- Files live in the private 'attachments' bucket at
--   <conversation_id>/<uploader_id>/<random>-<file name>
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  uploader_id uuid references public.profiles (id) on delete set null,
  object_path text not null unique check (char_length(object_path) <= 512),
  file_name text not null check (char_length(file_name) between 1 and 255),
  mime_type text not null check (char_length(mime_type) between 3 and 127),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  created_at timestamptz not null default now()
);

create index attachments_message_idx on public.attachments (message_id);
create index attachments_conversation_idx on public.attachments (conversation_id);

-- ---------------------------------------------------------------------------
-- Calls (metadata only - media is never recorded or stored)
-- ---------------------------------------------------------------------------
create table public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  started_by uuid references public.profiles (id) on delete set null,
  media public.call_media not null default 'video',
  status public.call_status not null default 'active',
  room_name text not null unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  constraint calls_ended_consistent check ((status = 'ended') = (ended_at is not null))
);

create unique index calls_one_active_per_conversation on public.calls (conversation_id) where status = 'active';
create index calls_started_idx on public.calls (started_at desc);

create table public.call_participants (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz
);

create index call_participants_call_idx on public.call_participants (call_id);
create index call_participants_user_idx on public.call_participants (user_id, joined_at desc);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  actor_id uuid references public.profiles (id) on delete set null,
  conversation_id uuid references public.conversations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  call_id uuid references public.calls (id) on delete cascade,
  title text not null check (char_length(title) <= 200),
  body text check (body is null or char_length(body) <= 280),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  -- No foreign key: audit history must outlive the people it describes.
  actor_id uuid,
  action text not null check (char_length(action) between 1 and 80),
  target_type text check (target_type is null or char_length(target_type) <= 40),
  target_id text check (target_id is null or char_length(target_id) <= 80),
  -- Never put passwords, tokens or message bodies in here.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_actor_action_idx on public.audit_logs (actor_id, action, created_at desc);
