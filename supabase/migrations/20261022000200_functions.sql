-- Diwakar Connect: authorization helpers, lifecycle triggers and guards.
--
-- Helpers named user_* take an explicit user id and are internal (execute revoked
-- from API roles). The argument-less wrappers act on auth.uid() and are what RLS
-- policies call.

-- ---------------------------------------------------------------------------
-- Session helpers
-- ---------------------------------------------------------------------------
-- True for trusted database roles (migrations, service_role server code, and
-- SECURITY DEFINER functions owned by postgres).
create or replace function public.is_privileged_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin', 'supabase_auth_admin');
$$;

create or replace function public.is_active_user(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.employment_status = 'active'
  );
$$;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user(auth.uid());
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.role
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
  where r.user_id = auth.uid() and p.employment_status = 'active';
$$;

create or replace function public.has_role(p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = any (p_roles), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(array['owner', 'admin']::public.app_role[]);
$$;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role(array['owner']::public.app_role[]);
$$;

create or replace function public.can_create_teams()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case s.team_creation
    when 'everyone' then public.is_active_member()
    when 'managers' then public.has_role(array['owner', 'admin', 'manager']::public.app_role[])
    else public.has_role(array['owner', 'admin']::public.app_role[])
  end
  from public.organization_settings s
  where s.id;
$$;

-- ---------------------------------------------------------------------------
-- Team / channel / conversation access
-- ---------------------------------------------------------------------------
create or replace function public.user_is_team_member(p_team uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team and tm.user_id = p_user
  );
$$;

create or replace function public.is_team_member(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member() and public.user_is_team_member(p_team, auth.uid());
$$;

-- Team owners manage their team; org owners/admins manage every team.
create or replace function public.can_manage_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (
      public.is_active_member()
      and exists (
        select 1 from public.team_members tm
        where tm.team_id = p_team and tm.user_id = auth.uid() and tm.role = 'owner'
      )
    );
$$;

create or replace function public.can_view_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or public.is_team_member(p_team)
    or (
      public.is_active_member()
      and exists (
        select 1 from public.teams t
        where t.id = p_team and t.visibility = 'public' and t.archived_at is null
      )
    );
$$;

create or replace function public.user_can_access_channel(p_channel uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.channels c
    where c.id = p_channel
      and public.user_is_team_member(c.team_id, p_user)
      and (
        c.visibility = 'standard'
        or exists (
          select 1 from public.channel_members cm
          where cm.channel_id = c.id and cm.user_id = p_user
        )
      )
  );
$$;

create or replace function public.can_access_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member() and public.user_can_access_channel(p_channel, auth.uid());
$$;

create or replace function public.user_can_access_conversation(p_conversation uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_user(p_user)
    and coalesce((
      select case c.kind
        when 'channel' then public.user_can_access_channel(c.channel_id, p_user)
        else exists (
          select 1 from public.conversation_members m
          where m.conversation_id = c.id and m.user_id = p_user and m.left_at is null
        )
      end
      from public.conversations c
      where c.id = p_conversation
    ), false);
$$;

create or replace function public.can_access_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_can_access_conversation(p_conversation, auth.uid());
$$;

-- Reading is allowed in archived teams/channels; posting is not.
create or replace function public.can_post_to_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_access_conversation(p_conversation)
    and not exists (
      select 1
      from public.conversations c
      join public.channels ch on ch.id = c.channel_id
      join public.teams t on t.id = ch.team_id
      where c.id = p_conversation
        and (ch.archived_at is not null or t.archived_at is not null)
    );
$$;

-- Short human label used in notification titles.
create or replace function public.conversation_label(p_conversation uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case c.kind
    when 'channel' then ' in #' || ch.name || ' (' || t.name || ')'
    when 'group' then coalesce(' in ' || c.title, ' in a group chat')
    else ' in a chat'
  end
  from public.conversations c
  left join public.channels ch on ch.id = c.channel_id
  left join public.teams t on t.id = ch.team_id
  where c.id = p_conversation;
$$;

-- ---------------------------------------------------------------------------
-- Audit helpers
-- ---------------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Generic row-change audit. Records which columns changed, never their values,
-- except for a few non-sensitive identifying fields (name, role, user_id).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  v_changed text[];
  v_meta jsonb := '{}'::jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(array_agg(k order by k), '{}')
      into v_changed
      from jsonb_object_keys(v_row) as k
      where k <> 'updated_at' and (v_row -> k) is distinct from (v_old -> k);
    if cardinality(v_changed) = 0 then
      return null;
    end if;
    v_meta := jsonb_build_object('changed', to_jsonb(v_changed));
  end if;

  if v_row ? 'name' then
    v_meta := v_meta || jsonb_build_object('name', v_row ->> 'name');
  end if;
  if v_row ? 'user_id' then
    v_meta := v_meta || jsonb_build_object('user_id', v_row ->> 'user_id');
  end if;
  if tg_table_name = 'team_members' then
    v_meta := v_meta || jsonb_build_object('role', v_row ->> 'role');
  end if;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (
    auth.uid(),
    tg_argv[0] || '.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
    tg_argv[0],
    coalesce(v_row ->> 'id', v_row ->> 'team_id', v_row ->> 'channel_id'),
    v_meta
  );
  return null;
end;
$$;

create or replace function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit log entries are append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_append_only
  before update or delete on public.audit_logs
  for each row execute function public.prevent_audit_mutation();

create trigger departments_audit
  after insert or update or delete on public.departments
  for each row execute function public.audit_row_change('department');

create trigger organization_settings_audit
  after update on public.organization_settings
  for each row execute function public.audit_row_change('organization_settings');

create trigger teams_audit
  after insert or update or delete on public.teams
  for each row execute function public.audit_row_change('team');

create trigger team_members_audit
  after insert or update or delete on public.team_members
  for each row execute function public.audit_row_change('team_member');

create trigger channels_audit
  after insert or update or delete on public.channels
  for each row execute function public.audit_row_change('channel');

create trigger channel_members_audit
  after insert or delete on public.channel_members
  for each row execute function public.audit_row_change('channel_member');

-- ---------------------------------------------------------------------------
-- Employee provisioning
-- ---------------------------------------------------------------------------
create or replace function public.provision_profile(
  p_user uuid,
  p_email text,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, employment_status)
  values (
    p_user,
    left(coalesce(nullif(btrim(p_display_name), ''), split_part(p_email, '@', 1)), 80),
    'invited'
  )
  on conflict (id) do nothing;

  insert into public.profile_details (user_id, email)
  values (p_user, lower(p_email))
  on conflict (user_id) do nothing;

  insert into public.user_roles (user_id, role)
  values (p_user, 'employee')
  on conflict (user_id) do nothing;

  insert into public.notification_preferences (user_id)
  values (p_user)
  on conflict (user_id) do nothing;
end;
$$;

-- Every auth user gets a profile in the 'invited' state. The email domain
-- allowlist is enforced here, so it also applies to the Supabase dashboard
-- and to any server code that creates users.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed text[];
  v_domain text;
begin
  if new.email is null then
    raise exception 'Diwakar Connect accounts require an email address' using errcode = '23514';
  end if;

  v_domain := lower(split_part(new.email, '@', 2));
  select s.allowed_email_domains into v_allowed from public.organization_settings s where s.id;

  if coalesce(cardinality(v_allowed), 0) > 0 and not (v_domain = any (v_allowed)) then
    raise exception 'Email domain % is not allowed for this organization', v_domain
      using errcode = '23514';
  end if;

  perform public.provision_profile(new.id, new.email, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.handle_auth_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profile_details set email = lower(new.email) where user_id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_auth_email_change();

-- Called by an invited person after they set their password from the invite link.
-- Only moves invited -> active; suspended or deactivated people stay blocked.
create or replace function public.activate_my_account()
returns public.employment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.employment_status;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  update public.profiles
     set employment_status = 'active'
   where id = auth.uid() and employment_status = 'invited';

  if found then
    perform public.write_audit('user.activated', 'user', auth.uid()::text, '{}'::jsonb);
  end if;

  select p.employment_status into v_status from public.profiles p where p.id = auth.uid();
  return v_status;
end;
$$;

-- One-time setup: promote the first person to organization owner.
-- Run from the Supabase SQL editor (not callable through the API).
create or replace function public.bootstrap_owner(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
begin
  if exists (select 1 from public.user_roles where role = 'owner') then
    raise exception 'An owner already exists. Use the admin console to change roles.';
  end if;

  select * into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user.id is null then
    raise exception 'No auth user with email %. Create the user in Supabase Auth first.', p_email;
  end if;

  perform public.provision_profile(v_user.id, v_user.email, v_user.raw_user_meta_data ->> 'display_name');
  update public.profiles set employment_status = 'active' where id = v_user.id;
  update public.user_roles set role = 'owner' where user_id = v_user.id;

  insert into public.audit_logs (actor_id, action, target_type, target_id)
  values (v_user.id, 'organization.owner_bootstrapped', 'user', v_user.id::text);

  return v_user.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile guards
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.employment_status is distinct from old.employment_status
     or new.created_at is distinct from old.created_at then
    raise exception 'Employment status can only be changed from the admin console' using errcode = '42501';
  end if;

  if old.id = auth.uid() then
    if not public.is_admin()
       and (new.title is distinct from old.title or new.department_id is distinct from old.department_id) then
      raise exception 'Only administrators can change job title and department' using errcode = '42501';
    end if;
    if new.avatar_path is not null
       and new.avatar_path is distinct from old.avatar_path
       and new.avatar_path not like old.id::text || '/%' then
      raise exception 'Avatar must be stored in your own folder' using errcode = '42501';
    end if;
  else
    if not public.is_admin() then
      raise exception 'You can only edit your own profile' using errcode = '42501';
    end if;
    if new.availability is distinct from old.availability
       or new.status_message is distinct from old.status_message
       or new.avatar_path is distinct from old.avatar_path
       or new.last_seen_at is distinct from old.last_seen_at then
      raise exception 'Administrators can only edit name, title and department for other people'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_update();

create or replace function public.guard_profile_details_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.email is distinct from old.email then
    raise exception 'Email is managed by your sign-in account' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profile_details_guard
  before update on public.profile_details
  for each row execute function public.guard_profile_details_update();

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and employment_status = 'active';
$$;

-- ---------------------------------------------------------------------------
-- Teams and channels
-- ---------------------------------------------------------------------------
create or replace function public.before_team_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  new.archived_at := null;
  return new;
end;
$$;

create trigger teams_before_insert
  before insert on public.teams
  for each row execute function public.before_team_insert();

-- New team: creator becomes owner, and a General channel is created.
create or replace function public.after_team_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is not null then
    insert into public.team_members (team_id, user_id, role, added_by)
    values (new.id, new.created_by, 'owner', new.created_by)
    on conflict do nothing;
  end if;

  insert into public.channels (team_id, name, description, visibility, is_general, created_by)
  values (new.id, 'General', 'Team-wide announcements and discussion', 'standard', true, new.created_by);

  return null;
end;
$$;

create trigger teams_after_insert
  after insert on public.teams
  for each row execute function public.after_team_insert();

create or replace function public.before_team_member_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.added_by := auth.uid();
    end if;
    if not public.is_active_user(new.user_id) then
      raise exception 'Only active employees can be added to a team' using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and (new.team_id is distinct from old.team_id or new.user_id is distinct from old.user_id) then
    raise exception 'Team membership keys cannot be changed' using errcode = '42501';
  end if;

  -- Keep at least one owner while the team exists (cascading deletes are exempt).
  if exists (select 1 from public.teams t where t.id = old.team_id)
     and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from public.team_members tm
       where tm.team_id = old.team_id and tm.role = 'owner' and tm.user_id <> old.user_id
     ) then
    raise exception 'A team needs at least one owner. Make someone else an owner first.' using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger team_members_before_write
  before insert or update or delete on public.team_members
  for each row execute function public.before_team_member_write();

create or replace function public.after_team_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team_name text;
  v_actor_name text;
begin
  if tg_op = 'DELETE' then
    -- Leaving a team also removes private channel access within it.
    delete from public.channel_members cm
     using public.channels c
     where cm.channel_id = c.id and c.team_id = old.team_id and cm.user_id = old.user_id;
    return null;
  end if;

  if new.added_by is not null and new.added_by <> new.user_id
     and exists (select 1 from public.notification_preferences np where np.user_id = new.user_id and np.team_invites) then
    select t.name into v_team_name from public.teams t where t.id = new.team_id;
    select p.display_name into v_actor_name from public.profiles p where p.id = new.added_by;
    insert into public.notifications (user_id, kind, actor_id, team_id, title)
    values (new.user_id, 'team_invite', new.added_by, new.team_id,
            left(coalesce(v_actor_name, 'Someone') || ' added you to ' || coalesce(v_team_name, 'a team'), 200));
  end if;
  return null;
end;
$$;

create trigger team_members_after_change
  after insert or delete on public.team_members
  for each row execute function public.after_team_member_change();

create or replace function public.before_channel_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    -- Only the trigger that creates a team may create its General channel.
    if new.is_general and not public.is_privileged_session() then
      raise exception 'General channels are created automatically' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id or new.is_general is distinct from old.is_general
       or new.created_by is distinct from old.created_by then
      raise exception 'Channel team and type cannot be changed' using errcode = '42501';
    end if;
    if old.is_general and (new.visibility <> 'standard' or new.archived_at is not null) then
      raise exception 'The General channel cannot be made private or archived' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.is_general and exists (select 1 from public.teams t where t.id = old.team_id) then
    raise exception 'The General channel cannot be deleted' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger channels_before_write
  before insert or update or delete on public.channels
  for each row execute function public.before_channel_write();

create or replace function public.after_channel_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conversations (kind, channel_id, created_by)
  values ('channel', new.id, new.created_by);

  if new.visibility = 'private' and new.created_by is not null then
    insert into public.channel_members (channel_id, user_id, added_by)
    values (new.id, new.created_by, new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger channels_after_insert
  after insert on public.channels
  for each row execute function public.after_channel_insert();

create or replace function public.before_channel_member_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channel public.channels%rowtype;
begin
  select * into v_channel from public.channels c where c.id = new.channel_id;
  if v_channel.visibility <> 'private' then
    raise exception 'Membership lists are only used for private channels' using errcode = '23514';
  end if;
  if not public.user_is_team_member(v_channel.team_id, new.user_id) then
    raise exception 'Add the person to the team before adding them to a private channel' using errcode = '23514';
  end if;
  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger channel_members_before_insert
  before insert on public.channel_members
  for each row execute function public.before_channel_member_insert();

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create or replace function public.guard_conversation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if new.kind is distinct from old.kind
     or new.channel_id is distinct from old.channel_id
     or new.direct_key is distinct from old.direct_key
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.last_message_at is distinct from old.last_message_at then
    raise exception 'Only the group name can be changed' using errcode = '42501';
  end if;
  if old.kind <> 'group' and new.title is distinct from old.title then
    raise exception 'Only group chats have editable names' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger conversations_guard
  before update on public.conversations
  for each row execute function public.guard_conversation_update();

create or replace function public.post_system_message(p_conversation uuid, p_sender uuid, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.messages (conversation_id, sender_id, kind, body)
  values (p_conversation, p_sender, 'system', left(p_body, 8000));
$$;

create or replace function public.get_or_create_direct_conversation(p_other_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_key text;
  v_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  if p_other_user is null or not public.is_active_user(p_other_user) then
    raise exception 'That person is not available to chat' using errcode = '22023';
  end if;

  v_key := least(v_me::text, p_other_user::text) || ':' || greatest(v_me::text, p_other_user::text);

  select c.id into v_id from public.conversations c where c.direct_key = v_key;
  if v_id is null then
    insert into public.conversations (kind, direct_key, created_by)
    values ('direct', v_key, v_me)
    on conflict (direct_key) do nothing
    returning id into v_id;

    if v_id is null then
      select c.id into v_id from public.conversations c where c.direct_key = v_key;
    end if;
  end if;

  insert into public.conversation_members (conversation_id, user_id, added_by)
  select v_id, u, v_me from (select distinct unnest(array[v_me, p_other_user]) as u) s
  on conflict (conversation_id, user_id) do update set left_at = null;

  return v_id;
end;
$$;

create or replace function public.create_group_conversation(p_member_ids uuid[], p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_members uuid[];
  v_id uuid;
  v_title text := nullif(btrim(p_title), '');
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_members
    from unnest(coalesce(p_member_ids, '{}')) as m
   where m <> v_me;

  if cardinality(v_members) < 1 then
    raise exception 'Choose at least one other person' using errcode = '22023';
  end if;
  if cardinality(v_members) > 99 then
    raise exception 'Group chats are limited to 100 people' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_members) m where not public.is_active_user(m)) then
    raise exception 'Some selected people are not active employees' using errcode = '22023';
  end if;

  insert into public.conversations (kind, title, created_by)
  values ('group', left(v_title, 80), v_me)
  returning id into v_id;

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  values (v_id, v_me, 'owner', v_me);

  insert into public.conversation_members (conversation_id, user_id, role, added_by)
  select v_id, m, 'member', v_me from unnest(v_members) m;

  perform public.post_system_message(v_id, v_me, 'created the group');
  return v_id;
end;
$$;

create or replace function public.add_conversation_members(p_conversation_id uuid, p_member_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_new uuid[];
  v_names text;
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and c.kind = 'group'
  ) or not public.can_access_conversation(p_conversation_id) then
    raise exception 'You can only add people to group chats you belong to' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_new
    from unnest(coalesce(p_member_ids, '{}')) as m
   where public.is_active_user(m)
     and not exists (
       select 1 from public.conversation_members cm
       where cm.conversation_id = p_conversation_id and cm.user_id = m and cm.left_at is null
     );

  if cardinality(v_new) = 0 then
    return 0;
  end if;

  if (select count(*) from public.conversation_members cm
       where cm.conversation_id = p_conversation_id and cm.left_at is null) + cardinality(v_new) > 100 then
    raise exception 'Group chats are limited to 100 people' using errcode = '22023';
  end if;

  insert into public.conversation_members (conversation_id, user_id, role, added_by, joined_at, left_at)
  select p_conversation_id, m, 'member', v_me, now(), null from unnest(v_new) m
  on conflict (conversation_id, user_id) do update
    set left_at = null, joined_at = now(), added_by = excluded.added_by, role = 'member';

  select string_agg(p.display_name, ', ' order by p.display_name) into v_names
    from public.profiles p where p.id = any (v_new);
  perform public.post_system_message(p_conversation_id, v_me, 'added ' || v_names);

  return cardinality(v_new);
end;
$$;

create or replace function public.remove_conversation_member(p_conversation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_name text;
begin
  if not exists (
    select 1 from public.conversations c where c.id = p_conversation_id and c.kind = 'group'
  ) or not public.can_access_conversation(p_conversation_id) then
    raise exception 'Only members of a group chat can change it' using errcode = '42501';
  end if;

  if p_user_id <> v_me and not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.user_id = v_me
      and cm.role = 'owner' and cm.left_at is null
  ) then
    raise exception 'Only the group owner can remove other people' using errcode = '42501';
  end if;

  update public.conversation_members
     set left_at = now()
   where conversation_id = p_conversation_id and user_id = p_user_id and left_at is null;

  if not found then
    return;
  end if;

  -- Make sure the group keeps an owner.
  if not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation_id and cm.role = 'owner' and cm.left_at is null
  ) then
    update public.conversation_members
       set role = 'owner'
     where (conversation_id, user_id) = (
       select cm.conversation_id, cm.user_id from public.conversation_members cm
       where cm.conversation_id = p_conversation_id and cm.left_at is null
       order by cm.joined_at limit 1
     );
  end if;

  if p_user_id = v_me then
    perform public.post_system_message(p_conversation_id, v_me, 'left the chat');
  else
    select p.display_name into v_name from public.profiles p where p.id = p_user_id;
    perform public.post_system_message(p_conversation_id, v_me, 'removed ' || coalesce(v_name, 'a member'));
  end if;
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, last_read_at)
  values (p_conversation_id, auth.uid(), now())
  on conflict (conversation_id, user_id)
  do update set last_read_at = greatest(coalesce(public.conversation_user_state.last_read_at, excluded.last_read_at), excluded.last_read_at);
end;
$$;

create or replace function public.set_conversation_preferences(
  p_conversation_id uuid,
  p_is_pinned boolean default null,
  p_is_muted boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, is_pinned, is_muted)
  values (p_conversation_id, auth.uid(), coalesce(p_is_pinned, false), coalesce(p_is_muted, false))
  on conflict (conversation_id, user_id)
  do update set
    is_pinned = coalesce(p_is_pinned, public.conversation_user_state.is_pinned),
    is_muted = coalesce(p_is_muted, public.conversation_user_state.is_muted);
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create or replace function public.before_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.deleted_by := null;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'Replies must reference a message in the same conversation' using errcode = '23514';
  end if;

  select coalesce(array_agg(distinct u), '{}') into new.mentions
    from unnest(new.mentions) as u
   where u is not null;

  return new;
end;
$$;

create trigger messages_before_insert
  before insert on public.messages
  for each row execute function public.before_message_insert();

create or replace function public.after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender_name text;
  v_context text;
  v_parent_sender uuid;
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id
     and (last_message_at is null or last_message_at < new.created_at);

  if new.sender_id is not null and new.kind = 'user' then
    insert into public.conversation_user_state (conversation_id, user_id, last_read_at)
    values (new.conversation_id, new.sender_id, new.created_at)
    on conflict (conversation_id, user_id)
    do update set last_read_at = greatest(coalesce(public.conversation_user_state.last_read_at, excluded.last_read_at), excluded.last_read_at);
  end if;

  if new.kind <> 'user' then
    return null;
  end if;

  select p.display_name into v_sender_name from public.profiles p where p.id = new.sender_id;
  v_sender_name := coalesce(v_sender_name, 'Someone');
  v_context := coalesce(public.conversation_label(new.conversation_id), '');

  insert into public.notifications (user_id, kind, actor_id, conversation_id, message_id, title, body)
  select u, 'mention', new.sender_id, new.conversation_id, new.id,
         left(v_sender_name || ' mentioned you' || v_context, 200),
         nullif(left(new.body, 280), '')
    from unnest(new.mentions) as u
    join public.notification_preferences np on np.user_id = u and np.mentions
   where u is distinct from new.sender_id
     and public.user_can_access_conversation(new.conversation_id, u);

  if new.reply_to_id is not null then
    select m.sender_id into v_parent_sender from public.messages m where m.id = new.reply_to_id;
    if v_parent_sender is not null
       and v_parent_sender is distinct from new.sender_id
       and not (v_parent_sender = any (new.mentions))
       and exists (select 1 from public.notification_preferences np where np.user_id = v_parent_sender and np.replies)
       and public.user_can_access_conversation(new.conversation_id, v_parent_sender) then
      insert into public.notifications (user_id, kind, actor_id, conversation_id, message_id, title, body)
      values (v_parent_sender, 'reply', new.sender_id, new.conversation_id, new.id,
              left(v_sender_name || ' replied to you' || v_context, 200),
              nullif(left(new.body, 280), ''));
    end if;
  end if;

  return null;
end;
$$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.after_message_insert();

-- Senders may edit (within the configured window) and soft-delete their own
-- messages. Owners/admins may soft-delete (moderate) any message they can see;
-- moderation is audited. Nobody can edit someone else's text.
create or replace function public.guard_message_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_window integer;
  v_allow_delete boolean;
begin
  if public.is_privileged_session() then
    return new;
  end if;

  if old.deleted_at is not null then
    raise exception 'Deleted messages cannot be changed' using errcode = '42501';
  end if;
  if old.kind <> 'user' then
    raise exception 'System messages cannot be changed' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.sender_id is distinct from old.sender_id
     or new.kind is distinct from old.kind
     or new.reply_to_id is distinct from old.reply_to_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the message text can be changed' using errcode = '42501';
  end if;

  select s.message_edit_window_minutes, s.allow_message_delete
    into v_window, v_allow_delete
    from public.organization_settings s where s.id;

  if new.deleted_at is not null then
    if old.sender_id = auth.uid() then
      if not coalesce(v_allow_delete, true) and not public.is_admin() then
        raise exception 'Deleting messages is turned off for this organization' using errcode = '42501';
      end if;
    elsif not public.is_admin() then
      raise exception 'You can only delete your own messages' using errcode = '42501';
    end if;
    new.deleted_at := now();
    new.deleted_by := auth.uid();
    new.body := '';
    new.mentions := '{}';
    new.edited_at := old.edited_at;
    return new;
  end if;

  if old.sender_id is distinct from auth.uid() then
    raise exception 'You can only edit your own messages' using errcode = '42501';
  end if;
  if new.deleted_by is distinct from old.deleted_by then
    raise exception 'Invalid change' using errcode = '42501';
  end if;
  if v_window is not null and now() > old.created_at + make_interval(mins => v_window) then
    raise exception 'Messages can only be edited for % minutes after sending', v_window using errcode = '42501';
  end if;
  if char_length(btrim(new.body)) = 0 then
    raise exception 'A message cannot be empty. Delete it instead.' using errcode = '23514';
  end if;

  if new.body is distinct from old.body or new.mentions is distinct from old.mentions then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

create trigger messages_guard
  before update on public.messages
  for each row execute function public.guard_message_update();

create or replace function public.after_message_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.attachments where message_id = new.id;
    delete from public.message_reactions where message_id = new.id;
    delete from public.notifications where message_id = new.id;
    if new.deleted_by is distinct from new.sender_id then
      insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
      values (new.deleted_by, 'message.moderated_delete', 'message', new.id::text,
              jsonb_build_object('conversation_id', new.conversation_id, 'sender_id', new.sender_id));
    end if;
  end if;
  return null;
end;
$$;

create trigger messages_after_update
  after update on public.messages
  for each row execute function public.after_message_update();

create or replace function public.before_reaction_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  new.emoji := btrim(new.emoji);
  return new;
end;
$$;

create trigger message_reactions_before_insert
  before insert on public.message_reactions
  for each row execute function public.before_reaction_insert();

create or replace function public.before_attachment_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.messages%rowtype;
  v_max_mb integer;
begin
  select * into v_message from public.messages m where m.id = new.message_id;
  if v_message.id is null or v_message.conversation_id <> new.conversation_id then
    raise exception 'Attachment must belong to a message in the same conversation' using errcode = '23514';
  end if;
  if not public.is_privileged_session() then
    if v_message.sender_id is distinct from auth.uid() then
      raise exception 'You can only attach files to your own messages' using errcode = '42501';
    end if;
    if v_message.deleted_at is not null or v_message.created_at < now() - interval '15 minutes' then
      raise exception 'Files can only be attached while sending a message' using errcode = '42501';
    end if;
    new.uploader_id := auth.uid();
  end if;

  select s.max_attachment_mb into v_max_mb from public.organization_settings s where s.id;
  if new.size_bytes > coalesce(v_max_mb, 25)::bigint * 1024 * 1024 then
    raise exception 'Files must be smaller than % MB', coalesce(v_max_mb, 25) using errcode = '23514';
  end if;
  if new.object_path not like new.conversation_id::text || '/' || coalesce(new.uploader_id::text, '') || '/%' then
    raise exception 'Attachment path does not match the conversation' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger attachments_before_insert
  before insert on public.attachments
  for each row execute function public.before_attachment_insert();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function public.guard_notification_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() then
    return new;
  end if;
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Only the read state of a notification can change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard
  before update on public.notifications
  for each row execute function public.guard_notification_update();

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications set read_at = now()
   where user_id = auth.uid() and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calls: rows are written by the trusted call-token endpoint (service role).
-- ---------------------------------------------------------------------------
create or replace function public.after_call_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_kind public.conversation_kind;
  v_minutes integer;
begin
  select c.kind into v_kind from public.conversations c where c.id = new.conversation_id;

  if tg_op = 'INSERT' then
    select p.display_name into v_name from public.profiles p where p.id = new.started_by;
    perform public.post_system_message(new.conversation_id, new.started_by,
      'started ' || case new.media when 'audio' then 'an audio call' else 'a video call' end);

    if v_kind in ('direct', 'group') then
      insert into public.notifications (user_id, kind, actor_id, conversation_id, call_id, title)
      select cm.user_id, 'call', new.started_by, new.conversation_id, new.id,
             left(coalesce(v_name, 'Someone') || ' started '
               || case new.media when 'audio' then 'an audio call' else 'a video call' end
               || coalesce(public.conversation_label(new.conversation_id), ''), 200)
        from public.conversation_members cm
        join public.notification_preferences np on np.user_id = cm.user_id and np.calls
       where cm.conversation_id = new.conversation_id
         and cm.left_at is null
         and cm.user_id is distinct from new.started_by;
    end if;
    return null;
  end if;

  if new.status = 'ended' and old.status = 'active' then
    v_minutes := greatest(1, ceil(extract(epoch from (new.ended_at - new.started_at)) / 60.0)::integer);
    perform public.post_system_message(new.conversation_id, null,
      'Call ended · ' || v_minutes || case when v_minutes = 1 then ' minute' else ' minutes' end);
  end if;
  return null;
end;
$$;

create trigger calls_after_change
  after insert or update on public.calls
  for each row execute function public.after_call_change();
