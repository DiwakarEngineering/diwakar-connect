-- Diwakar Connect - chat list options: mark as unread, hide, delete chat (for me).
--
-- All three are personal (like Pin / Mute): nothing changes for other members.
--   * Mark as unread: a flag; the chat shows as unread until it is read again.
--     Read receipts other people see are not moved back.
--   * Hide: the chat leaves my list until a new message arrives (search still finds it).
--   * Delete chat: my history is cleared (same as "Clear chat history") and the chat
--     is hidden; a new message brings it back, starting from that message.
-- Additive and safe to run more than once.

alter table public.conversation_user_state
  add column if not exists hidden_at timestamptz,
  add column if not exists marked_unread boolean not null default false;

-- Reading a chat clears "marked as unread".
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
  insert into public.conversation_user_state (conversation_id, user_id, last_read_at, marked_unread)
  values (p_conversation_id, auth.uid(), now(), false)
  on conflict (conversation_id, user_id)
  do update set
    last_read_at = greatest(coalesce(public.conversation_user_state.last_read_at, excluded.last_read_at), excluded.last_read_at),
    marked_unread = false;
end;
$$;

create or replace function public.mark_conversation_unread(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, marked_unread)
  values (p_conversation_id, auth.uid(), true)
  on conflict (conversation_id, user_id) do update set marked_unread = true;
end;
$$;

-- Hide / unhide a direct or group chat from my list.
create or replace function public.hide_conversation(p_conversation_id uuid, p_hidden boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.kind in ('direct', 'group')) then
    raise exception 'Only chats can be hidden' using errcode = '22023';
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, hidden_at)
  values (p_conversation_id, auth.uid(), case when p_hidden then now() end)
  on conflict (conversation_id, user_id)
  do update set hidden_at = case when p_hidden then now() end;
end;
$$;

-- Delete a direct or group chat for me: clear my history and hide it.
create or replace function public.delete_conversation_for_me(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if not public.can_access_conversation(p_conversation_id) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if not exists (select 1 from public.conversations c where c.id = p_conversation_id and c.kind in ('direct', 'group')) then
    raise exception 'Only chats can be deleted' using errcode = '22023';
  end if;
  insert into public.conversation_user_state (conversation_id, user_id, cleared_at, last_read_at, hidden_at, marked_unread, is_pinned, is_favorite)
  values (p_conversation_id, auth.uid(), v_now, v_now, v_now, false, false, false)
  on conflict (conversation_id, user_id)
  do update set
    cleared_at = v_now,
    hidden_at = v_now,
    marked_unread = false,
    is_pinned = false,
    is_favorite = false,
    last_read_at = greatest(coalesce(public.conversation_user_state.last_read_at, v_now), v_now);
end;
$$;

-- Chat list: hidden chats are left out until a newer message arrives (but found by search);
-- "marked as unread" counts as at least one unread message and is reported separately.
drop function if exists public.list_my_conversations(boolean, text, integer);

create function public.list_my_conversations(
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
  channel_id uuid,
  is_marked_unread boolean
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
      greatest(coalesce(unread.n, 0), case when coalesce(s.marked_unread, false) then 1 else 0 end)::integer as unread_count,
      coalesce(s.is_pinned, false) as is_pinned,
      coalesce(s.is_muted, false) as is_muted,
      coalesce(s.is_favorite, false) as is_favorite,
      t.id as team_id,
      t.name as team_name,
      ch.id as channel_id,
      coalesce(s.marked_unread, false) as is_marked_unread,
      s.hidden_at
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
  select
    r.conversation_id, r.kind, r.title, r.other_user_id, r.member_count, r.last_message_at,
    r.last_message_preview, r.last_message_kind, r.last_sender_id, r.unread_count, r.is_pinned,
    r.is_muted, r.is_favorite, r.team_id, r.team_name, r.channel_id, r.is_marked_unread
  from convs r
  where (not coalesce(p_unread_only, false) or r.unread_count > 0)
    and (
      p_search is null or btrim(p_search) = ''
      or position(lower(btrim(p_search)) in lower(r.title)) > 0
      or position(lower(btrim(p_search)) in lower(coalesce(r.team_name, ''))) > 0
    )
    -- Hidden until something newer than the moment it was hidden (search still finds it).
    and (
      r.hidden_at is null
      or r.last_message_at > r.hidden_at
      or (p_search is not null and btrim(p_search) <> '')
    )
  order by r.is_pinned desc, r.last_message_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 300);
$$;

revoke execute on function public.mark_conversation_unread(uuid) from public, anon;
revoke execute on function public.hide_conversation(uuid, boolean) from public, anon;
revoke execute on function public.delete_conversation_for_me(uuid) from public, anon;
revoke execute on function public.list_my_conversations(boolean, text, integer) from public, anon;

grant execute on function public.mark_conversation_unread(uuid) to authenticated;
grant execute on function public.hide_conversation(uuid, boolean) to authenticated;
grant execute on function public.delete_conversation_for_me(uuid) to authenticated;
grant execute on function public.list_my_conversations(boolean, text, integer) to authenticated;
