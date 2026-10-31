-- Diwakar Connect: Row Level Security and read RPCs.
-- Every table with user or company data has RLS enabled. Anything without a
-- policy for an operation is denied to API roles; trusted server code uses the
-- service_role key, which bypasses RLS.

alter table public.organization_settings enable row level security;
alter table public.departments enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_details enable row level security;
alter table public.user_roles enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.channels enable row level security;
alter table public.channel_members enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.conversation_user_state enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.attachments enable row level security;
alter table public.calls enable row level security;
alter table public.call_participants enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------------
-- Organization
-- ---------------------------------------------------------------------------
create policy "Active members read organization settings"
  on public.organization_settings for select to authenticated
  using (public.is_active_member());

create policy "Admins update organization settings"
  on public.organization_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Active members read departments"
  on public.departments for select to authenticated
  using (public.is_active_member());

create policy "Admins create departments"
  on public.departments for insert to authenticated
  with check (public.is_admin());

create policy "Admins update departments"
  on public.departments for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete departments"
  on public.departments for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
-- Everyone can always read their own row (so the app can explain an invited or
-- suspended state); active members can read everyone's public profile columns.
create policy "Read own profile or any profile when active"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_active_member());

-- Field-level rules are enforced by the profiles_guard trigger.
create policy "Update own profile, or any profile as admin"
  on public.profiles for update to authenticated
  using ((id = (select auth.uid()) and public.is_active_member()) or public.is_admin())
  with check ((id = (select auth.uid()) and public.is_active_member()) or public.is_admin());

create policy "Read own contact details or as admin"
  on public.profile_details for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create policy "Update own contact details or as admin"
  on public.profile_details for update to authenticated
  using ((user_id = (select auth.uid()) and public.is_active_member()) or public.is_admin())
  with check ((user_id = (select auth.uid()) and public.is_active_member()) or public.is_admin());

create policy "Read own role or any role when active"
  on public.user_roles for select to authenticated
  using (user_id = (select auth.uid()) or public.is_active_member());
-- No write policies: role changes go through the admin API (service role).

create policy "Read own notification preferences"
  on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Update own notification preferences"
  on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()) and public.is_active_member())
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Teams and channels
-- ---------------------------------------------------------------------------
-- Column checks are inlined (rather than calling can_view_team) so a row is
-- visible within the statement that inserts it.
create policy "View public teams and teams you belong to"
  on public.teams for select to authenticated
  using (
    (visibility = 'public' and archived_at is null and public.is_active_member())
    or public.is_admin()
    or public.is_team_member(id)
  );

create policy "Create teams when the organization allows it"
  on public.teams for insert to authenticated
  with check (public.can_create_teams() and created_by = (select auth.uid()));

create policy "Team owners and admins update teams"
  on public.teams for update to authenticated
  using (public.can_manage_team(id))
  with check (public.can_manage_team(id));

create policy "Admins delete teams"
  on public.teams for delete to authenticated
  using (public.is_admin());

create policy "View members of visible teams"
  on public.team_members for select to authenticated
  using (public.can_view_team(team_id));

create policy "Managers add members; anyone joins public teams"
  on public.team_members for insert to authenticated
  with check (
    public.can_manage_team(team_id)
    or (
      user_id = (select auth.uid())
      and role = 'member'
      and public.is_active_member()
      and exists (
        select 1 from public.teams t
        where t.id = team_id and t.visibility = 'public' and t.archived_at is null
      )
    )
  );

create policy "Team owners and admins change member roles"
  on public.team_members for update to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));

create policy "Managers remove members; anyone leaves"
  on public.team_members for delete to authenticated
  using (public.can_manage_team(team_id) or user_id = (select auth.uid()));

create policy "View accessible channels"
  on public.channels for select to authenticated
  using (public.can_access_channel(id) or public.can_manage_team(team_id));

create policy "Team owners and admins create channels"
  on public.channels for insert to authenticated
  with check (
    public.can_manage_team(team_id)
    and exists (select 1 from public.teams t where t.id = team_id and t.archived_at is null)
  );

