-- 成對課程：跨越連續兩個場次的課程，選了其中一堂就必須選另一堂；其中一堂額滿時兩堂都不能選。

-- 讓成對課程用（課程, 年度大會）一起參照，保證兩堂都屬於這個年度大會。
alter table public.courses add constraint courses_id_conference_id unique (id, conference_id);

-- 一組成對課程。兩堂沒有先後之分，first、second 只是兩個欄位的名字；
-- 依場次排序，first 通常是前一個場次的那堂。每門課最多屬於一組（見 course_pairs_valid）。
create table public.course_pairs (
  conference_id uuid not null references public.conferences (id) on delete cascade,
  first_course_id uuid primary key,
  second_course_id uuid not null unique,
  created_at timestamptz not null default now(),

  constraint course_pairs_first_in_conference
    foreign key (first_course_id, conference_id) references public.courses (id, conference_id) on delete cascade,
  constraint course_pairs_second_in_conference
    foreign key (second_course_id, conference_id) references public.courses (id, conference_id) on delete cascade,
  constraint course_pairs_distinct check (first_course_id <> second_course_id)
);

alter table public.course_pairs enable row level security;

-- 前台要知道哪兩堂成對，才能一起選；和課程一樣只讀得到目前年度的。
create policy "Anyone can read course pairs of the current conference"
  on public.course_pairs for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

-- 某門課成對的另一堂；不是成對課程時是空值。
create function public.paired_course(p_course_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case when p.first_course_id = p_course_id then p.second_course_id else p.first_course_id end
  from public.course_pairs p
  where p_course_id in (p.first_course_id, p.second_course_id)
$$;

revoke all on function public.paired_course from public, anon, authenticated;

/*
 * 成對課程必須是同一場地、不同場次的兩堂課，而且每門課最多屬於一組。
 * 不然報名時永遠選不齊（同一場次只能選一門），或一堂課會連帶另外兩堂。
 * 新增、修改成對課程時檢查；課程換場次、場次換場地（只有開放報名前可以）時，也檢查牽涉到的那組。
 * 和定案規則一樣在交易提交時才檢查，同一個交易裡可以先調好課程再建成對。
 *
 * 這個檢查排隊做（鎖到交易結束）：兩人同時修改時，各自只看得到自己的修改，
 * 例如同時把同一堂課設進兩組、同時把成對的兩堂移到同一個場次，兩邊都會通過。
 * 排隊後，後到的等先到的提交，再重新讀一次（每個查詢都看得到已提交的資料），就會看到對方的修改。
 * 所有年度共用同一個鎖：每個年度各一個鎖的話，一次改兩個年度、順序相反的兩個交易會互相等待。
 * 成對課程只有管理員在開放報名前設定，很少同時發生，共用一個鎖不會讓誰等太久；報名不會碰這個鎖。
 *
 * 這些修改都只能在報名開放前做，所以也在這裡擋下已開放的年度（p_conference_ids，programme_locked）。
 * 一定要在拿到鎖之後才看時間：開放前開始排隊、等到開放後才輪到的修改，也要擋下。
 */
create function public.course_pairs_valid(p_conference_ids uuid[], p_course_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('course_pairs_valid', 0));

  if exists (select 1 from unnest(p_conference_ids) as conference(id) where public.registration_opened(conference.id)) then
    raise exception 'programme_locked';
  end if;

  if exists (
    select 1
    from public.course_pairs p
    join public.courses a on a.id = p.first_course_id
    join public.sessions sa on sa.id = a.session_id
    join public.courses b on b.id = p.second_course_id
    join public.sessions sb on sb.id = b.session_id
    where (p.first_course_id = any(p_course_ids) or p.second_course_id = any(p_course_ids))
      and (sa.venue_id <> sb.venue_id or sa.id = sb.id)
  ) or exists (
    select 1
    from unnest(p_course_ids) as course(id)
    where (select count(*) from public.course_pairs p where course.id in (p.first_course_id, p.second_course_id)) > 1
  ) then
    raise exception 'course_pair_invalid';
  end if;
end;
$$;

revoke all on function public.course_pairs_valid from public, anon, authenticated;

-- 成對關係也是課程安排的一部分：報名開放之後不能新增、刪除或換成別的課，
-- 不然已經報名的人會只剩其中一堂，或少了必須一起選的那堂。刪除整個年度大會時不受限制。
create function public.course_pairs_checked()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.first_course_id = old.first_course_id
    and new.second_course_id = old.second_course_id and new.conference_id = old.conference_id
  then
    return new;
  end if;
  if tg_op = 'INSERT' then
    perform public.course_pairs_valid(array[new.conference_id], array[new.first_course_id, new.second_course_id]);
    return new;
  elsif tg_op = 'UPDATE' then
    perform public.course_pairs_valid(
      array[new.conference_id, old.conference_id], array[new.first_course_id, new.second_course_id]
    );
    return new;
  end if;
  -- 刪除：剩下的成對不受影響，只要確認還沒開放。
  perform public.course_pairs_valid(array[old.conference_id], '{}');
  return old;
end;
$$;

create constraint trigger course_pairs_checked
  after insert or update or delete on public.course_pairs
  deferrable initially deferred
  for each row execute function public.course_pairs_checked();

-- 課程換場次時，它所屬的那組仍要在同一場地的不同場次。只是重新存一次、沒有換場次時不必檢查。
create function public.course_pairs_valid_after_course_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id = old.session_id and new.conference_id = old.conference_id then
    return new;
  end if;
  perform public.course_pairs_valid(array[new.conference_id, old.conference_id], array[new.id]);
  return new;
end;
$$;

create constraint trigger course_pairs_valid_after_course_move
  after update of session_id, conference_id on public.courses
  deferrable initially deferred
  for each row execute function public.course_pairs_valid_after_course_move();

-- 場次換場地時，這個場次裡的成對課程仍要和另一堂在同一場地。只是重新存一次、沒有換場地時不必檢查。
create function public.course_pairs_valid_after_session_move()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.venue_id = old.venue_id and new.conference_id = old.conference_id then
    return new;
  end if;
  perform public.course_pairs_valid(
    array[new.conference_id, old.conference_id],
    array(select id from public.courses where session_id = new.id)
  );
  return new;
end;
$$;

create constraint trigger course_pairs_valid_after_session_move
  after update of venue_id, conference_id on public.sessions
  deferrable initially deferred
  for each row execute function public.course_pairs_valid_after_session_move();

/*
 * 目前年度已額滿的課程，給選課畫面標示「已額滿」。只透露是否額滿，不透露報名資料。
 * 成對課程其中一堂額滿時，兩堂都標成額滿（兩堂一起選，另一堂也選不了）。
 */
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
    where c.capacity is not null and public.course_seats_taken(c.id) >= c.capacity
  )
  select id from full_course
  union
  select partner from full_course, public.paired_course(id) as partner where partner is not null
