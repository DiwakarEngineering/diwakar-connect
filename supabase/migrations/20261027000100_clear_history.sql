-- Diwakar Connect - "Clear chat history"
--
-- Per-person: clearing hides everything sent up to that moment for the person
-- who cleared it. Messages stay in the database (and visible to everyone else),
-- so history is never lost by signing out or in. Safe to run more than once.

alter table public.conversation_user_state
  add column if not exists cleared_at timestamptz;

create or replace function public.clear_conversation_history(p_conversation_id uuid)
returns timestamptz
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
  insert into public.conversation_user_state (conversation_id, user_id, cleared_at, last_read_at)
  values (p_conversation_id, auth.uid(), v_now, v_now)
  on conflict (conversation_id, user_id)
  do update set
    cleared_at = v_now,
    last_read_at = greatest(coalesce(public.conversation_user_state.last_read_at, v_now), v_now);
  return v_now;
end;
$$;

revoke execute on function public.clear_conversation_history(uuid) from public, anon;
grant execute on function public.clear_conversation_history(uuid) to authenticated;

-- Chat list: the preview ignores messages the person has cleared.
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
