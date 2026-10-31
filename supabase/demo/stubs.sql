-- Minimal stand-ins for the parts of Supabase's auth, storage and realtime
-- schemas that the migrations depend on. Used ONLY by the PGlite-based test
-- suite (scripts/test-db.mjs) and the in-browser demo mode. A real Supabase
-- project already has these schemas; never run this file there.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
create schema storage;
create schema realtime;
create schema extensions;
grant usage on schema public, auth, storage, realtime to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on auth.users to service_role;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz not null default now()
);
create unique index objects_bucket_name on storage.objects (bucket_id, name);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  _parts := string_to_array(name, '/');
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated;

create table realtime.messages (
  id bigserial primary key, topic text not null, extension text not null,
  payload jsonb, event text, private boolean default true
);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
grant all on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;

create publication supabase_realtime;
