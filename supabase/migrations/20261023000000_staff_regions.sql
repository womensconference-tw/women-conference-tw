-- 後台角色改成籌備會的分工（#48、ADR 0004）：總管理員（含總召團）、課務組、報報組，負責範圍依北／中／南區切分。
-- 原本的教堂承辦（venue_staff，一個場地）改成課務組（course_team，一區）；
-- 支聯會承辦（stake_staff，一個支聯會）改成報報組（registration_team，一區或全區）。兩組都只能看、不能改。

-- 區：north 北區、central 中區、south 南區。場地與支聯會都一定要有區。
-- 正式資料庫建立這張 migration 時還沒有場地，所以直接要求必填；本機的場地由 seed 建立。
alter table public.venues
  add column region text not null,
  add constraint venues_region_valid check (region in ('north', 'central', 'south'));

alter table public.stakes
  add column region text,
  add constraint stakes_region_valid check (region in ('north', 'central', 'south'));

-- 正式資料庫的支聯會名單（2026-10-15 匯入）。本機沒有這些名稱，支聯會由 seed 建立。
-- 沒有對到的支聯會會讓下面的 set not null 失敗，不會留下沒有區的支聯會。
update public.stakes
set region = case
  when name_zh in (
    '台灣東台北支聯會', '台灣北台北支聯會', '台灣南台北支聯會', '台灣西台北支聯會',
    '台灣中台北支聯會', '台灣花蓮支聯會', '台灣桃園支聯會', '台灣新竹支聯會'
  ) then 'north'
  when name_zh in ('台灣東台中支聯會', '台灣西台中支聯會', '台灣中興支聯會') then 'central'
  when name_zh in ('台灣嘉義支聯會', '台灣台南支聯會', '台灣北高雄支聯會', '台灣南高雄支聯會') then 'south'
end;

alter table public.stakes alter column region set not null;

-- 權限規則與函式用到 staff_members.venue_id、stake_id，先拿掉，最後換成依區判斷的版本。
drop policy "Staff can read registrations in their scope" on public.registrations;
drop policy "Venue staff can read classrooms of their venue" on public.course_classrooms;
drop policy "Venue staff can read their own venue" on public.venues;
drop function public.add_staff_member(text, text, uuid, uuid);
drop function public.update_staff_member(uuid, text, uuid, uuid);
drop function public.list_staff_members();
drop function public.check_staff_scope(text, uuid, uuid);

-- 工作人員的負責範圍：區。空值表示不分區（總管理員、全區的報報組）。
alter table public.staff_members
  drop constraint staff_members_role_valid,
  drop constraint staff_members_scope,
  add column region text;

-- 既有的承辦人員照她的場地或支聯會所在的區換成新角色。正式資料庫這時只有總管理員。
update public.staff_members s
set role = 'course_team', region = v.region
from public.venues v
where s.role = 'venue_staff' and v.id = s.venue_id;

update public.staff_members s
set role = 'registration_team', region = st.region
from public.stakes st
where s.role = 'stake_staff' and st.id = s.stake_id;

alter table public.staff_members
  drop column venue_id,
  drop column stake_id,
  add constraint staff_members_role_valid check (role in ('admin', 'course_team', 'registration_team')),
  add constraint staff_members_region_valid check (region in ('north', 'central', 'south')),
  -- 總管理員不分區；課務組一定要有一區；報報組一區或全區（空值）。
  add constraint staff_members_scope check (
    case role
      when 'admin' then region is null
      when 'course_team' then region is not null
      when 'registration_team' then true
    end
  );

-- 場地名稱、地址不是個資，工作人員都讀得到（含舊年度）：
-- 報報組看得到該區支聯會報名別區教堂的報名，名單要顯示那個場地的名稱。
-- 原本總管理員讀全部的這條包含在下面這條裡。
drop policy "Admins can read all venues" on public.venues;

create policy "Staff can read all venues"
  on public.venues for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

