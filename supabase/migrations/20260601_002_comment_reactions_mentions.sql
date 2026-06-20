begin;

create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  reaction text not null check (reaction in ('👍', '❤️', '🎉')),
  created_at timestamptz not null default now(),
  unique (comment_id, user_id, reaction)
);

create index if not exists idx_comment_reactions_comment_id on public.comment_reactions(comment_id);
create index if not exists idx_comment_reactions_user_id on public.comment_reactions(user_id);

create table if not exists public.comment_mentions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments(id) on delete cascade,
  mentioned_user_id uuid not null references public.app_users(id) on delete cascade,
  mention_text text not null,
  created_at timestamptz not null default now(),
  unique (comment_id, mentioned_user_id)
);

create index if not exists idx_comment_mentions_comment_id on public.comment_mentions(comment_id);
create index if not exists idx_comment_mentions_mentioned_user_id on public.comment_mentions(mentioned_user_id);

alter table public.comment_reactions enable row level security;
alter table public.comment_mentions enable row level security;

drop policy if exists comment_reactions_select_member on public.comment_reactions;
create policy comment_reactions_select_member
on public.comment_reactions
for select
to authenticated
using (
  exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and (
        (c.project_id is not null and public.is_project_member(c.project_id))
        or (
          c.task_id is not null
          and exists (
            select 1
            from public.tasks t
            where t.id = c.task_id
              and public.is_project_member(t.project_id)
          )
        )
      )
  )
);

drop policy if exists comment_reactions_insert_member on public.comment_reactions;
create policy comment_reactions_insert_member
on public.comment_reactions
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and (
        (c.project_id is not null and public.is_project_member(c.project_id))
        or (
          c.task_id is not null
          and exists (
            select 1
            from public.tasks t
            where t.id = c.task_id
              and public.is_project_member(t.project_id)
          )
        )
      )
  )
);

drop policy if exists comment_reactions_delete_owner on public.comment_reactions;
create policy comment_reactions_delete_owner
on public.comment_reactions
for delete
to authenticated
using (
  user_id = auth.uid()
);

drop policy if exists comment_mentions_select_member on public.comment_mentions;
create policy comment_mentions_select_member
on public.comment_mentions
for select
to authenticated
using (
  exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and (
        (c.project_id is not null and public.is_project_member(c.project_id))
        or (
          c.task_id is not null
          and exists (
            select 1
            from public.tasks t
            where t.id = c.task_id
              and public.is_project_member(t.project_id)
          )
        )
      )
  )
);

drop policy if exists comment_mentions_insert_owner on public.comment_mentions;
create policy comment_mentions_insert_owner
on public.comment_mentions
for insert
to authenticated
with check (
  exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and c.author_id = auth.uid()
  )
);

drop policy if exists comment_mentions_delete_owner on public.comment_mentions;
create policy comment_mentions_delete_owner
on public.comment_mentions
for delete
to authenticated
using (
  exists (
    select 1
    from public.comments c
    where c.id = comment_id
      and c.author_id = auth.uid()
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_reactions'
  ) then
    alter publication supabase_realtime add table public.comment_reactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_mentions'
  ) then
    alter publication supabase_realtime add table public.comment_mentions;
  end if;
end
$$;

commit;