create policy "Team owners and admins update channels"
  on public.channels for update to authenticated
  using (public.can_manage_team(team_id))
  with check (public.can_manage_team(team_id));

create policy "Team owners and admins delete channels"
  on public.channels for delete to authenticated
  using (public.can_manage_team(team_id));

create policy "View private channel members"
  on public.channel_members for select to authenticated
  using (
    public.can_access_channel(channel_id)
    or exists (select 1 from public.channels c where c.id = channel_id and public.can_manage_team(c.team_id))
  );

create policy "Team owners and admins add private channel members"
  on public.channel_members for insert to authenticated
  with check (exists (select 1 from public.channels c where c.id = channel_id and public.can_manage_team(c.team_id)));

create policy "Team owners and admins remove private channel members; anyone leaves"
  on public.channel_members for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.channels c where c.id = channel_id and public.can_manage_team(c.team_id))
  );

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------
create policy "Members view conversations"
  on public.conversations for select to authenticated
  using (public.can_access_conversation(id));

-- Creation goes through get_or_create_direct_conversation / create_group_conversation.
create policy "Members rename group chats"
  on public.conversations for update to authenticated
  using (kind = 'group' and public.can_access_conversation(id))
  with check (kind = 'group' and public.can_access_conversation(id));

create policy "Members view conversation membership"
  on public.conversation_members for select to authenticated
  using (public.can_access_conversation(conversation_id));
-- Membership changes go through RPCs.

create policy "Read own conversation state"
  on public.conversation_user_state for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------
create policy "Members read messages"
  on public.messages for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy "Members send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and kind = 'user'
    and public.can_post_to_conversation(conversation_id)
  );

-- Column rules (edit window, moderation) are enforced by the messages_guard trigger.
create policy "Senders edit or delete; admins moderate"
  on public.messages for update to authenticated
  using (
    public.can_access_conversation(conversation_id)
    and (sender_id = (select auth.uid()) or public.is_admin())
  )
  with check (
    public.can_access_conversation(conversation_id)
    and (sender_id = (select auth.uid()) or public.is_admin())
  );
-- No hard deletes from the API.

create policy "Members read reactions"
  on public.message_reactions for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and public.can_access_conversation(m.conversation_id)
  ));

create policy "Members react to messages"
  on public.message_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = message_id and m.deleted_at is null and m.kind = 'user'
        and public.can_post_to_conversation(m.conversation_id)
    )
  );

create policy "Remove own reactions"
  on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Members read attachments"
  on public.attachments for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy "Senders attach files to their messages"
  on public.attachments for insert to authenticated
  with check (
    uploader_id = (select auth.uid())
    and public.can_post_to_conversation(conversation_id)
  );

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
create policy "Members view calls"
  on public.calls for select to authenticated
  using (public.can_access_conversation(conversation_id));

create policy "Members view call participants"
  on public.call_participants for select to authenticated
  using (exists (
    select 1 from public.calls c
    where c.id = call_id and public.can_access_conversation(c.conversation_id)
  ));
-- Calls and participants are written by the call-token endpoint only.

-- ---------------------------------------------------------------------------
-- Notifications and audit
-- ---------------------------------------------------------------------------
create policy "Read own notifications"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Mark own notifications read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Delete own notifications"
  on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "Admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin());
-- Audit rows are inserted by triggers and trusted server code only.

