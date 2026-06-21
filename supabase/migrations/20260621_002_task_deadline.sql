begin;

alter table public.tasks
  add column if not exists deadline timestamptz;

commit;