/*
 * 後台報名名單的範圍（ADR 0004）。只開放讀取，課務組與報報組都改不了任何資料。
 * - 總管理員、全區的報報組：全部。
 * - 課務組、報報組：報名該區教堂的報名。
 * - 報報組另外讀得到該區支聯會的姐妹報名別區教堂的報名。
 * 總管理員的 region 是空值，比較結果不成立，不會因為下面兩條多讀到什麼（她本來就讀全部）。
 */
create policy "Staff can read registrations in their scope"
  on public.registrations for select
  to authenticated
  using (
    (select public.is_staff_admin())
    or exists (
      select 1
      from public.staff_members s
      where s.user_id = (select auth.uid())
        and (
          (s.role = 'registration_team' and s.region is null)
          or s.region = (select v.region from public.venues v where v.id = venue_id)
          or (s.role = 'registration_team' and s.region = (select st.region from public.stakes st where st.id = stake_id))
        )
    )
  );

-- 課務組看得到該區教堂課程的教室；報報組看不到。
create policy "Course team can read classrooms in their region"
  on public.course_classrooms for select
  to authenticated
  using (
    exists (
      select 1
      from public.courses c
      join public.sessions se on se.id = c.session_id
      join public.venues v on v.id = se.venue_id
      join public.staff_members s on s.region = v.region
      where c.id = course_id
        and s.user_id = (select auth.uid())
        and s.role = 'course_team'
    )
  );

-- 角色與範圍要相符。不符合時丟出 scope_invalid。
create function public.check_staff_scope(p_role text, p_region text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_role is null or p_role not in ('admin', 'course_team', 'registration_team')
    or (p_region is not null and p_region not in ('north', 'central', 'south'))
    or (p_role = 'admin' and p_region is not null)
    or (p_role = 'course_team' and p_region is null)
  then
    raise exception 'scope_invalid';
  end if;
end;
$$;

revoke all on function public.check_staff_scope from public, anon, authenticated;

-- 工作人員名單，含登入 Email。只有總管理員能看。
create function public.list_staff_members()
returns table (
  user_id uuid,
  email text,
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
    select s.user_id, u.email::text, s.role, s.region, s.created_at, u.last_sign_in_at
    from public.staff_members s
    join auth.users u on u.id = s.user_id
    order by s.created_at, u.email;
end;
$$;

revoke all on function public.list_staff_members from public, anon;
grant execute on function public.list_staff_members to authenticated;

-- 新增工作人員。排隊、帳號鎖定的理由見 20261020000000_staff_members.sql。
create function public.add_staff_member(p_email text, p_role text, p_region text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  perform public.lock_staff_members();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  perform public.check_staff_scope(p_role, p_region);

  select id into v_user_id
  from auth.users
  where lower(email) = lower(public.trim_blank(p_email)) and deleted_at is null
  for share;
  if v_user_id is null then
    raise exception 'account_missing';
  end if;

  begin
    insert into public.staff_members (user_id, role, region)
    values (v_user_id, p_role, p_region);
  exception when unique_violation then
    raise exception 'already_staff';
  end;

  return v_user_id;
end;
$$;

revoke all on function public.add_staff_member from public, anon;
grant execute on function public.add_staff_member to authenticated;

-- 修改工作人員的角色與負責範圍。總管理員改成其他角色時，要還有別的總管理員。
create function public.update_staff_member(p_user_id uuid, p_role text, p_region text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_staff_members();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  perform public.check_staff_scope(p_role, p_region);

  if p_role <> 'admin' then
    perform public.ensure_another_admin(p_user_id);
  end if;

  update public.staff_members
  set role = p_role, region = p_region, updated_at = now()
  where user_id = p_user_id;
  if not found then
    raise exception 'staff_not_found';
  end if;
end;
$$;

revoke all on function public.update_staff_member from public, anon;
grant execute on function public.update_staff_member to authenticated;
