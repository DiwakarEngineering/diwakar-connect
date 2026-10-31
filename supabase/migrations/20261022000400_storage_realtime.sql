-- Diwakar Connect: private storage buckets and Realtime authorization.

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Buckets (both private; files are served with short-lived signed URLs)
-- ---------------------------------------------------------------------------
-- HTML, SVG and script types are deliberately excluded to avoid stored XSS.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('attachments', 'attachments', false, 52428800, array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip', 'application/x-zip-compressed',
    'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg',
    'video/mp4', 'video/webm', 'video/quicktime'
  ]),
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Attachments: <conversation_id>/<uploader_id>/<random>-<file name>
create policy "Members upload attachments to conversations they can post in"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and public.can_post_to_conversation(public.try_uuid((storage.foldername(name))[1]))
  );

-- Readable only once linked to a (non-deleted) message the reader can access.
create policy "Members read attachments of their conversations"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attachments'
    and exists (
      select 1 from public.attachments a
      where a.object_path = name and public.can_access_conversation(a.conversation_id)
    )
  );

create policy "Uploaders delete their own attachment files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- Avatars: <user_id>/<file name>
create policy "Active members view avatars"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars'
    and (public.is_active_member() or (storage.foldername(name))[1] = (select auth.uid())::text)
  );

create policy "Upload own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.is_active_member()
  );

create policy "Replace own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Delete own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Postgres changes are delivered only to subscribers who pass the table's RLS.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.messages,
      public.message_reactions,
      public.attachments,
      public.notifications,
      public.calls,
      public.call_participants,
      public.conversation_members,
      public.profiles;
  end if;
end;
$$;

-- Private broadcast/presence topics used by the app:
--   conversation:<uuid>  typing indicators, scoped to conversation members
--   org:presence         who is online, scoped to active employees
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute $policy$
      create policy "Members use their realtime topics"
        on realtime.messages for select to authenticated
        using (
          (realtime.topic() like 'conversation:%'
            and public.can_access_conversation(public.try_uuid(substr(realtime.topic(), 14))))
          or (realtime.topic() = 'org:presence' and public.is_active_member())
        )
    $policy$;
    execute $policy$
      create policy "Members broadcast on their realtime topics"
        on realtime.messages for insert to authenticated
        with check (
          (realtime.topic() like 'conversation:%'
            and public.can_access_conversation(public.try_uuid(substr(realtime.topic(), 14))))
          or (realtime.topic() = 'org:presence' and public.is_active_member())
        )
    $policy$;
  end if;
end;
$$;
