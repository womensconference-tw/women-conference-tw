-- 年度管理（#25）：複製去年建立新年度、切換目前年度、後台檢視舊年度。只有總管理員能複製與切換（ADR 0004）。

create extension if not exists "uuid-ossp" with schema extensions;

/*
 * 場地的固定識別：同一間教堂在每個年度各有一筆場地資料（編號不同），但固定識別相同。
 * 複製新年度時沿用，支聯會的預設場地（#23）以它對應，跨區標記（#24）在新年度不必重設。
 * 後台新增的場地是另一間教堂，給新的識別。
 */
alter table public.venues
  add column site_key uuid not null default gen_random_uuid(),
  add constraint venues_site_key_once_per_conference unique (conference_id, site_key);

-- 後台的年度選單：課務組、報報組也要能選舊年度看名單。年度大會本身沒有個資。
-- 原本總管理員讀全部的這條包含在下面這條裡。
drop policy "Admins can read all conferences" on public.conferences;

create policy "Staff can read all conferences"
  on public.conferences for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

/*
 * 複製一個年度大會，建立新的年度（GLOSSARY「年度大會」）。
 * 複製內容欄位、場地、場次、課程（含名額與教室）、成對課程、午餐、午后動態、常見問題、自訂區塊；
 * 不複製報名與寄信紀錄；三個時程時間點空著待填，也不是目前年度。之後新增屬於年度的資料時，要記得加在這裡。
 *
 * 整個複製是一句 SQL，從同一個時間點的資料讀出，複製到一半有人改課程也不會只複製到一部分。
 * 新資料的編號由新年度的編號和原本的編號算出（uuid v5），同一句裡的場次、課程、成對課程才對得上。
 * 新年度還沒開放報名，課程安排的限制（sessions_locked_after_opening 等）照樣通過。
 * 新增年度大會沒有權限規則，所以以擁有者的權限執行，自己確認是總管理員。
 */
create function public.copy_conference(p_source_id uuid, p_year integer, p_conference_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_source_id) then
    raise exception 'not_found';
  end if;

  with
    conference as (
      insert into public.conferences (
        id, year, conference_date, start_time, end_time,
        theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
        welcome_zh, welcome_en, admin_line_id
      )
      select v_id, p_year, p_conference_date, start_time, end_time,
        theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
        welcome_zh, welcome_en, admin_line_id
      from public.conferences
      where id = p_source_id
    ),
    venues as (
      insert into public.venues (
        id, conference_id, site_key, position, region, name_zh, name_en, address_zh, address_en, features_zh, features_en
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, site_key, position, region,
        name_zh, name_en, address_zh, address_en, features_zh, features_en
      from public.venues
      where conference_id = p_source_id
    ),
    sessions as (
      insert into public.sessions (id, conference_id, venue_id, position, name_zh, name_en)
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        position, name_zh, name_en
      from public.sessions
      where conference_id = p_source_id
    ),
    courses as (
      insert into public.courses (
        id, conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, session_id::text),
        position, title_zh, title_en, description_zh, description_en, capacity
      from public.courses
      where conference_id = p_source_id
    ),
    classrooms as (
      insert into public.course_classrooms (course_id, classroom)
      select extensions.uuid_generate_v5(v_id, cc.course_id::text), cc.classroom
      from public.course_classrooms cc
      join public.courses c on c.id = cc.course_id
      where c.conference_id = p_source_id
    ),
    pairs as (
      insert into public.course_pairs (conference_id, first_course_id, second_course_id)
      select v_id, extensions.uuid_generate_v5(v_id, first_course_id::text),
        extensions.uuid_generate_v5(v_id, second_course_id::text)
      from public.course_pairs
      where conference_id = p_source_id
    ),
    lunches as (
      insert into public.lunch_options (
        id, conference_id, venue_id, position, name_zh, name_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        position, name_zh, name_en, description_zh, description_en, capacity
      from public.lunch_options
      where conference_id = p_source_id
    ),
    activities as (
      insert into public.afternoon_activities (
        id, conference_id, venue_id, position, title_zh, title_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        position, title_zh, title_en, description_zh, description_en, capacity
      from public.afternoon_activities
      where conference_id = p_source_id
    ),
    faqs as (
      insert into public.faqs (conference_id, position, question_zh, question_en, answer_zh, answer_en)
      select v_id, position, question_zh, question_en, answer_zh, answer_en
      from public.faqs
      where conference_id = p_source_id
    )
  insert into public.custom_blocks (
    conference_id, position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url
  )
  select v_id, position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url
  from public.custom_blocks
  where conference_id = p_source_id;

  return v_id;
end;
$$;

revoke all on function public.copy_conference from public, anon;
grant execute on function public.copy_conference to authenticated;

/*
 * 把一個年度設為目前年度（前台正在顯示、接受報名的那一個），原本的目前年度改為舊年度，資料都保留。
 * 目前年度的時程一定要填完整（conferences_current_schedule_complete），所以時程還空著的時間點用參數補上；
 * 已經填了的不動（報名開放時間到了之後本來就不能改），之後在首頁內容頁修改。
 *
 * 排隊做：兩位總管理員同時切換到不同年度時，後到的等先到的做完，再讀一次誰是目前年度，不會撞在一起。
 * 首頁內容的編輯鎖住目前年度那一列（lock_current_conference），切換要改那一列，所以會等編輯做完；
 * 編輯在切換之後才輪到的話，重新檢查時已經不是目前年度，不會改到舊年度。
 * 不能直接改 is_current（見 20261027000000_content_editing.sql），所以以擁有者的權限執行，自己確認是總管理員。
 */
create function public.set_current_conference(
  p_conference_id uuid,
  p_announce_at timestamptz,
  p_registration_opens_at timestamptz,
  p_registration_closes_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('set_current_conference', 0));
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  update public.conferences
  set announce_at = coalesce(announce_at, p_announce_at),
    registration_opens_at = coalesce(registration_opens_at, p_registration_opens_at),
    registration_closes_at = coalesce(registration_closes_at, p_registration_closes_at),
    updated_at = now()
  where id = p_conference_id
    and (announce_at is null or registration_opens_at is null or registration_closes_at is null);

  update public.conferences
  set is_current = false, updated_at = now()
  where is_current and id <> p_conference_id;

  update public.conferences
  set is_current = true, updated_at = now()
  where id = p_conference_id and not is_current;
end;
$$;

revoke all on function public.set_current_conference from public, anon;
grant execute on function public.set_current_conference to authenticated;
