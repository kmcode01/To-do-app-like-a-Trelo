begin;

create table if not exists public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  text text not null check (length(trim(text)) > 0),
  checked boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_task_checklist_items_task_id on public.task_checklist_items(task_id, position);

alter table public.task_checklist_items enable row level security;

drop policy if exists checklist_items_select_member on public.task_checklist_items;
create policy checklist_items_select_member
on public.task_checklist_items
for select
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists checklist_items_insert_member on public.task_checklist_items;
create policy checklist_items_insert_member
on public.task_checklist_items
for insert
to authenticated
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists checklist_items_update_member on public.task_checklist_items;
create policy checklist_items_update_member
on public.task_checklist_items
for update
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
)
with check (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists checklist_items_delete_member on public.task_checklist_items;
create policy checklist_items_delete_member
on public.task_checklist_items
for delete
to authenticated
using (
  exists (
    select 1 from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

commit;