$$;

/*
 * 送出與修改報名共用的選項檢查，規則見 20261017000000_update_registration.sql，多了成對課程：
 * - 選了成對課程其中一堂，另一堂也要選，不然丟出 course_pair_incomplete；不可能只報到其中一堂。
 * - 其中一堂額滿時，兩堂都列在額滿的選項裡，報名表把兩堂都標成已額滿。
 * 成對關係在報名開放後不會變（見 course_pairs_checked），所以鎖住所選課程就夠了。
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

  -- 成對課程其中一堂額滿時，另一堂（她一定也選了）一起列出。
  with full_course as (
    select id from public.courses
    where id = any(p_course_ids) and capacity is not null and public.course_seats_taken(id) >= capacity
      and id <> all(p_held_ids)
  )
  select array_agg(id) into v_full
  from (
    select id from full_course
    union
    select partner from full_course, public.paired_course(id) as partner where partner is not null
    union all
    select id from public.lunch_options
    where id = p_lunch_option_id and capacity is not null and public.lunch_seats_taken(id) >= capacity
      and id <> all(p_held_ids)
    union all
    select id from public.afternoon_activities
    where id = p_afternoon_activity_id and capacity is not null
      and public.afternoon_activity_seats_taken(id) >= capacity
      and id <> all(p_held_ids)
  ) as full_choices;
  if v_full is not null then
    if exists (select 1 from public.courses where id = any(v_full)) then
      raise exception 'course_full' using detail = array_to_string(v_full, ',');
    end if;
    raise exception 'choice_full' using detail = array_to_string(v_full, ',');
  end if;
end;
$$;
