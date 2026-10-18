-- 停止報名（#33，GLOSSARY「停止報名」、ADR 0006）：總管理員把某門課程、某個午餐或午后動態單獨關閉，隨時都可以。

/*
 * 停止和名額是兩件事：停止時不論名額是否「不限」、有沒有空位都不能新選；重新開放後仍要通過名額檢查。
 * 有人取消或名額調高都不會自動重新開放，只有總管理員按「重新開放」才會。
 * 前台把停止的選項顯示為「已額滿」，送出時也視同額滿（course_full、choice_full），她原本已佔的位子保留。
 *
 * 只有總管理員改得了：課程、午餐、午后動態的寫入本來就只限總管理員（20261022000000_programme_editing.sql）。
 * 報名開放後的定案規則只擋新增、刪除與換時段，停止、重新開放和調整名額一樣不受影響。
 * 複製到新年度時不帶過去（copy_conference 沒有列這一欄），新年度一律從開放開始。
 */
alter table public.courses add column registration_stopped boolean not null default false;
alter table public.lunch_options add column registration_stopped boolean not null default false;
alter table public.afternoon_activities add column registration_stopped boolean not null default false;

/*
 * 成對課程的兩堂一起停止、一起重新開放（GLOSSARY「成對課程」）。在交易提交時確認兩堂一致：
 * 只改到其中一堂的寫入（例如直接呼叫 API 只改一堂），或把一堂已停止、一堂沒停止的兩門課設成一組，
 * 整筆不算數，丟出 course_pair_stopped_apart。讀提交當下的值，同一個交易裡改了好幾次也是看最後的結果。
 * 以擁有者的權限讀成對關係。
 *
 * 和設定成對課程排同一個隊（course_pairs_valid 的鎖）：同時有人把這門課設成一組、有人停止它時，
 * 後到的等先到的提交，再讀到對方的修改，不會兩邊都通過、留下一堂停止一堂沒停止的一組。
 */
create function public.course_pairs_stopped_together()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('course_pairs_valid', 0));
  -- 兩張表的欄位不同，分開寫：plpgsql 執行到哪一句才讀哪個欄位。
  if tg_table_name = 'course_pairs' then
    v_course_id := new.first_course_id;
  else
    v_course_id := new.id;
  end if;
  if exists (
    select 1
    from public.courses c
    join public.courses partner on partner.id = public.paired_course(c.id)
    where c.id = v_course_id and partner.registration_stopped <> c.registration_stopped
  ) then
    raise exception 'course_pair_stopped_apart';
  end if;
  return new;
end;
$$;

create constraint trigger course_pairs_stopped_together
  after update of registration_stopped on public.courses
  deferrable initially deferred
  for each row execute function public.course_pairs_stopped_together();

create constraint trigger course_pairs_stopped_together
  after insert or update on public.course_pairs
  deferrable initially deferred
  for each row execute function public.course_pairs_stopped_together();

/*
 * 停止或重新開放一個選項（p_kind：course 課程、lunch 午餐、activity 午后動態）。課程是成對課程時，兩堂一起改。
 * 和送出報名搶同一把鎖（ADR 0006）：送出報名鎖住所選的課程、午餐、午后動態再數名額，這裡也鎖住同樣的列。
 * 停止先完成時，之後才拿到鎖的送出看到已停止，被拒；送出先拿到鎖時，這裡等它寫完，她保留位子。
 * 課程依 id 順序上鎖，和送出報名一樣，不會互相卡住（送出報名不碰成對課程的排隊鎖）。
 * 不符合時丟出代碼：不是總管理員 not_admin；找不到、不是目前年度、種類不認得 not_found。
 */
