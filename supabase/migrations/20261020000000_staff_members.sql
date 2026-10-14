-- 後台工作人員（ADR 0004）：登入帳號是 Supabase Auth 的使用者，用 Email 魔法連結登入、不設密碼。
-- 關閉自行註冊，帳號只能由總管理員新增；有登入帳號但不在這張表裡的人不是工作人員。
-- 角色：總管理員（admin）、教堂承辦（venue_staff，負責一個場地）、支聯會承辦（stake_staff，負責一個支聯會）。
create table public.staff_members (
  -- 不連動刪除：工作人員的登入帳號要先從名單移除（remove_staff_member）才能刪，
  -- 免得在 Supabase 後台直接刪掉最後一位總管理員的帳號，系統就沒有總管理員了。
  user_id uuid primary key references auth.users (id) on delete restrict,
  role text not null,
  venue_id uuid references public.venues (id),
  stake_id uuid references public.stakes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_members_role_valid check (role in ('admin', 'venue_staff', 'stake_staff')),
  -- 總管理員不分範圍；教堂承辦只有場地，支聯會承辦只有支聯會。
  constraint staff_members_scope check (
    case role
      when 'admin' then venue_id is null and stake_id is null
      when 'venue_staff' then venue_id is not null and stake_id is null
      when 'stake_staff' then stake_id is not null and venue_id is null
    end
  )
);

create index staff_members_venue_id on public.staff_members (venue_id);
create index staff_members_stake_id on public.staff_members (stake_id);

alter table public.staff_members enable row level security;

-- 目前登入的人是不是總管理員。之後各資料表的權限規則也用它。
-- security definer：在 staff_members 自己的權限規則裡呼叫時不會繞回來。
create function public.is_staff_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_members where user_id = (select auth.uid()) and role = 'admin'
  )
$$;

revoke all on function public.is_staff_admin from public, anon;
grant execute on function public.is_staff_admin to authenticated;

-- 工作人員看得到自己的角色與範圍；總管理員看得到所有人。
create policy "Staff can read their own role"
  on public.staff_members for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_staff_admin());

-- 不開放直接寫入，只能透過下面的函式，由函式檢查是不是總管理員、會不會沒有總管理員。
revoke insert, update, delete on public.staff_members from anon, authenticated;

-- 總管理員設定負責範圍時要能挑任何年度的場地與停用中的支聯會。
create policy "Admins can read all conferences"
  on public.conferences for select
  to authenticated
  using (public.is_staff_admin());

create policy "Admins can read all venues"
  on public.venues for select
  to authenticated
  using (public.is_staff_admin());

create policy "Admins can read all stakes"
  on public.stakes for select
  to authenticated
  using (public.is_staff_admin());

-- 承辦人員看得到自己負責的場地與支聯會，即使不是目前年度、或支聯會已停用。
create policy "Venue staff can read their own venue"
  on public.venues for select
  to authenticated
  using (id = (select venue_id from public.staff_members where user_id = (select auth.uid())));

create policy "Stake staff can read their own stake"
  on public.stakes for select
  to authenticated
  using (id = (select stake_id from public.staff_members where user_id = (select auth.uid())));

-- 角色與範圍要相符、場地與支聯會要存在。不符合時丟出 scope_invalid。
create function public.check_staff_scope(p_role text, p_venue_id uuid, p_stake_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('admin', 'venue_staff', 'stake_staff')
    or (p_role = 'admin' and (p_venue_id is not null or p_stake_id is not null))
    or (p_role = 'venue_staff' and (p_stake_id is not null
      or not exists (select 1 from public.venues where id = p_venue_id)))
    or (p_role = 'stake_staff' and (p_venue_id is not null
      or not exists (select 1 from public.stakes where id = p_stake_id)))
  then
    raise exception 'scope_invalid';
  end if;
end;
$$;

revoke all on function public.check_staff_scope from public, anon, authenticated;

-- 至少要留一位總管理員，否則沒有人能再新增帳號。
-- 先鎖住所有總管理員，兩位總管理員同時移除對方時，後面那一個會看到只剩一位而被擋下。
create function public.ensure_another_admin(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.staff_members where role = 'admin' for update;
  if not exists (
    select 1 from public.staff_members where role = 'admin' and user_id <> p_user_id
  ) then
    raise exception 'last_admin';
  end if;
end;
$$;

revoke all on function public.ensure_another_admin from public, anon, authenticated;

-- 工作人員名單，含登入 Email。只有總管理員能看。
create function public.list_staff_members()
returns table (
  user_id uuid,
  email text,
  role text,
  venue_id uuid,
  stake_id uuid,
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
    select s.user_id, u.email::text, s.role, s.venue_id, s.stake_id, s.created_at, u.last_sign_in_at
    from public.staff_members s
    join auth.users u on u.id = s.user_id
    order by s.created_at, u.email;
end;
$$;

revoke all on function public.list_staff_members from public, anon;
grant execute on function public.list_staff_members to authenticated;

/*
 * 新增工作人員：把已經建好的登入帳號（同一個 Email）加進工作人員名單。
 * 登入帳號由網站伺服器用秘密金鑰先建好（資料庫裡沒辦法建），這裡負責檢查與寫入。
 */
create function public.add_staff_member(p_email text, p_role text, p_venue_id uuid, p_stake_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  perform public.check_staff_scope(p_role, p_venue_id, p_stake_id);

  select id into v_user_id from auth.users where lower(email) = lower(public.trim_blank(p_email));
  if v_user_id is null then
    raise exception 'account_missing';
  end if;

  begin
    insert into public.staff_members (user_id, role, venue_id, stake_id)
    values (v_user_id, p_role, p_venue_id, p_stake_id);
  exception when unique_violation then
    raise exception 'already_staff';
  end;

  return v_user_id;
end;
$$;

revoke all on function public.add_staff_member from public, anon;
grant execute on function public.add_staff_member to authenticated;

-- 修改工作人員的角色與負責範圍。總管理員改成其他角色時，要還有別的總管理員。
create function public.update_staff_member(p_user_id uuid, p_role text, p_venue_id uuid, p_stake_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  perform public.check_staff_scope(p_role, p_venue_id, p_stake_id);

  if p_role <> 'admin' then
    perform public.ensure_another_admin(p_user_id);
  end if;

  update public.staff_members
  set role = p_role, venue_id = p_venue_id, stake_id = p_stake_id, updated_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'staff_not_found';
  end if;
end;
$$;

revoke all on function public.update_staff_member from public, anon;
grant execute on function public.update_staff_member to authenticated;

-- 移除工作人員。之後網站伺服器再刪掉登入帳號；就算那一步失敗，不在名單裡也進不了後台。
create function public.remove_staff_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  perform public.ensure_another_admin(p_user_id);

  delete from public.staff_members where user_id = p_user_id;
  if not found then
    raise exception 'staff_not_found';
  end if;
end;
$$;

revoke all on function public.remove_staff_member from public, anon;
grant execute on function public.remove_staff_member to authenticated;
