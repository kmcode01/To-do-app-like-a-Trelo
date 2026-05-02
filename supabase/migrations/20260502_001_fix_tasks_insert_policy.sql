begin;

create or replace function public.set_created_by_user_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_by_user_id = auth.uid();
  return new;
end;
$$;

grant execute on function public.set_created_by_user_id() to authenticated;

drop trigger if exists trg_tasks_set_created_by_user_id on public.tasks;
create trigger trg_tasks_set_created_by_user_id
before insert on public.tasks
for each row execute function public.set_created_by_user_id();

drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
on public.tasks
for insert
to authenticated
with check (public.is_project_member(project_id));

commit;
