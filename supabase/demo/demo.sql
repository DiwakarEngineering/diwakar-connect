-- DEMO MODE ONLY (in-browser PGlite). Never run against a real project.
-- Adds what Supabase Auth / Storage / Realtime would otherwise provide.

create schema demo;
-- Trigger functions live here and run as the signed-in role.
grant usage on schema demo to anon, authenticated, service_role;

-- Demo passwords (SHA-256; acceptable only because everything is local to this browser).
create table demo.credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_hash text not null
);

-- File contents for storage.objects (the database is the only storage in demo mode).
create table demo.blobs (
  bucket_id text not null,
  name text not null,
  content_type text,
  data bytea not null,
  primary key (bucket_id, name)
);

create table demo.meta (key text primary key, value text not null);

-- Realtime emulation: every change on a published table is announced with
-- NOTIFY; the demo client re-reads the row as the signed-in user, so RLS
-- still decides what each person receives.
create or replace function demo.notify_change()
returns trigger
language plpgsql
as $$
declare
  r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  r := r - 'body' - 'search' - 'metadata' - 'title' - 'status_message' - 'mentions';
  perform pg_notify('dc_changes', jsonb_build_object('table', tg_table_name, 'type', tg_op, 'row', r)::text);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['messages', 'message_reactions', 'attachments', 'notifications', 'calls',
                           'call_participants', 'conversation_members', 'profiles'] loop
    execute format(
      'create trigger demo_notify after insert or update or delete on public.%I for each row execute function demo.notify_change()',
      t);
  end loop;
end;
$$;