create function public.set_registration_stopped(p_kind text, p_id uuid, p_stopped boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_count integer;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if p_stopped is null then
    raise exception 'not_found';
  end if;

  if p_kind = 'course' then
    -- 先排設定成對課程的隊再讀成對的另一堂，同時有人把它設成一組時也讀得到（見 course_pairs_stopped_together）。
    perform pg_advisory_xact_lock(hashtextextended('course_pairs_valid', 0));
    v_ids := array_remove(array[p_id, public.paired_course(p_id)], null);
    perform 1 from public.courses where id = any(v_ids) order by id for update;
    update public.courses c
    set registration_stopped = p_stopped, updated_at = now()
    from public.conferences cf
    where c.id = any(v_ids) and cf.id = c.conference_id and cf.is_current;
  elsif p_kind = 'lunch' then
    update public.lunch_options l
    set registration_stopped = p_stopped, updated_at = now()
    from public.conferences cf
    where l.id = p_id and cf.id = l.conference_id and cf.is_current;
  elsif p_kind = 'activity' then
    update public.afternoon_activities a
    set registration_stopped = p_stopped, updated_at = now()
    from public.conferences cf
    where a.id = p_id and cf.id = a.conference_id and cf.is_current;
  else
    raise exception 'not_found';
  end if;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'not_found';
  end if;

  -- 等鎖的期間被移出工作人員名單的話，整筆不算數（和 save_course 一樣）。
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
end;
$$;

revoke all on function public.set_registration_stopped from public, anon;
grant execute on function public.set_registration_stopped to authenticated;

-- 目前年度已額滿或已停止報名的課程，給選課畫面標示「已額滿」。成對課程其中一堂是的話，兩堂都列出。
create or replace function public.full_courses()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with full_course as (
    select c.id
    from public.courses c
    join public.conferences cf on cf.id = c.conference_id and cf.is_current
    where c.registration_stopped
      or (c.capacity is not null and public.course_seats_taken(c.id) >= c.capacity)
  )
  select id from full_course
  union
  select partner from full_course, public.paired_course(id) as partner where partner is not null
$$;

-- 目前年度已額滿或已停止報名的午餐與午后動態，給報名表標示「已額滿」。
create or replace function public.full_lunch_options()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.lunch_options l
  join public.conferences cf on cf.id = l.conference_id and cf.is_current
  where l.registration_stopped
    or (l.capacity is not null and public.lunch_seats_taken(l.id) >= l.capacity)
$$;

create or replace function public.full_afternoon_activities()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.afternoon_activities a
  join public.conferences cf on cf.id = a.conference_id and cf.is_current
  where a.registration_stopped
    or (a.capacity is not null and public.afternoon_activity_seats_taken(a.id) >= a.capacity)
$$;

/*
 * 送出與修改報名共用的選項檢查，和 20261018000000_course_pairs.sql 的版本相同，只多了停止報名：
 * 已停止的選項和額滿一樣列在 detail 裡，丟出 course_full 或 choice_full。
 * 成對課程補列的另一堂也不列她原本已佔的。
 * 她原本已佔的（p_held_ids）不受停止影響；後台確認過的（帶了確認旗標，所選的都算在 p_held_ids）也一樣。
 * 停止的狀態在鎖住選項之後才讀，所以停止先完成時，等鎖的送出讀到的是已停止。
 */
create or replace function public.check_registration_choices(
  p_conference_id uuid,
  p_venue_id uuid,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_held_ids uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_full uuid[];
begin
  if not exists (
    select 1 from public.venues where id = p_venue_id and conference_id = p_conference_id
  ) then
    raise exception 'venue_invalid';
  end if;

  -- 固定先課程（依 id 順序）、再午餐、再午后動態，不會互相卡住。
  -- 報名期間場次與課程不能增刪或換時段（見 sessions_locked_after_opening），所以不必防範這些變動。
  perform 1 from public.courses where id = any(p_course_ids) order by id for update;
  perform 1 from public.lunch_options where id = p_lunch_option_id for update;
  perform 1 from public.afternoon_activities where id = p_afternoon_activity_id for update;

  -- 每門課都要在所選場地，同一場次只能一門（重複的同一門也算）。修改時換了場地卻送來舊場地的課，也在這裡擋下。
  -- 沒選課的場次就是「不選課」，所以不檢查每個場次都有選；漏選由報名表在選課步驟提醒。
  if exists (
      select 1 from unnest(p_course_ids) as selected(id)
      where not exists (
        select 1
        from public.courses c
        join public.sessions s on s.id = c.session_id
        where c.id = selected.id and s.venue_id = p_venue_id
      )
    )
    or cardinality(p_course_ids) <> (
      select count(distinct session_id) from public.courses where id = any(p_course_ids)
    )
  then
    raise exception 'courses_invalid';
  end if;

  -- 成對課程要兩堂都選，或兩堂都不選。
  if exists (
    select 1 from public.course_pairs p
    where (p.first_course_id = any(p_course_ids)) <> (p.second_course_id = any(p_course_ids))
  ) then
    raise exception 'course_pair_incomplete';
  end if;

  if p_lunch_option_id is not null and not exists (
    select 1 from public.lunch_options where id = p_lunch_option_id and venue_id = p_venue_id
  ) then
    raise exception 'lunch_invalid';
  end if;

  if p_afternoon_activity_id is not null and not exists (
    select 1 from public.afternoon_activities where id = p_afternoon_activity_id and venue_id = p_venue_id
  ) then
    raise exception 'afternoon_activity_invalid';
  end if;

  -- 成對課程其中一堂額滿或停止時，另一堂（她一定也選了）一起列出。
  with full_course as (
    select id from public.courses
    where id = any(p_course_ids) and id <> all(p_held_ids)
      and (registration_stopped or (capacity is not null and public.course_seats_taken(id) >= capacity))
  )
  select array_agg(id) into v_full
  from (
    select id from full_course
    union
    -- 她原本已佔的那堂不列出（兩堂一起停止，正常不會只佔一堂）。
    select partner from full_course, public.paired_course(id) as partner
    where partner is not null and partner <> all(p_held_ids)
    union all
    select id from public.lunch_options
    where id = p_lunch_option_id and id <> all(p_held_ids)
      and (registration_stopped or (capacity is not null and public.lunch_seats_taken(id) >= capacity))
    union all
    select id from public.afternoon_activities
    where id = p_afternoon_activity_id and id <> all(p_held_ids)
      and (
        registration_stopped
        or (capacity is not null and public.afternoon_activity_seats_taken(id) >= capacity)
      )
  ) as full_choices;
  if v_full is not null then
    if exists (select 1 from public.courses where id = any(v_full)) then
      raise exception 'course_full' using detail = array_to_string(v_full, ',');
    end if;
    raise exception 'choice_full' using detail = array_to_string(v_full, ',');
  end if;
end;
$$;
