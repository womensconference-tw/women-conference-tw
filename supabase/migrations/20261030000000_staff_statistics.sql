-- 後台統計（#19）：只計有效報名，範圍和報名名單一樣由 registrations 的權限規則決定（ADR 0004），不另外判斷。

-- 場次、課程、午餐、午后動態不是個資，工作人員都讀得到（含舊年度），統計頁才列得出名稱與容量。
-- 教室在另一張表（course_classrooms），報報組照樣讀不到；課務組的權限規則透過課程找場地的區，
-- 所以從此也讀得到該區教堂舊年度課程的教室（GLOSSARY「教室」：該區的課務組看得到，不分年度）。
create policy "Staff can read all sessions"
  on public.sessions for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read all courses"
  on public.courses for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read all lunch options"
  on public.lunch_options for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read all afternoon activities"
  on public.afternoon_activities for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

-- 所選課程跟著報名的範圍：讀得到那筆報名，才讀得到她選的課。只開放讀取。
grant select on public.registration_courses to authenticated;

create policy "Staff can read course choices of registrations in their scope"
  on public.registration_courses for select
  to authenticated
  using (exists (select 1 from public.registrations r where r.id = registration_id));

/*
 * 某個年度大會的有效報名（未取消）人數，依項目分組：
 * total 全體、venue 場地、stake 支聯會、ward 支會、course 課程、lunch 午餐、activity 午后動態、
 * choir 唱詩班聲部、service 其他服務意願、handbook 要紙本手冊。key 是場地等的 id 或代碼。
 * 以呼叫者的權限執行，只數得到她讀得到的報名；不是工作人員的帳號一筆也數不到。
 */
create function public.registration_counts(p_conference_id uuid)
returns table (kind text, key text, count integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with r as (
    select *
    from public.registrations
    where conference_id = p_conference_id and status = 'registered'
  )
  select 'total', null, count(*)::integer from r
  union all
  select 'venue', venue_id::text, count(*)::integer from r group by venue_id
  union all
  select 'stake', stake_id::text, count(*)::integer from r group by stake_id
  union all
  select 'ward', ward_id::text, count(*)::integer from r group by ward_id
  union all
  select 'course', rc.course_id::text, count(*)::integer
  from r join public.registration_courses rc on rc.registration_id = r.id
  group by rc.course_id
  union all
  select 'lunch', lunch_option_id::text, count(*)::integer from r where lunch_option_id is not null group by lunch_option_id
  union all
  select 'activity', afternoon_activity_id::text, count(*)::integer
  from r where afternoon_activity_id is not null group by afternoon_activity_id
  union all
  select 'choir', choir_part, count(*)::integer from r where choir_part is not null group by choir_part
  union all
  select 'service', service, count(*)::integer from r, unnest(r.services) as service group by service
  union all
  select 'handbook', null, count(*)::integer from r where printed_handbook
$$;

revoke all on function public.registration_counts from public, anon;
grant execute on function public.registration_counts to authenticated;
