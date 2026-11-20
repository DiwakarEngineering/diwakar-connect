-- Diwakar Connect - scheduled meetings (communications upgrade, phase 4)
--
--  * meetings: title, time, organizer, a unique meeting ID (10 digits) and
--    passcode, optional guest access. Each meeting has a conversation: its own
--    group chat (organizer + invitees), or a team channel for channel meetings.
--    Calls, meeting chat, slides and whiteboard all run on that conversation.
--  * meeting_invitees: invitations and responses (accepted / tentative / declined).
--  * meeting_lobby: people waiting to be admitted - employees who weren't
--    invited (link + passcode) and external guests (through the server only).
--    The organizer or an admin admits or rejects.
--  * Reminders 15 minutes before the start (pg_cron every minute when available).
--  * Attendance from the call records.
--  * Organization settings: meeting scheduling policy, guest meetings, recording policy.
-- Additive and safe to run more than once.

alter table public.organization_settings
  add column if not exists meeting_creation public.team_creation_policy not null default 'everyone',
  add column if not exists allow_guest_meetings boolean not null default false,
  add column if not exists recording_policy text not null default 'off';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organization_settings_recording_policy') then
    alter table public.organization_settings
      add constraint organization_settings_recording_policy check (recording_policy in ('off', 'organizers', 'admins'));
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_response') then
    create type public.meeting_response as enum ('pending', 'accepted', 'tentative', 'declined');
  end if;
  if not exists (select 1 from pg_type where typname = 'lobby_status') then
    create type public.lobby_status as enum ('waiting', 'admitted', 'rejected', 'left');
  end if;
end;
$$;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  organizer_id uuid references public.profiles (id) on delete set null,
  code text not null unique check (code ~ '^[0-9]{10}$'),
  passcode text not null check (passcode ~ '^[A-Z0-9]{6}$'),
  allow_guests boolean not null default false,
  reminder_sent_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_time check (ends_at > starts_at and ends_at <= starts_at + interval '24 hours')
);

create index if not exists meetings_starts_idx on public.meetings (starts_at);
create index if not exists meetings_conversation_idx on public.meetings (conversation_id);

drop trigger if exists meetings_updated_at on public.meetings;
create trigger meetings_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();

create table if not exists public.meeting_invitees (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  response public.meeting_response not null default 'pending',
  responded_at timestamptz,
  primary key (meeting_id, user_id)
);

create index if not exists meeting_invitees_user_idx on public.meeting_invitees (user_id);

create table if not exists public.meeting_lobby (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  guest_name text check (guest_name is null or char_length(btrim(guest_name)) between 1 and 80),
  secret_hash text,
  status public.lobby_status not null default 'waiting',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  constraint meeting_lobby_who check ((user_id is null) <> (guest_name is null))
);

create index if not exists meeting_lobby_meeting_idx on public.meeting_lobby (meeting_id, status);

