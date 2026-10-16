-- 工作人員的名字（#48 之後）：由總管理員在後台填，工作人員自己不能改。
-- 既有的工作人員沒有名字（空值），總管理員下次儲存她的角色與範圍時一起補上。
-- 名字是工作人員的個資：權限規則和原本一樣，自己看得到自己的，總管理員看得到所有人的。
alter table public.staff_members
  add column name text,
  add constraint staff_members_name_valid check (
    name ~ '[^[:space:]]' and char_length(name) <= 50
  );

drop function public.add_staff_member(text, text, text);
drop function public.update_staff_member(uuid, text, text);
drop function public.list_staff_members();

-- 名字去掉前後空白後不能是空的，最多 50 個字。不符合時丟出 name_invalid。
create function public.clean_staff_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := public.trim_blank(p_name);
begin
  if v_name is null or v_name = '' or char_length(v_name) > 50 then
    raise exception 'name_invalid';
  end if;
  return v_name;
end;
$$;

revoke all on function public.clean_staff_name from public, anon, authenticated;

-- 工作人員名單，含名字與登入 Email。只有總管理員能看。
create function public.list_staff_members()
returns table (
  user_id uuid,
  email text,
  name text,
  role text,
  region text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  return query
    select s.user_id, u.email::text, s.name, s.role, s.region, s.created_at, u.last_sign_in_at
    from public.staff_members s
    join auth.users u on u.id = s.user_id
    order by s.created_at, u.email;
end;
$$;

revoke all on function public.list_staff_members from public, anon;
grant execute on function public.list_staff_members to authenticated;

-- 新增工作人員。排隊、帳號鎖定的理由見 20261020000000_staff_members.sql。
create function public.add_staff_member(p_email text, p_name text, p_role text, p_region text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_name text;
begin
  perform public.lock_staff_members();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  v_name := public.clean_staff_name(p_name);
  perform public.check_staff_scope(p_role, p_region);

  select id into v_user_id
  from auth.users
  where lower(email) = lower(public.trim_blank(p_email)) and deleted_at is null
  for share;
  if v_user_id is null then
    raise exception 'account_missing';
  end if;

  begin
    insert into public.staff_members (user_id, name, role, region)
    values (v_user_id, v_name, p_role, p_region);
  exception when unique_violation then
    raise exception 'already_staff';
  end;

  return v_user_id;
end;
$$;

revoke all on function public.add_staff_member from public, anon;
grant execute on function public.add_staff_member to authenticated;

-- 修改工作人員的名字、角色與負責範圍。總管理員改成其他角色時，要還有別的總管理員。
create function public.update_staff_member(p_user_id uuid, p_name text, p_role text, p_region text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  perform public.lock_staff_members();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  v_name := public.clean_staff_name(p_name);
  perform public.check_staff_scope(p_role, p_region);

  if p_role <> 'admin' then
    perform public.ensure_another_admin(p_user_id);
  end if;

  update public.staff_members
  set name = v_name, role = p_role, region = p_region, updated_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'staff_not_found';
  end if;
end;
$$;

revoke all on function public.update_staff_member from public, anon;
grant execute on function public.update_staff_member to authenticated;
