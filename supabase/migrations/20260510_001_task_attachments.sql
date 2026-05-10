begin;

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_name text not null,
  file_path text not null,
  mime_type text,
  size integer,
  created_by_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_attachments_task_id on public.task_attachments(task_id);
create index if not exists idx_task_attachments_created_by_user_id on public.task_attachments(created_by_user_id);

alter table public.task_attachments enable row level security;

drop policy if exists task_attachments_select_member on public.task_attachments;
create policy task_attachments_select_member
on public.task_attachments
for select
to authenticated
using (
  exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_attachments_insert_member on public.task_attachments;
create policy task_attachments_insert_member
on public.task_attachments
for insert
to authenticated
with check (
  created_by_user_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_attachments_delete_member on public.task_attachments;
create policy task_attachments_delete_member
on public.task_attachments
for delete
to authenticated
using (
  exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists task_attachments_storage_select on storage.objects;
create policy task_attachments_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks t
    where t.id = nullif(split_part(name, '/', 1), '')::uuid
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_attachments_storage_insert on storage.objects;
create policy task_attachments_storage_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks t
    where t.id = nullif(split_part(name, '/', 1), '')::uuid
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_attachments_storage_delete on storage.objects;
create policy task_attachments_storage_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and exists (
    select 1
    from public.tasks t
    where t.id = nullif(split_part(name, '/', 1), '')::uuid
      and public.is_project_member(t.project_id)
  )
);

commit;