-- Meeting notifications open the meeting page.
alter table public.notifications add column if not exists meeting_id uuid references public.meetings (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------

create or replace function public.can_view_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member() and exists (
    select 1 from public.meetings m
    where m.id = p_meeting
      and (
        m.organizer_id = auth.uid()
        or public.is_admin()
        or exists (select 1 from public.meeting_invitees i where i.meeting_id = m.id and i.user_id = auth.uid())
        or public.can_access_conversation(m.conversation_id)
      )
  );
$$;

create or replace function public.can_manage_meeting(p_meeting uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member() and exists (
    select 1 from public.meetings m
    where m.id = p_meeting and (m.organizer_id = auth.uid() or public.is_admin())
  );
$$;

alter table public.meetings enable row level security;
alter table public.meeting_invitees enable row level security;
alter table public.meeting_lobby enable row level security;

drop policy if exists "Meeting visible to organizer, invitees and members" on public.meetings;
create policy "Meeting visible to organizer, invitees and members"
  on public.meetings for select to authenticated using (public.can_view_meeting(id));

drop policy if exists "Invitees visible with the meeting" on public.meeting_invitees;
create policy "Invitees visible with the meeting"
  on public.meeting_invitees for select to authenticated using (public.can_view_meeting(meeting_id));

-- The organizer/admins see the lobby; people see their own request.
drop policy if exists "Lobby visible to managers and the requester" on public.meeting_lobby;
create policy "Lobby visible to managers and the requester"
  on public.meeting_lobby for select to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_meeting(meeting_id));
-- All writes go through the functions below (or the server for guests).

-- ---------------------------------------------------------------------------
-- Create / update / cancel / respond
-- ---------------------------------------------------------------------------

create or replace function public.can_schedule_meetings()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_member() and case coalesce((select s.meeting_creation from public.organization_settings s where s.id), 'everyone')
    when 'everyone' then true
    when 'managers' then public.current_app_role() in ('owner', 'admin', 'manager')
    else public.is_admin()
  end;
$$;

create or replace function public.meeting_when(p_starts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_starts at time zone 'Asia/Kolkata', 'Dy DD Mon, HH12:MI AM') || ' IST';
$$;

create or replace function public.create_meeting(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_invitee_ids uuid[] default '{}',
  p_description text default null,
  p_channel_id uuid default null,
  p_allow_guests boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_conv uuid;
  v_id uuid;
  v_code text;
  v_invitees uuid[];
  v_title text := left(btrim(coalesce(p_title, '')), 120);
  v_name text;
begin
  if not public.can_schedule_meetings() then
    raise exception 'You are not allowed to schedule meetings' using errcode = '42501';
  end if;
  if char_length(v_title) = 0 then
    raise exception 'Give the meeting a title' using errcode = '22023';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The meeting must end after it starts' using errcode = '22023';
  end if;
  if p_allow_guests and not coalesce((select s.allow_guest_meetings from public.organization_settings s where s.id), false) then
    raise exception 'Guest access to meetings is turned off for your organization' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct m), '{}') into v_invitees
    from unnest(coalesce(p_invitee_ids, '{}')) m
   where m is not null and m <> v_me;
  if cardinality(v_invitees) > 99 then
    raise exception 'Meetings are limited to 100 invitees' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_invitees) m where not public.is_active_user(m)) then
    raise exception 'Some selected people are not active employees' using errcode = '22023';
  end if;

  if p_channel_id is not null then
    -- Channel meeting: runs in the channel's conversation.
    select c.id into v_conv from public.conversations c where c.channel_id = p_channel_id;
    if v_conv is null or not public.can_post_to_conversation(v_conv) then
      raise exception 'You can''t schedule a meeting in that channel' using errcode = '42501';
    end if;
    if exists (select 1 from unnest(v_invitees) m where not public.user_can_access_conversation(v_conv, m)) then
      raise exception 'Some invitees are not members of that channel' using errcode = '22023';
    end if;
  else
    -- Its own group chat (organizer + invitees), named after the meeting.
    insert into public.conversations (kind, title, created_by) values ('group', left(v_title, 80), v_me) returning id into v_conv;
    insert into public.conversation_members (conversation_id, user_id, role, added_by) values (v_conv, v_me, 'owner', v_me);
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
      select v_conv, m, 'member', v_me from unnest(v_invitees) m;
  end if;

  loop
    v_code := (floor(random() * 9000000000) + 1000000000)::bigint::text;
    exit when not exists (select 1 from public.meetings where code = v_code);
  end loop;

  insert into public.meetings (conversation_id, channel_id, title, description, starts_at, ends_at, organizer_id, code, passcode, allow_guests)
  values (
    v_conv, p_channel_id, v_title, nullif(btrim(coalesce(p_description, '')), ''), p_starts_at, p_ends_at, v_me, v_code,
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)), coalesce(p_allow_guests, false)
  )
  returning id into v_id;

  insert into public.meeting_invitees (meeting_id, user_id, response, responded_at) values (v_id, v_me, 'accepted', now());
  insert into public.meeting_invitees (meeting_id, user_id) select v_id, m from unnest(v_invitees) m;

  select p.display_name into v_name from public.profiles p where p.id = v_me;
  insert into public.notifications (user_id, kind, actor_id, conversation_id, meeting_id, title, body)
  select m, 'system', v_me, v_conv, v_id,
         left(coalesce(v_name, 'A colleague') || ' invited you to ' || v_title, 200),
         left(public.meeting_when(p_starts_at), 280)
    from unnest(v_invitees) m;

  perform public.post_system_message(v_conv, v_me, left('scheduled a meeting: ' || v_title || ' · ' || public.meeting_when(p_starts_at), 300));
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_me, 'meeting.created', 'meeting', v_id::text, jsonb_build_object('invitees', cardinality(v_invitees), 'guests', coalesce(p_allow_guests, false)));
  return v_id;
