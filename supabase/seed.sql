-- LOCAL DEVELOPMENT ONLY.
-- The Supabase CLI runs this file on `supabase db reset` against the local
-- database. It is never applied by `supabase db push` or by migrations, so it
-- cannot reach a hosted/production project.
--
-- It only creates starter departments. No people are seeded: create users
-- through the admin console (invitations) or the local Studio, then run
--   select public.bootstrap_owner('you@example.test');

insert into public.departments (name, description) values
  ('O&M / Service', 'Plant operations and maintenance'),
  ('Projects & Installation', 'Site execution and commissioning'),
  ('Accounts & Finance', null),
  ('Procurement & Stores', null),
  ('HR', 'People operations')
on conflict do nothing;