-- ---------------------------------------------------------------------------
-- Read RPCs (SECURITY DEFINER with explicit auth.uid() filters)
-- ---------------------------------------------------------------------------
create or replace function public.list_my_conversations(
  p_unread_only boolean default false,
  p_search text default null,
  p_limit integer default 100
)
returns table (
  conversation_id uuid,
  kind public.conversation_kind,
  title text,
  other_user_id uuid,
  member_count integer,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_kind public.message_kind,
  last_sender_id uuid,
  unread_count integer,
  is_pinned boolean,
  is_muted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with convs as (
    select
      c.id as conversation_id,
      c.kind,
      case
        when c.kind = 'group' then coalesce(c.title, names.list, 'Group chat')
        when other.id = auth.uid() then other.display_name || ' (you)'
        else coalesce(other.display_name, 'Former employee')
      end as title,
      case when c.kind = 'direct' then other.id end as other_user_id,
      mc.n::integer as member_count,
      coalesce(c.last_message_at, c.created_at) as last_message_at,
      case
        when lm.id is null then null
        when lm.deleted_at is not null then 'Message deleted'
        when lm.body = '' then 'Sent an attachment'
        else left(lm.body, 140)
      end as last_message_preview,
      lm.kind as last_message_kind,
      lm.sender_id as last_sender_id,
      coalesce(unread.n, 0)::integer as unread_count,
      coalesce(s.is_pinned, false) as is_pinned,
      coalesce(s.is_muted, false) as is_muted
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id and cm.user_id = auth.uid() and cm.left_at is null
    left join public.conversation_user_state s
      on s.conversation_id = c.id and s.user_id = auth.uid()
    left join lateral (
      select p.id, p.display_name
      from public.conversation_members m2
      join public.profiles p on p.id = m2.user_id
      where m2.conversation_id = c.id
      order by (m2.user_id = auth.uid()), p.display_name
      limit 1
    ) other on c.kind = 'direct'
    left join lateral (
      select string_agg(x.display_name, ', ' order by x.display_name) as list
      from (
        select p.display_name
        from public.conversation_members m2
        join public.profiles p on p.id = m2.user_id
        where m2.conversation_id = c.id and m2.left_at is null and m2.user_id <> auth.uid()
        order by p.display_name
        limit 3
      ) x
    ) names on c.kind = 'group'
    left join lateral (
      select count(*) as n from public.conversation_members m3
      where m3.conversation_id = c.id and m3.left_at is null
    ) mc on true
    left join lateral (
      select m.id, m.body, m.kind, m.sender_id, m.deleted_at
      from public.messages m
      where m.conversation_id = c.id
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    left join lateral (
      select count(*) as n from public.messages m
      where m.conversation_id = c.id
        and m.kind = 'user'
        and m.deleted_at is null
        and m.sender_id is distinct from auth.uid()
        and m.created_at > coalesce(s.last_read_at, cm.joined_at)
    ) unread on true
    where c.kind in ('direct', 'group')
      and public.is_active_member()
  )
  select * from convs r
  where (not coalesce(p_unread_only, false) or r.unread_count > 0)
    and (
      p_search is null or btrim(p_search) = ''
      or position(lower(btrim(p_search)) in lower(r.title)) > 0
    )
  order by r.is_pinned desc, r.last_message_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;

-- Other members' read markers for "Seen" indicators in direct and group chats.
-- (conversation_user_state rows are otherwise private to their owner.)
create or replace function public.get_read_receipts(p_conversation_id uuid)
returns table (user_id uuid, last_read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.last_read_at
  from public.conversation_user_state s
  join public.conversations c on c.id = s.conversation_id
  where s.conversation_id = p_conversation_id
    and c.kind in ('direct', 'group')
    and public.can_access_conversation(p_conversation_id)
    and s.user_id <> auth.uid()
    and s.last_read_at is not null
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.user_id = s.user_id and m.left_at is null
    );
$$;

create or replace function public.list_teams()
returns table (
  team_id uuid,
  name text,
  description text,
  visibility public.team_visibility,
  archived_at timestamptz,
  member_count integer,
  is_member boolean,
  my_role public.team_member_role,
  can_manage boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.description, t.visibility, t.archived_at,
    (select count(*) from public.team_members tm where tm.team_id = t.id)::integer,
    mine.role is not null,
    mine.role,
    public.can_manage_team(t.id),
    t.created_at
  from public.teams t
  left join public.team_members mine on mine.team_id = t.id and mine.user_id = auth.uid()
  where public.can_view_team(t.id)
  order by (mine.role is null), t.archived_at nulls first, lower(t.name);
$$;

create or replace function public.list_my_channels()
returns table (
  team_id uuid,
  team_name text,
  team_archived boolean,
  channel_id uuid,
  channel_name text,
  channel_description text,
  channel_visibility public.channel_visibility,
  is_general boolean,
  channel_archived boolean,
  conversation_id uuid,
  last_message_at timestamptz,
  unread_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id, t.name, t.archived_at is not null,
    ch.id, ch.name, ch.description, ch.visibility, ch.is_general, ch.archived_at is not null,
    c.id, c.last_message_at,
    (
      select count(*) from public.messages m
      where m.conversation_id = c.id
        and m.kind = 'user'
        and m.deleted_at is null
        and m.sender_id is distinct from auth.uid()
        and m.created_at > coalesce(s.last_read_at, tm.created_at)
    )::integer
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.channels ch on ch.team_id = t.id
  join public.conversations c on c.channel_id = ch.id
  left join public.conversation_user_state s on s.conversation_id = c.id and s.user_id = auth.uid()
  where tm.user_id = auth.uid()
    and public.is_active_member()
    and public.user_can_access_channel(ch.id, auth.uid())
  order by lower(t.name), ch.is_general desc, lower(ch.name);
$$;

create or replace function public.search_directory(
  p_query text default null,
  p_department_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  avatar_path text,
  title text,
  department_id uuid,
  department_name text,
  availability public.availability,
  status_message text,
  employment_status public.employment_status,
  role public.app_role,
  email text,
  phone text,
  work_location text,
  last_seen_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select * from public.organization_settings where id
  ),
  q as (
    select nullif(lower(btrim(p_query)), '') as term
  ),
  base as (
    select p.*, d.name as department_name, r.role, pd.email, pd.phone, pd.work_location
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.user_roles r on r.user_id = p.id
    left join public.profile_details pd on pd.user_id = p.id
    cross join q
    where public.is_active_member()
      and (p.employment_status = 'active' or public.is_admin())
      and (p_department_id is null or p.department_id = p_department_id)
      and (
        q.term is null
        or position(q.term in lower(p.display_name || ' ' || coalesce(p.title, '') || ' ' || coalesce(d.name, ''))) > 0
        or (((select directory_show_email from s) or public.is_admin()) and position(q.term in coalesce(pd.email, '')) > 0)
      )
  )
  select
    b.id, b.display_name, b.avatar_path, b.title, b.department_id, b.department_name,
    b.availability, b.status_message, b.employment_status, b.role,
    case when (select directory_show_email from s) or b.id = auth.uid() or public.is_admin() then b.email end,
    case when (select directory_show_phone from s) or b.id = auth.uid() or public.is_admin() then b.phone end,
    case when (select directory_show_work_location from s) or b.id = auth.uid() or public.is_admin() then b.work_location end,
    b.last_seen_at,
    count(*) over ()
  from base b
  order by lower(b.display_name), b.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.admin_list_users(
  p_query text default null,
  p_status public.employment_status default null,
  p_role public.app_role default null,
  p_department_id uuid default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  display_name text,
  avatar_path text,
  title text,
  department_id uuid,
  department_name text,
  employment_status public.employment_status,
  role public.app_role,
  email text,
  last_seen_at timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.display_name, p.avatar_path, p.title, p.department_id, d.name,
    p.employment_status, r.role, pd.email, p.last_seen_at, u.last_sign_in_at, p.created_at,
    count(*) over ()
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.departments d on d.id = p.department_id
  left join public.user_roles r on r.user_id = p.id
  left join public.profile_details pd on pd.user_id = p.id
  where (p_status is null or p.employment_status = p_status)
    and (p_role is null or r.role = p_role)
    and (p_department_id is null or p.department_id = p_department_id)
    and (
      nullif(btrim(p_query), '') is null
      or position(lower(btrim(p_query)) in lower(p.display_name || ' ' || coalesce(pd.email, '') || ' ' || coalesce(p.title, ''))) > 0
    )
  order by lower(p.display_name), p.id
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_usage_summary()
returns table (
  total_users bigint,
  active_users bigint,
  invited_users bigint,
  suspended_users bigint,
  deactivated_users bigint,
  teams bigint,
  channels bigint,
  messages_7d bigint,
  active_senders_7d bigint,
  calls_7d bigint,
  call_minutes_7d bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where employment_status = 'active'),
    (select count(*) from public.profiles where employment_status = 'invited'),
    (select count(*) from public.profiles where employment_status = 'suspended'),
    (select count(*) from public.profiles where employment_status = 'deactivated'),
    (select count(*) from public.teams where archived_at is null),
    (select count(*) from public.channels where archived_at is null),
    (select count(*) from public.messages where kind = 'user' and created_at > now() - interval '7 days'),
    (select count(distinct sender_id) from public.messages where kind = 'user' and created_at > now() - interval '7 days'),
    (select count(*) from public.calls where started_at > now() - interval '7 days'),
    (select coalesce(sum(ceil(extract(epoch from (coalesce(ended_at, now()) - started_at)) / 60.0)), 0)::bigint
       from public.calls where started_at > now() - interval '7 days');
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
-- Nothing is readable anonymously. (Policies above only target `authenticated`;
-- this also removes table privileges as defense in depth.)
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Internal helpers: not callable through the API.
revoke execute on function public.user_is_team_member(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.user_can_access_channel(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.user_can_access_conversation(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.is_active_user(uuid) from public, anon, authenticated;
revoke execute on function public.write_audit(text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.provision_profile(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.bootstrap_owner(text) from public, anon, authenticated;
revoke execute on function public.post_system_message(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.conversation_label(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.handle_auth_email_change() from public, anon, authenticated;
-- Used by the call-invite endpoint to check an invitee's access.
grant execute on function public.user_can_access_conversation(uuid, uuid) to service_role;

-- API functions: signed-in users only.
revoke execute on function public.activate_my_account() from public, anon;
revoke execute on function public.touch_last_seen() from public, anon;
revoke execute on function public.get_or_create_direct_conversation(uuid) from public, anon;
revoke execute on function public.create_group_conversation(uuid[], text) from public, anon;
revoke execute on function public.add_conversation_members(uuid, uuid[]) from public, anon;
revoke execute on function public.remove_conversation_member(uuid, uuid) from public, anon;
revoke execute on function public.mark_conversation_read(uuid) from public, anon;
revoke execute on function public.set_conversation_preferences(uuid, boolean, boolean) from public, anon;
revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.list_my_conversations(boolean, text, integer) from public, anon;
revoke execute on function public.get_read_receipts(uuid) from public, anon;
revoke execute on function public.list_teams() from public, anon;
revoke execute on function public.list_my_channels() from public, anon;
revoke execute on function public.search_directory(text, uuid, integer, integer) from public, anon;
revoke execute on function public.admin_list_users(text, public.employment_status, public.app_role, uuid, integer, integer) from public, anon;
revoke execute on function public.admin_usage_summary() from public, anon;

grant execute on function public.activate_my_account() to authenticated;
grant execute on function public.touch_last_seen() to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group_conversation(uuid[], text) to authenticated;
grant execute on function public.add_conversation_members(uuid, uuid[]) to authenticated;
grant execute on function public.remove_conversation_member(uuid, uuid) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.set_conversation_preferences(uuid, boolean, boolean) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.list_my_conversations(boolean, text, integer) to authenticated;
grant execute on function public.get_read_receipts(uuid) to authenticated;
grant execute on function public.list_teams() to authenticated;
grant execute on function public.list_my_channels() to authenticated;
grant execute on function public.search_directory(text, uuid, integer, integer) to authenticated;
grant execute on function public.admin_list_users(text, public.employment_status, public.app_role, uuid, integer, integer) to authenticated;
grant execute on function public.admin_usage_summary() to authenticated;