end;
$$;

create or replace function public.update_meeting(
  p_meeting_id uuid,
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_description text default null,
  p_allow_guests boolean default false,
  p_add_invitee_ids uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  m public.meetings%rowtype;
  v_new uuid[];
  v_name text;
begin
  select * into m from public.meetings where id = p_meeting_id;
  if m.id is null or not public.can_manage_meeting(p_meeting_id) then
    raise exception 'Only the organizer or an administrator can change this meeting' using errcode = '42501';
  end if;
  if m.cancelled_at is not null then
    raise exception 'This meeting was cancelled' using errcode = '22023';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'The meeting must end after it starts' using errcode = '22023';
  end if;
  if p_allow_guests and not m.allow_guests and not coalesce((select s.allow_guest_meetings from public.organization_settings s where s.id), false) then
    raise exception 'Guest access to meetings is turned off for your organization' using errcode = '42501';
  end if;

  update public.meetings
     set title = left(btrim(p_title), 120),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         starts_at = p_starts_at,
         ends_at = p_ends_at,
         allow_guests = coalesce(p_allow_guests, false),
         reminder_sent_at = case when p_starts_at <> m.starts_at then null else reminder_sent_at end
   where id = p_meeting_id;

  select coalesce(array_agg(distinct x), '{}') into v_new
    from unnest(coalesce(p_add_invitee_ids, '{}')) x
   where x is not null and public.is_active_user(x)
     and not exists (select 1 from public.meeting_invitees i where i.meeting_id = p_meeting_id and i.user_id = x);
  if cardinality(v_new) > 0 then
    if m.channel_id is not null then
      if exists (select 1 from unnest(v_new) x where not public.user_can_access_conversation(m.conversation_id, x)) then
        raise exception 'Some invitees are not members of that channel' using errcode = '22023';
      end if;
    else
      insert into public.conversation_members (conversation_id, user_id, role, added_by)
        select m.conversation_id, x, 'member', v_me from unnest(v_new) x
      on conflict (conversation_id, user_id) do update set left_at = null;
    end if;
    insert into public.meeting_invitees (meeting_id, user_id) select p_meeting_id, x from unnest(v_new) x;
  end if;

  select p.display_name into v_name from public.profiles p where p.id = v_me;
  -- Everyone invited hears about the change; new people get an invitation.
  insert into public.notifications (user_id, kind, actor_id, conversation_id, meeting_id, title, body)
  select i.user_id, 'system', v_me, m.conversation_id, m.id,
         left(case when i.user_id = any(v_new) then coalesce(v_name, 'A colleague') || ' invited you to ' else 'Meeting updated: ' end || btrim(p_title), 200),
         left(public.meeting_when(p_starts_at), 280)
    from public.meeting_invitees i
   where i.meeting_id = p_meeting_id and i.user_id <> v_me and i.response <> 'declined';
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_me, 'meeting.updated', 'meeting', p_meeting_id::text, jsonb_build_object('added', cardinality(v_new)));
end;
$$;

