begin;

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  added_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  position integer not null check (position >= 0),
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, position),
  unique (project_id, name),
  unique (project_id, id)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  stage_id uuid not null,
  title text not null,
  description_html text,
  position integer not null check (position >= 0),
  done boolean not null default false,
  total_tracked_seconds integer not null default 0 check (total_tracked_seconds >= 0),
  timer_running boolean not null default false,
  timer_started_at timestamptz,
  created_by_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_project_fk foreign key (project_id)
    references public.projects(id) on delete cascade,
  constraint tasks_stage_fk foreign key (project_id, stage_id)
    references public.project_stages(project_id, id) on delete restrict,
  unique (stage_id, position)
);

create table if not exists public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (duration_seconds is null or duration_seconds >= 0)
);

create index if not exists idx_projects_owner_user_id on public.projects(owner_user_id);
create index if not exists idx_project_members_user_id on public.project_members(user_id);
create index if not exists idx_project_stages_project_position on public.project_stages(project_id, position);
create index if not exists idx_tasks_project_id on public.tasks(project_id);
create index if not exists idx_tasks_stage_position on public.tasks(stage_id, position);
create index if not exists idx_task_time_entries_task_id on public.task_time_entries(task_id);
create index if not exists idx_task_time_entries_user_started_at on public.task_time_entries(user_id, started_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_project_owner(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.owner_user_id = auth.uid()
  );
$$;

create or replace function public.is_project_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and (
        p.owner_user_id = auth.uid()
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.is_project_owner(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;

drop trigger if exists trg_projects_set_updated_at on public.projects;
create trigger trg_projects_set_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

drop trigger if exists trg_project_stages_set_updated_at on public.project_stages;
create trigger trg_project_stages_set_updated_at
before update on public.project_stages
for each row execute function public.set_updated_at();

drop trigger if exists trg_tasks_set_updated_at on public.tasks;
create trigger trg_tasks_set_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create or replace function public.add_owner_to_project_members()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.project_members (project_id, user_id, role, added_by_user_id)
  values (new.id, new.owner_user_id, 'owner', new.owner_user_id)
  on conflict (project_id, user_id) do update set role = 'owner';

  return new;
end;
$$;

drop trigger if exists trg_projects_add_owner_member on public.projects;
create trigger trg_projects_add_owner_member
after insert on public.projects
for each row execute function public.add_owner_to_project_members();

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_stages enable row level security;
alter table public.tasks enable row level security;
alter table public.task_time_entries enable row level security;

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

drop policy if exists project_members_select_member on public.project_members;
create policy project_members_select_member
on public.project_members
for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists project_members_insert_owner on public.project_members;
create policy project_members_insert_owner
on public.project_members
for insert
to authenticated
with check (public.is_project_owner(project_id));

drop policy if exists project_members_update_owner on public.project_members;
create policy project_members_update_owner
on public.project_members
for update
to authenticated
using (public.is_project_owner(project_id))
with check (public.is_project_owner(project_id));

drop policy if exists project_members_delete_owner on public.project_members;
create policy project_members_delete_owner
on public.project_members
for delete
to authenticated
using (public.is_project_owner(project_id));

drop policy if exists project_stages_select_member on public.project_stages;
create policy project_stages_select_member
on public.project_stages
for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists project_stages_insert_member on public.project_stages;
create policy project_stages_insert_member
on public.project_stages
for insert
to authenticated
with check (public.is_project_member(project_id));

drop policy if exists project_stages_update_member on public.project_stages;
create policy project_stages_update_member
on public.project_stages
for update
to authenticated
using (public.is_project_member(project_id))
with check (public.is_project_member(project_id));

drop policy if exists project_stages_delete_member on public.project_stages;
create policy project_stages_delete_member
on public.project_stages
for delete
to authenticated
using (public.is_project_member(project_id));

drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member
on public.tasks
for select
to authenticated
using (public.is_project_member(project_id));

drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member
on public.tasks
for insert
to authenticated
with check (
  public.is_project_member(project_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member
on public.tasks
for update
to authenticated
using (public.is_project_member(project_id))
with check (public.is_project_member(project_id));

drop policy if exists tasks_delete_member on public.tasks;
create policy tasks_delete_member
on public.tasks
for delete
to authenticated
using (public.is_project_member(project_id));

drop policy if exists task_time_entries_select_member on public.task_time_entries;
create policy task_time_entries_select_member
on public.task_time_entries
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

drop policy if exists task_time_entries_insert_own on public.task_time_entries;
create policy task_time_entries_insert_own
on public.task_time_entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_time_entries_update_own on public.task_time_entries;
create policy task_time_entries_update_own
on public.task_time_entries
for update
to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.tasks t
    where t.id = task_id
      and public.is_project_member(t.project_id)
  )
);

drop policy if exists task_time_entries_delete_own on public.task_time_entries;
create policy task_time_entries_delete_own
on public.task_time_entries
for delete
to authenticated
using (user_id = auth.uid());

commit;
