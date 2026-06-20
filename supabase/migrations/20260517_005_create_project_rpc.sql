begin;

create or replace function public.create_project(
  p_title text,
  p_description text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  insert into public.projects (owner_user_id, title, description)
  values (auth.uid(), p_title, p_description)
  returning id into v_project_id;

  return v_project_id;
end;
$$;

revoke all on function public.create_project(text, text) from public;
grant execute on function public.create_project(text, text) to authenticated;

commit;
