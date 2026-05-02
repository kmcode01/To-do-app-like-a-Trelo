begin;

create or replace function public.reorder_tasks(
  p_stage_id uuid,
  p_task_ids uuid[],
  p_done boolean,
  p_status task_status
)
returns void
language sql
as $$
  update public.tasks t
  set stage_id = p_stage_id,
      position = ordered.position,
      done = p_done,
      status = p_status
  from (
    select id,
           (ordinality - 1) as position
    from unnest(p_task_ids) with ordinality as ordered(id, ordinality)
  ) as ordered
  where t.id = ordered.id;
$$;

grant execute on function public.reorder_tasks(uuid, uuid[], boolean, text) to authenticated;

commit;
