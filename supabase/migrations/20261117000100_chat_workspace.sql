-- Diwakar Connect - chat workspace upgrade (communications upgrade, phase 1)
--
--  * Favourite conversations (per person), shown in their own section.
--  * "Delivered" receipts: each person's client records when it last received
--    messages; "read" stays last_read_at.
--  * Pinned messages (any member who can post may pin/unpin; shown to everyone).
--  * Forwarded messages keep a link to the original (only if the sender can see it).
--  * Stickers: a message may carry one sticker from the built-in set.
--  * Group chats are not duplicated: find_group_conversation returns an existing
--    group with exactly the same members.
--  * The chat list now also lists team channels the person belongs to.
--
-- Additive and safe to run more than once.

alter table public.conversation_user_state
  add column if not exists is_favorite boolean not null default false,
  add column if not exists last_delivered_at timestamptz;

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles (id) on delete set null,
  add column if not exists forwarded_from_id uuid references public.messages (id) on delete set null,
  add column if not exists sticker text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_sticker_format') then
    alter table public.messages
      add constraint messages_sticker_format check (sticker is null or sticker ~ '^[a-z0-9-]{1,40}$');
  end if;
end;
$$;

create index if not exists messages_pinned_idx
  on public.messages (conversation_id, pinned_at desc) where pinned_at is not null;

-- ---------------------------------------------------------------------------
-- Insert/update guards for the new columns
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
  new.pinned_at := null;
  new.pinned_by := null;

  if new.reply_to_id is not null and not exists (
    select 1 from public.messages m
    where m.id = new.reply_to_id and m.conversation_id = new.conversation_id
  ) then
    raise exception 'Replies must reference a message in the same conversation' using errcode = '23514';
  end if;

  -- A forward may only point at a message the sender can actually see.
  if new.forwarded_from_id is not null and auth.uid() is not null then
    if not exists (
      select 1 from public.messages m
      where m.id = new.forwarded_from_id
        and m.deleted_at is null
        and m.kind = 'user'
        and public.user_can_access_conversation(m.conversation_id, new.sender_id)
    ) then
      raise exception 'You can only forward messages you can see' using errcode = '42501';
    end if;
  end if;

  select coalesce(array_agg(distinct u), '{}') into new.mentions
    from unnest(new.mentions) as u
   where u is not null;

  return new;
end;
$$;

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
     or new.created_at is distinct from old.created_at
     or new.forwarded_from_id is distinct from old.forwarded_from_id
     or new.sticker is distinct from old.sticker then
    raise exception 'Only the message text can be changed' using errcode = '42501';
  end if;
  -- Pinning goes through pin_message() only.
  if new.pinned_at is distinct from old.pinned_at or new.pinned_by is distinct from old.pinned_by then
    raise exception 'Use pin_message to pin or unpin' using errcode = '42501';
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
    new.sticker := null;
    new.pinned_at := null;
    new.pinned_by := null;
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
  if char_length(btrim(new.body)) = 0 and old.sticker is null then
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

-- ---------------------------------------------------------------------------
-- Pin / unpin a message
-- ---------------------------------------------------------------------------

