-- Diwakar Connect - call ringing (communications upgrade, phase 2)
--
-- Each direct/group call rings the other members. Their ring is a row in
-- call_invites:  ringing -> accepted (joined) | declined | missed.
--  * Created by the database when the call row is created (server only).
--  * Joining the call marks it accepted automatically.
--  * The person being called may decline, or let it time out (missed).
--  * When the call ends, anyone still ringing gets "missed" plus a
--    "Missed call" notification.
-- Additive and safe to run more than once.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'call_invite_status') then
    create type public.call_invite_status as enum ('ringing', 'accepted', 'declined', 'missed');
  end if;
end;
$$;

create table if not exists public.call_invites (
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status public.call_invite_status not null default 'ringing',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (call_id, user_id)
);

create index if not exists call_invites_user_idx on public.call_invites (user_id, created_at desc);

alter table public.call_invites enable row level security;

drop policy if exists "Invitee or call members view rings" on public.call_invites;
create policy "Invitee or call members view rings"
  on public.call_invites for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.calls c
      where c.id = call_id and public.can_access_conversation(c.conversation_id)
    )
  );
-- No insert/update/delete policies: rows change only through the functions below.

-- Missed-call notification (kind 'system', linked to the call and conversation).
create or replace function public.notify_missed_call(p_call_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_call public.calls%rowtype;
  v_name text;
begin
  select * into v_call from public.calls where id = p_call_id;
  if v_call.id is null then
    return;
  end if;
  select p.display_name into v_name from public.profiles p where p.id = v_call.started_by;
  insert into public.notifications (user_id, kind, actor_id, conversation_id, call_id, title)
  values (
    p_user_id, 'system', v_call.started_by, v_call.conversation_id, v_call.id,
    left('Missed ' || case v_call.media when 'audio' then 'audio' else 'video' end || ' call from '
      || coalesce(v_name, 'a colleague') || coalesce(public.conversation_label(v_call.conversation_id), ''), 200)
  );
end;
$$;

-- Ring the other members when a direct/group call starts; on end, ringing -> missed.
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

drop trigger if exists calls_after_ring_change on public.calls;
create trigger calls_after_ring_change
  after insert or update on public.calls
  for each row execute function public.after_call_ring_change();

-- Joining the call (the server records a participant row) answers the ring.
create or replace function public.after_call_participant_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.call_invites
     set status = 'accepted', responded_at = now()
   where call_id = new.call_id and user_id = new.user_id and status in ('ringing', 'missed', 'declined');
  return null;
end;
$$;

drop trigger if exists call_participants_after_insert_ring on public.call_participants;
create trigger call_participants_after_insert_ring
  after insert on public.call_participants
  for each row execute function public.after_call_participant_insert();

-- The person being called declines, or their ring times out (missed).
create or replace function public.respond_to_call(p_call_id uuid, p_response text)
returns public.call_invite_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.call_invite_status;
begin
  if p_response not in ('declined', 'missed') then
    raise exception 'Response must be declined or missed' using errcode = '22023';
  end if;
  update public.call_invites
     set status = p_response::public.call_invite_status, responded_at = now()
   where call_id = p_call_id and user_id = auth.uid() and status = 'ringing'
  returning status into v_status;
  if v_status is null then
    -- Already answered elsewhere, or not ringing for this person.
    select status into v_status from public.call_invites where call_id = p_call_id and user_id = auth.uid();
    return v_status;
  end if;
  if v_status = 'missed' then
    perform public.notify_missed_call(p_call_id, auth.uid());
  end if;
  return v_status;
end;
$$;

revoke execute on function public.notify_missed_call(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.respond_to_call(uuid, text) from public, anon;
grant execute on function public.respond_to_call(uuid, text) to authenticated;

-- Realtime: ring changes reach the caller (outgoing screen) and the callee (incoming popup).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_invites'
     ) then
    alter publication supabase_realtime add table public.call_invites;
  end if;
end;
$$;
