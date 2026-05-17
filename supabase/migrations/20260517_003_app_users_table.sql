begin;

create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_users_email on public.app_users(email);
create index if not exists idx_app_users_display_name on public.app_users(display_name);

create or replace function public.sync_app_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (id, email, display_name, created_at, updated_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = excluded.display_name,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists trg_sync_app_user on auth.users;
create trigger trg_sync_app_user
after insert or update on auth.users
for each row execute function public.sync_app_user();

insert into public.app_users (id, email, display_name, created_at, updated_at)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email),
  coalesce(u.created_at, now()),
  now()
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      display_name = excluded.display_name,
      updated_at = now();

alter table public.app_users enable row level security;

drop policy if exists app_users_select_authenticated on public.app_users;
create policy app_users_select_authenticated
on public.app_users
for select
to authenticated
using (true);

commit;
