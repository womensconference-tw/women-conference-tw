-- 後台編輯場地、場次、課程、成對課程、午后動態與午餐（#22）。只有總管理員能寫入，由下面的權限規則強制（ADR 0004）。
-- 新增、刪除與換時段在報名開放後一律被擋下（sessions_locked_after_opening 等），所以這裡不必再分時段。
-- 有人選過的選項（包括已取消的報名）被報名資料的外鍵擋下，不能刪除；後台把這個錯誤說明給總管理員看。

create policy "Admins can manage venues"
  on public.venues for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage sessions"
  on public.sessions for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage courses"
  on public.courses for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage course pairs"
  on public.course_pairs for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage lunch options"
  on public.lunch_options for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage afternoon activities"
  on public.afternoon_activities for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 成對課程的檢查（course_pairs_valid）不開放直接呼叫，原本只有秘密金鑰寫得進來。
-- 總管理員改成對課程、課程換場次時，觸發器要能呼叫它，所以觸發器以擁有者的權限執行；
-- 觸發器函式本身不能從 API 呼叫，不會因此多開放什麼。
alter function public.course_pairs_checked() security definer;
alter function public.course_pairs_valid_after_course_move() security definer;
alter function public.course_pairs_valid_after_session_move() security definer;

/*
 * 午餐、午后動態和場次、課程一樣在報名開放前定案（ADR 0004）：開放之後不能新增、刪除，
 * 也不能換編號或換到別的場地、年度；只能修正文字、調整名額與排序。
 * 規則與時間的判斷方式見 20261014000000_sessions_courses.sql 的 sessions_locked_after_opening。
 * 兩張表都有 venue_id 與 conference_id，共用一個函式。
 */
create function public.venue_options_locked_after_opening()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.venue_id = old.venue_id
    and new.conference_id = old.conference_id
  then
    return new;
  end if;
  if (tg_op <> 'DELETE' and public.registration_opened(new.conference_id))
    or (tg_op <> 'INSERT' and public.registration_opened(old.conference_id))
  then
    raise exception 'programme_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create constraint trigger lunch_options_locked_after_opening
  after insert or update or delete on public.lunch_options
  deferrable initially deferred
  for each row execute function public.venue_options_locked_after_opening();

create constraint trigger afternoon_activities_locked_after_opening
  after insert or update or delete on public.afternoon_activities
  deferrable initially deferred
  for each row execute function public.venue_options_locked_after_opening();

/*
 * 場地也一樣：報名開放後不能新增、刪除或換到別的年度，只能修正名稱、地址、特色與排序。
 * 新增的場地沒有場次與課程（也加不了），報名者卻選得到；刪掉的場地會讓正在填表的人送出時被拒。
 */
create function public.venues_locked_after_opening()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.conference_id = old.conference_id then
    return new;
  end if;
  if (tg_op <> 'DELETE' and public.registration_opened(new.conference_id))
    or (tg_op <> 'INSERT' and public.registration_opened(old.conference_id))
  then
    raise exception 'programme_locked';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create constraint trigger venues_locked_after_opening
  after insert or update or delete on public.venues
  deferrable initially deferred
  for each row execute function public.venues_locked_after_opening();

/*
 * 教室（GLOSSARY「教室」）：課程上課的房間，屬於內部資料，報名期間不公開。
 * 放在另一張表、不放在 courses，前台訪客對這張表沒有任何權限，怎麼查都讀不到。
 * 總管理員隨時可以換教室（包括報名開放後）；沒填教室的課程沒有資料列。
 */
create table public.course_classrooms (
  course_id uuid primary key references public.courses (id) on delete cascade,
  classroom text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint course_classrooms_classroom_valid check (
    classroom ~ '[^[:space:]]' and char_length(classroom) <= 50
  )
);

alter table public.course_classrooms enable row level security;

revoke all on public.course_classrooms from anon;

create policy "Admins can manage course classrooms"
  on public.course_classrooms for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 教堂承辦看得到自己場地課程的教室（報名中幫課程換教室見 #33）。
