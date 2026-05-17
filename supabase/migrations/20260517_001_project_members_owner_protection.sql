begin;

drop policy if exists project_members_delete_owner on public.project_members;
create policy project_members_delete_owner
on public.project_members
for delete
to authenticated
using (
  public.is_project_owner(project_id)
  and role <> 'owner'
);

commit;