create or replace function public.cancel_meeting(p_meeting_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  m public.meetings%rowtype;
begin
  select * into m from public.meetings where id = p_meeting_id;
  if m.id is null or not public.can_manage_meeting(p_meeting_id) then
    raise exception 'Only the organizer or an administrator can cancel this meeting' using errcode = '42501';
  end if;
  if m.cancelled_at is not null then
    return;
  end if;
  update public.meetings set cancelled_at = now() where id = p_meeting_id;
  update public.meeting_lobby set status = 'rejected', decided_at = now(), decided_by = v_me where meeting_id = p_meeting_id and status = 'waiting';
  insert into public.notifications (user_id, kind, actor_id, conversation_id, meeting_id, title, body)
  select i.user_id, 'system', v_me, m.conversation_id, m.id, left('Meeting cancelled: ' || m.title, 200), left(public.meeting_when(m.starts_at), 280)
    from public.meeting_invitees i where i.meeting_id = p_meeting_id and i.user_id <> v_me;
  perform public.post_system_message(m.conversation_id, v_me, left('cancelled the meeting: ' || m.title, 300));
  insert into public.audit_logs (actor_id, action, target_type, target_id) values (v_me, 'meeting.cancelled', 'meeting', p_meeting_id::text);
end;
$$;

create or replace function public.respond_to_meeting(p_meeting_id uuid, p_response public.meeting_response)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_response = 'pending' then
    raise exception 'Choose accepted, tentative or declined' using errcode = '22023';
  end if;
  update public.meeting_invitees
     set response = p_response, responded_at = now()
   where meeting_id = p_meeting_id and user_id = auth.uid();
  if not found then
    raise exception 'You are not invited to this meeting' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create or replace function public.list_my_meetings(p_from timestamptz, p_to timestamptz)
returns table (
  meeting_id uuid,
  conversation_id uuid,
  channel_id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  organizer_id uuid,
  code text,
  allow_guests boolean,
  cancelled_at timestamptz,
  my_response public.meeting_response,
  invitee_count integer,
  live boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.conversation_id, m.channel_id, m.title, m.description, m.starts_at, m.ends_at, m.organizer_id, m.code,
         m.allow_guests, m.cancelled_at, i.response,
         (select count(*) from public.meeting_invitees x where x.meeting_id = m.id)::integer,
         exists (select 1 from public.calls c where c.conversation_id = m.conversation_id and c.status = 'active')
    from public.meetings m
    left join public.meeting_invitees i on i.meeting_id = m.id and i.user_id = auth.uid()
   where m.starts_at < p_to and m.ends_at > p_from
     and public.is_active_member()
     and (i.user_id is not null or m.organizer_id = auth.uid() or (m.channel_id is not null and public.can_access_conversation(m.conversation_id)))
   order by m.starts_at
   limit 500;
$$;

-- Meeting link (/meet/<code>): what a signed-in employee may know before joining.
create or replace function public.meeting_by_code(p_code text)
returns table (meeting_id uuid, title text, starts_at timestamptz, ends_at timestamptz, organizer_id uuid, conversation_id uuid, is_member boolean, cancelled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.title, m.starts_at, m.ends_at, m.organizer_id,
         case when public.can_access_conversation(m.conversation_id) then m.conversation_id end,
         public.can_access_conversation(m.conversation_id),
         m.cancelled_at is not null
    from public.meetings m
   where m.code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g') and public.is_active_member();
$$;

-- An employee who wasn't invited asks to join (needs the passcode); waits in the lobby.
create or replace function public.request_meeting_access(p_code text, p_passcode text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.meetings%rowtype;
  v_id uuid;
begin
  if not public.is_active_member() then
    raise exception 'Your account is not active' using errcode = '42501';
  end if;
  select * into m from public.meetings where code = regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  if m.id is null or m.cancelled_at is not null or upper(btrim(coalesce(p_passcode, ''))) <> m.passcode then
    raise exception 'Meeting ID or passcode is incorrect' using errcode = '42501';
  end if;
  if public.can_access_conversation(m.conversation_id) then
    return null; -- already allowed in
  end if;
  if m.channel_id is not null then
    raise exception 'This is a channel meeting. Ask the organizer to add you to the channel.' using errcode = '42501';
  end if;
  select id into v_id from public.meeting_lobby where meeting_id = m.id and user_id = auth.uid() and status = 'waiting';
  if v_id is null then
    insert into public.meeting_lobby (meeting_id, user_id) values (m.id, auth.uid()) returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Organizer/admin admits or rejects someone in the lobby. Admitted employees
-- join the meeting's conversation (and so its chat and calls).
create or replace function public.decide_lobby(p_lobby_id uuid, p_admit boolean)
returns public.lobby_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  l public.meeting_lobby%rowtype;
  m public.meetings%rowtype;
  v_status public.lobby_status := case when p_admit then 'admitted' else 'rejected' end;
begin
  select * into l from public.meeting_lobby where id = p_lobby_id;
  if l.id is null or not public.can_manage_meeting(l.meeting_id) then
    raise exception 'Only the organizer or an administrator can admit people' using errcode = '42501';
  end if;
  if l.status <> 'waiting' then
    return l.status;
  end if;
  select * into m from public.meetings where id = l.meeting_id;
  if p_admit and l.user_id is not null then
    insert into public.conversation_members (conversation_id, user_id, role, added_by)
    values (m.conversation_id, l.user_id, 'member', v_me)
    on conflict (conversation_id, user_id) do update set left_at = null;
    insert into public.meeting_invitees (meeting_id, user_id, response, responded_at)
    values (m.id, l.user_id, 'accepted', now())
    on conflict (meeting_id, user_id) do nothing;
  end if;
  update public.meeting_lobby set status = v_status, decided_at = now(), decided_by = v_me where id = p_lobby_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (v_me, case when p_admit then 'meeting.lobby_admitted' else 'meeting.lobby_rejected' end, 'meeting', m.id::text,
          jsonb_build_object('guest', l.user_id is null, 'user_id', l.user_id));
  return v_status;
end;
$$;

-- Attendance: who joined the meeting's calls during the meeting window.
create or replace function public.meeting_attendance(p_meeting_id uuid)
returns table (user_id uuid, guest_name text, first_joined timestamptz, last_left timestamptz, minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select * from public.meetings where id = p_meeting_id and public.can_view_meeting(p_meeting_id)
  )
  select cp.user_id, null::text,
         min(cp.joined_at), max(coalesce(cp.left_at, c.ended_at, now())),
         greatest(1, ceil(sum(extract(epoch from (coalesce(cp.left_at, c.ended_at, now()) - cp.joined_at))) / 60.0))::integer
    from m
    join public.calls c on c.conversation_id = m.conversation_id
     and c.started_at >= m.starts_at - interval '1 hour' and c.started_at < m.ends_at + interval '2 hours'
    join public.call_participants cp on cp.call_id = c.id
   group by cp.user_id
  union all
  select null::uuid, l.guest_name, l.decided_at, null::timestamptz, null::integer
    from m join public.meeting_lobby l on l.meeting_id = m.id
   where l.guest_name is not null and l.status in ('admitted', 'left')
   order by 3;
$$;

-- Reminders 15 minutes before the start (run every minute by pg_cron where available).
create or replace function public.send_meeting_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  m record;
begin
  for m in
    update public.meetings
       set reminder_sent_at = now()
     where cancelled_at is null and reminder_sent_at is null
       and starts_at > now() and starts_at <= now() + interval '15 minutes'
    returning id, conversation_id, title, starts_at
  loop
    insert into public.notifications (user_id, kind, conversation_id, meeting_id, title, body)
    select i.user_id, 'system', m.conversation_id, m.id,
           left('Starting soon: ' || m.title, 200),
           left('Starts at ' || public.meeting_when(m.starts_at), 280)
      from public.meeting_invitees i
     where i.meeting_id = m.id and i.response <> 'declined';
    n := n + 1;
  end loop;
  return n;
end;
$$;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available; meeting reminders will not be scheduled automatically.';
  end;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'diwakar-meeting-reminders';
    perform cron.schedule('diwakar-meeting-reminders', '* * * * *', 'select public.send_meeting_reminders()');
  end if;
end;
$$;

-- Scheduled meetings don't ring everyone's phone when the call starts
-- (invitees get the "started a call" notification and join from the calendar).
create or replace function public.after_call_ring_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.meetings m where m.conversation_id = new.conversation_id and m.cancelled_at is null) then
      return null;
    end if;
    insert into public.call_invites (call_id, user_id)
    select new.id, cm.user_id
      from public.conversation_members cm
      join public.conversations c on c.id = cm.conversation_id and c.kind in ('direct', 'group')
      join public.notification_preferences np on np.user_id = cm.user_id and np.calls
     where cm.conversation_id = new.conversation_id
       and cm.left_at is null
       and cm.user_id is distinct from new.started_by
       and public.is_active_user(cm.user_id)
    on conflict do nothing;
    return null;
  end if;

  if new.status = 'ended' and old.status = 'active' then
    for r in
      update public.call_invites
         set status = 'missed', responded_at = now()
       where call_id = new.id and status = 'ringing'
      returning user_id
    loop
      perform public.notify_missed_call(new.id, r.user_id);
    end loop;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.can_view_meeting(uuid) from public, anon;
revoke execute on function public.can_manage_meeting(uuid) from public, anon;
revoke execute on function public.can_schedule_meetings() from public, anon;
revoke execute on function public.create_meeting(text, timestamptz, timestamptz, uuid[], text, uuid, boolean) from public, anon;
revoke execute on function public.update_meeting(uuid, text, timestamptz, timestamptz, text, boolean, uuid[]) from public, anon;
revoke execute on function public.cancel_meeting(uuid) from public, anon;
revoke execute on function public.respond_to_meeting(uuid, public.meeting_response) from public, anon;
revoke execute on function public.list_my_meetings(timestamptz, timestamptz) from public, anon;
revoke execute on function public.meeting_by_code(text) from public, anon;
revoke execute on function public.request_meeting_access(text, text) from public, anon;
revoke execute on function public.decide_lobby(uuid, boolean) from public, anon;
revoke execute on function public.meeting_attendance(uuid) from public, anon;
revoke execute on function public.send_meeting_reminders() from public, anon, authenticated;

grant execute on function public.can_view_meeting(uuid) to authenticated;
grant execute on function public.can_manage_meeting(uuid) to authenticated;
grant execute on function public.can_schedule_meetings() to authenticated;
grant execute on function public.create_meeting(text, timestamptz, timestamptz, uuid[], text, uuid, boolean) to authenticated;
grant execute on function public.update_meeting(uuid, text, timestamptz, timestamptz, text, boolean, uuid[]) to authenticated;
grant execute on function public.cancel_meeting(uuid) to authenticated;
grant execute on function public.respond_to_meeting(uuid, public.meeting_response) to authenticated;
grant execute on function public.list_my_meetings(timestamptz, timestamptz) to authenticated;
grant execute on function public.meeting_by_code(text) to authenticated;
grant execute on function public.request_meeting_access(text, text) to authenticated;
grant execute on function public.decide_lobby(uuid, boolean) to authenticated;
grant execute on function public.meeting_attendance(uuid) to authenticated;
grant execute on function public.send_meeting_reminders() to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meeting_lobby') then
      alter publication supabase_realtime add table public.meeting_lobby;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'meetings') then
      alter publication supabase_realtime add table public.meetings;
    end if;
  end if;
end;
$$;