create policy "Venue staff can read classrooms of their venue"
  on public.course_classrooms for select
  to authenticated
  using (
    exists (
      select 1
      from public.courses c
      join public.sessions s on s.id = c.session_id
      where c.id = course_id
        and s.venue_id = (select venue_id from public.staff_members where user_id = (select auth.uid()))
    )
  );

/*
 * 成對課程要在連續的兩個場次（GLOSSARY「成對課程」）：同場地、不同場次之外，
 * 依排序（相同時依 id，和報名表一樣）兩個場次中間不能夾著別的場次。其餘規則與排隊方式見 20261018000000_course_pairs.sql。
 */
create or replace function public.course_pairs_valid(p_conference_ids uuid[], p_course_ids uuid[])
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
      and (
        sa.venue_id <> sb.venue_id
        or sa.id = sb.id
        or exists (
          select 1 from public.sessions s
          where s.venue_id = sa.venue_id
            and (
              ((s.position, s.id) > (sa.position, sa.id) and (s.position, s.id) < (sb.position, sb.id))
              or ((s.position, s.id) > (sb.position, sb.id) and (s.position, s.id) < (sa.position, sa.id))
            )
        )
      )
  ) or exists (
    select 1
    from unnest(p_course_ids) as course(id)
    where (select count(*) from public.course_pairs p where course.id in (p.first_course_id, p.second_course_id)) > 1
  ) then
    raise exception 'course_pair_invalid';
  end if;
end;
$$;

/*
 * 開放報名前新增場次、把場次搬到別的場地、或改場次的排序時，可能讓場地裡原有的成對課程不再連續，
 * 所以重新檢查新的場地裡所有課程。搬走的場次自己的成對課程由 course_pairs_valid_after_session_move 檢查。
 * 報名開放後不能新增或搬動場次；改排序只影響顯示順序，不再檢查（檢查本身在開放後會丟出 programme_locked）。
 */
create function public.course_pairs_valid_after_session_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.position = old.position and new.venue_id = old.venue_id then
    return new;
  end if;
  if public.registration_opened(new.conference_id) then
    return new;
  end if;
  perform public.course_pairs_valid(
    array[new.conference_id],
    array(
      select c.id from public.courses c join public.sessions s on s.id = c.session_id where s.venue_id = new.venue_id
    )
  );
  return new;
end;
$$;

create constraint trigger course_pairs_valid_after_session_change
  after insert or update of position, venue_id on public.sessions
  deferrable initially deferred
  for each row execute function public.course_pairs_valid_after_session_change();

/*
 * 新增或修改課程，連同教室在同一個交易裡存好：教室存不了時課程也不存，不會留下沒有教室的新課程，
 * 總管理員重送時也不會多出一門一樣的課。以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 * p_id 空值是新增；修改時 p_session_id 空值表示不換場次。p_classroom 空值表示清掉教室。
 */
create function public.save_course(
  p_id uuid,
  p_conference_id uuid,
  p_session_id uuid,
  p_position integer,
  p_title_zh text,
  p_title_en text,
  p_description_zh text,
  p_description_en text,
  p_capacity integer,
  p_classroom text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.courses (
      conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity
    ) values (
      p_conference_id, p_session_id, p_position, p_title_zh, p_title_en, p_description_zh, p_description_en, p_capacity
    )
    returning id into v_id;
  else
    update public.courses
    set session_id = coalesce(p_session_id, session_id),
      position = p_position,
      title_zh = p_title_zh,
      title_en = p_title_en,
      description_zh = p_description_zh,
      description_en = p_description_en,
      capacity = p_capacity,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    -- 不存在、或呼叫者看不到（不是總管理員、不是目前年度）。
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  if p_classroom is null then
    delete from public.course_classrooms where course_id = v_id;
  else
    insert into public.course_classrooms (course_id, classroom)
    values (v_id, p_classroom)
    on conflict (course_id) do update set classroom = excluded.classroom, updated_at = now();
  end if;

  -- 權限規則讓非總管理員的寫入找不到資料、不會出錯。等課程的列鎖時被移出工作人員名單的話，
  -- 課程照舊更新、教室卻刪不到，所以最後再確認一次，不是總管理員就整筆不存。
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_course from public, anon;
grant execute on function public.save_course to authenticated;
