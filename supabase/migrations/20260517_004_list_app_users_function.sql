begin;

create or replace function public.list_app_users()
returns table (
  id uuid,
  email text,
  display_name text
)
language sql
stable
security definer
set search_path = auth, public
as $$
  select
    u.id,
    u.email,
    coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email) as display_name
  from auth.users u
  order by u.email;
$$;

revoke all on function public.list_app_users() from public;
grant execute on function public.list_app_users() to authenticated;

commit;
