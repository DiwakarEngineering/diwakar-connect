-- Security fix: only people an administrator invited can activate an account.
--
-- Before: activate_my_account() turned ANY 'invited' profile into 'active'.
-- Every new auth user gets an 'invited' profile, so if public sign-up is left
-- enabled in Supabase Auth, a stranger could sign up through the public API,
-- confirm their own email, call activate_my_account() and become a full
-- employee. Supabase sets auth.users.invited_at only for admin invitations
-- (inviteUserByEmail / "Invite user"), so require it.
--
-- The first owner is unaffected: bootstrap_owner() activates that profile directly.

create or replace function public.activate_my_account()
returns public.employment_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.employment_status;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;

  update public.profiles p
     set employment_status = 'active'
   where p.id = auth.uid()
     and p.employment_status = 'invited'
     and exists (select 1 from auth.users u where u.id = p.id and u.invited_at is not null);

  if found then
    perform public.write_audit('user.activated', 'user', auth.uid()::text, '{}'::jsonb);
  end if;

  select p.employment_status into v_status from public.profiles p where p.id = auth.uid();
  return v_status;
end;
$$;
