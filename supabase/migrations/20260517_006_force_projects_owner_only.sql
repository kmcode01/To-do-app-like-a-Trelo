begin;

alter table public.projects enable row level security;
alter table public.projects force row level security;

drop policy if exists projects_select_member on public.projects;
create policy projects_select_member
on public.projects
for select
to authenticated
using (public.is_project_member(id));

drop policy if exists projects_insert_owner on public.projects;
create policy projects_insert_owner
on public.projects
for insert
to authenticated
with check (owner_user_id = auth.uid());

drop policy if exists projects_update_owner on public.projects;
create policy projects_update_owner
on public.projects
for update
to authenticated
using (public.is_project_owner(id))
with check (public.is_project_owner(id));

drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner
on public.projects
for delete
to authenticated
using (public.is_project_owner(id));

commit;
