begin;

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  author_id uuid not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comments_target_required check (
    (project_id is not null and task_id is null)
    or (project_id is null and task_id is not null)
  ),
  constraint comments_content_not_empty check (length(trim(content)) > 0)
);

create index if not exists idx_comments_project_id on public.comments(project_id);
create index if not exists idx_comments_task_id on public.comments(task_id);
create index if not exists idx_comments_author_id on public.comments(author_id);
create index if not exists idx_comments_created_at on public.comments(created_at);

create trigger trg_comments_set_updated_at
before update on public.comments
for each row execute function public.set_updated_at();

alter table public.comments enable row level security;

drop policy if exists comments_select_member on public.comments;
create policy comments_select_member
on public.comments
for select
to authenticated
using (
  (project_id is not null and public.is_project_member(project_id))
  or (
    task_id is not null
    and exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and public.is_project_member(t.project_id)
    )
  )
);

drop policy if exists comments_insert_member on public.comments;
create policy comments_insert_member
on public.comments
for insert
to authenticated
with check (
  author_id = auth.uid()
  and (
    (project_id is not null and public.is_project_member(project_id))
    or (
      task_id is not null
      and exists (
        select 1
        from public.tasks t
        where t.id = task_id
          and public.is_project_member(t.project_id)
      )
    )
  )
);

drop policy if exists comments_update_owner on public.comments;
create policy comments_update_owner
on public.comments
for update
to authenticated
using (
  author_id = auth.uid()
  and (
    (project_id is not null and public.is_project_member(project_id))
    or (
      task_id is not null
      and exists (
        select 1
        from public.tasks t
        where t.id = task_id
          and public.is_project_member(t.project_id)
      )
    )
  )
)
with check (
  author_id = auth.uid()
  and (
    (project_id is not null and public.is_project_member(project_id))
    or (
      task_id is not null
      and exists (
        select 1
        from public.tasks t
        where t.id = task_id
          and public.is_project_member(t.project_id)
      )
    )
  )
);

drop policy if exists comments_delete_owner_or_admin on public.comments;
create policy comments_delete_owner_or_admin
on public.comments
for delete
to authenticated
using (
  author_id = auth.uid()
  or (
    project_id is not null
    and public.is_project_owner(project_id)
  )
  or (
    task_id is not null
    and exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and public.is_project_owner(t.project_id)
    )
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end
$$;

commit;