create or replace function public.pin_message(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation uuid;
begin
  select m.conversation_id into v_conversation
    from public.messages m
   where m.id = p_message_id and m.deleted_at is null and m.kind = 'user';
  if v_conversation is null or not public.can_post_to_conversation(v_conversation) then
    raise exception 'Message not found' using errcode = '42501';
  end if;
  if p_pinned and (
    select count(*) from public.messages m
    where m.conversation_id = v_conversation and m.pinned_at is not null and m.id <> p_message_id
  ) >= 50 then
    raise exception 'A conversation can have at most 50 pinned messages' using errcode = '23514';
  end if;
  update public.messages
     set pinned_at = case when p_pinned then coalesce(pinned_at, now()) end,
         pinned_by = case when p_pinned then coalesce(pinned_by, auth.uid()) end
   where id = p_message_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Favourites
-- ---------------------------------------------------------------------------

drop function if exists public.set_conversation_preferences(uuid, boolean, boolean);

create or replace function public.set_conversation_preferences(
  p_conversation_id uuid,
  p_is_pinned boolean default null,
  p_is_muted boolean default null,
  p_is_favorite boolean default null
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
  insert into public.conversation_user_state (conversation_id, user_id, is_pinned, is_muted, is_favorite)
  values (
    p_conversation_id, auth.uid(),
    coalesce(p_is_pinned, false), coalesce(p_is_muted, false), coalesce(p_is_favorite, false)
  )
  on conflict (conversation_id, user_id)
  do update set
    is_pinned = coalesce(p_is_pinned, public.conversation_user_state.is_pinned),
    is_muted = coalesce(p_is_muted, public.conversation_user_state.is_muted),
    is_favorite = coalesce(p_is_favorite, public.conversation_user_state.is_favorite);
end;
$$;

-- ---------------------------------------------------------------------------
-- Delivered receipts
-- ---------------------------------------------------------------------------

-- Called by the signed-in client when it has received messages (on load and on
-- every realtime message). Marks all of the caller's direct/group chats.
create or replace function public.mark_conversations_delivered()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_active_member() then
    return;
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, last_delivered_at)
  select cm.conversation_id, auth.uid(), now()
    from public.conversation_members cm
    join public.conversations c on c.id = cm.conversation_id
   where cm.user_id = auth.uid() and cm.left_at is null and c.kind in ('direct', 'group')
  on conflict (conversation_id, user_id)
  do update set last_delivered_at = excluded.last_delivered_at;
end;
$$;

create or replace function public.get_message_receipts(p_conversation_id uuid)
returns table (user_id uuid, last_read_at timestamptz, last_delivered_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id, s.last_read_at, greatest(s.last_delivered_at, s.last_read_at)
  from public.conversation_user_state s
  join public.conversations c on c.id = s.conversation_id
  where s.conversation_id = p_conversation_id
    and c.kind in ('direct', 'group')
    and public.can_access_conversation(p_conversation_id)
    and s.user_id <> auth.uid()
    and (s.last_read_at is not null or s.last_delivered_at is not null)
    and exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.user_id = s.user_id and m.left_at is null
    );
$$;

-- ---------------------------------------------------------------------------
-- No duplicate group chats
-- ---------------------------------------------------------------------------

-- Returns an existing group chat whose current members are exactly the caller
-- plus p_member_ids, or null.
create or replace function public.find_group_conversation(p_member_ids uuid[])
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with wanted as (
    select distinct u as user_id from unnest(p_member_ids || auth.uid()) as u where u is not null
  )
  select c.id
  from public.conversations c
  join public.conversation_members me
    on me.conversation_id = c.id and me.user_id = auth.uid() and me.left_at is null
  where c.kind = 'group'
    and public.is_active_member()
    and not exists (
      select 1 from public.conversation_members m
      where m.conversation_id = c.id and m.left_at is null
        and m.user_id not in (select user_id from wanted)
    )
    and (
      select count(*) from public.conversation_members m
      where m.conversation_id = c.id and m.left_at is null
    ) = (select count(*) from wanted)
  order by c.last_message_at desc nulls last
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Chat list: direct, group and team channels, with favourites
-- ---------------------------------------------------------------------------

drop function if exists public.list_my_conversations(boolean, text, integer);

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
  is_muted boolean,
  is_favorite boolean,
  team_id uuid,
  team_name text,
  channel_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    -- Direct and group chats I am in.
    select c.id, cm.joined_at as since
    from public.conversations c
    join public.conversation_members cm
      on cm.conversation_id = c.id and cm.user_id = auth.uid() and cm.left_at is null
    where c.kind in ('direct', 'group')
    union all
    -- Channels of teams I belong to (private channels only if I am a member).
    select c.id, tm.created_at as since
    from public.conversations c
    join public.channels ch on ch.id = c.channel_id and ch.archived_at is null
    join public.teams t on t.id = ch.team_id and t.archived_at is null
    join public.team_members tm on tm.team_id = t.id and tm.user_id = auth.uid()
    where c.kind = 'channel'
      and public.user_can_access_channel(ch.id, auth.uid())
  ),
  convs as (
    select
      c.id as conversation_id,
      c.kind,
      case
        when c.kind = 'channel' then ch.name
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
        when lm.sticker is not null and lm.body = '' then 'Sent a sticker'
        when lm.body = '' then 'Sent an attachment'
        else left(lm.body, 140)
      end as last_message_preview,
      lm.kind as last_message_kind,
      lm.sender_id as last_sender_id,
      coalesce(unread.n, 0)::integer as unread_count,
      coalesce(s.is_pinned, false) as is_pinned,
      coalesce(s.is_muted, false) as is_muted,
      coalesce(s.is_favorite, false) as is_favorite,
      t.id as team_id,
      t.name as team_name,
      ch.id as channel_id
    from mine
    join public.conversations c on c.id = mine.id
    left join public.channels ch on ch.id = c.channel_id
    left join public.teams t on t.id = ch.team_id
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
      select case
        when c.kind = 'channel' then (
          select count(*) from public.team_members tm2 where tm2.team_id = ch.team_id
        )
        else (
          select count(*) from public.conversation_members m3
          where m3.conversation_id = c.id and m3.left_at is null
        )
      end as n
    ) mc on true
    left join lateral (
      select m.id, m.body, m.kind, m.sender_id, m.deleted_at, m.sticker
      from public.messages m
      where m.conversation_id = c.id
        and (s.cleared_at is null or m.created_at > s.cleared_at)
      order by m.created_at desc, m.id desc
      limit 1
    ) lm on true
    left join lateral (
      select count(*) as n from public.messages m
      where m.conversation_id = c.id
        and m.kind = 'user'
        and m.deleted_at is null
        and m.sender_id is distinct from auth.uid()
        and m.created_at > coalesce(s.last_read_at, mine.since)
    ) unread on true
    where public.is_active_member()
  )
  select * from convs r
  where (not coalesce(p_unread_only, false) or r.unread_count > 0)
    and (
      p_search is null or btrim(p_search) = ''
      or position(lower(btrim(p_search)) in lower(r.title)) > 0
      or position(lower(btrim(p_search)) in lower(coalesce(r.team_name, ''))) > 0
    )
  order by r.is_pinned desc, r.last_message_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.pin_message(uuid, boolean) from public, anon;
revoke execute on function public.set_conversation_preferences(uuid, boolean, boolean, boolean) from public, anon;
revoke execute on function public.mark_conversations_delivered() from public, anon;
revoke execute on function public.get_message_receipts(uuid) from public, anon;
revoke execute on function public.find_group_conversation(uuid[]) from public, anon;
revoke execute on function public.list_my_conversations(boolean, text, integer) from public, anon;

grant execute on function public.pin_message(uuid, boolean) to authenticated;
grant execute on function public.set_conversation_preferences(uuid, boolean, boolean, boolean) to authenticated;
grant execute on function public.mark_conversations_delivered() to authenticated;
grant execute on function public.get_message_receipts(uuid) to authenticated;
grant execute on function public.find_group_conversation(uuid[]) to authenticated;
grant execute on function public.list_my_conversations(boolean, text, integer) to authenticated;
