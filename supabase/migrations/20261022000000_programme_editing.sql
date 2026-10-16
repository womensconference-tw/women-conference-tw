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
