begin;

alter table public.project_members
add column if not exists user_name text;

commit;