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
 *
 * 排序數字依原本的顯示順序（排序相同時依編號）重新編成 1、2、3…：新編號和原本的大小順序不同，
 * 照抄排序數字的話，排序相同的項目複製後順序會變，成對課程的兩個場次中間可能被別的場次插進來。
 * 報名開放後可以調場次排序、不再檢查成對課程相鄰（course_pairs_valid_after_session_change），
 * 所以去年的成對課程可能已經不相鄰；新年度還沒開放、會檢查，這種成對不複製，回傳略過幾組，請總管理員重新設定。
 * 回傳新年度的編號與略過的成對課程組數（Codex 審查）。
 */
create function public.copy_conference(p_source_id uuid, p_year integer, p_conference_date date)
returns table (new_conference_id uuid, skipped_course_pairs integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_skipped integer;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_source_id) then
    raise exception 'not_found';
  end if;

  with
    -- 和 course_pairs_valid 同樣的規則：同場地、不同場次，依排序兩個場次中間沒有別的場次。
    kept_pairs as materialized (
      select p.first_course_id, p.second_course_id
      from public.course_pairs p
      join public.courses a on a.id = p.first_course_id
      join public.sessions sa on sa.id = a.session_id
      join public.courses b on b.id = p.second_course_id
      join public.sessions sb on sb.id = b.session_id
      where p.conference_id = p_source_id
        and sa.venue_id = sb.venue_id
        and sa.id <> sb.id
        and not exists (
          select 1 from public.sessions s
          where s.venue_id = sa.venue_id
            and (
              ((s.position, s.id) > (sa.position, sa.id) and (s.position, s.id) < (sb.position, sb.id))
              or ((s.position, s.id) > (sb.position, sb.id) and (s.position, s.id) < (sa.position, sa.id))
            )
        )
    ),
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
      select extensions.uuid_generate_v5(v_id, id::text), v_id, site_key, row_number() over (order by position, id), region,
        name_zh, name_en, address_zh, address_en, features_zh, features_en
      from public.venues
      where conference_id = p_source_id
    ),
    sessions as (
      insert into public.sessions (id, conference_id, venue_id, position, name_zh, name_en)
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        row_number() over (partition by venue_id order by position, id), name_zh, name_en
      from public.sessions
      where conference_id = p_source_id
    ),
    courses as (
      insert into public.courses (
        id, conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, session_id::text),
        row_number() over (partition by session_id order by position, id), title_zh, title_en, description_zh, description_en, capacity
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
      from kept_pairs
    ),
    lunches as (
      insert into public.lunch_options (
        id, conference_id, venue_id, position, name_zh, name_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        row_number() over (partition by venue_id order by position, id), name_zh, name_en, description_zh, description_en,
        capacity
      from public.lunch_options
      where conference_id = p_source_id
    ),
    activities as (
      insert into public.afternoon_activities (
        id, conference_id, venue_id, position, title_zh, title_en, description_zh, description_en, capacity
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, venue_id::text),
        row_number() over (partition by venue_id order by position, id), title_zh, title_en, description_zh, description_en,
        capacity
      from public.afternoon_activities
      where conference_id = p_source_id
    ),
    faqs as (
      insert into public.faqs (conference_id, position, question_zh, question_en, answer_zh, answer_en)
      select v_id, row_number() over (order by position, id), question_zh, question_en, answer_zh, answer_en
      from public.faqs
      where conference_id = p_source_id
    ),
    blocks as (
      insert into public.custom_blocks (
        conference_id, position, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url
      )
      select v_id, row_number() over (order by position, id), title_zh, title_en, body_zh, body_en,
        button_label_zh, button_label_en, button_url
      from public.custom_blocks
      where conference_id = p_source_id
    )
  -- 上面的寫入不管有沒有被讀到都會執行。
  select (select count(*) from public.course_pairs where conference_id = p_source_id) - count(*)
  into v_skipped
  from kept_pairs;

  return query select v_id, v_skipped;
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
  -- 明確鎖住要改的兩列（for update）：送出、修改、取消報名鎖著目前年度（for key share）時，等它們做完。
  -- 只寫 update 的話，改 is_current 拿的鎖和 for key share 不衝突，不會等。
  perform 1 from public.conferences where is_current or id = p_conference_id order by id for update;
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

/*
 * 送出、修改、取消報名讀目前年度時鎖住那一列（for key share），切換目前年度先 for update 鎖住這一列，
 * 得等它們做完（Codex 審查）。不鎖的話，報名讀完目前年度、卡在等課程或報名的鎖時，切換可以先完成，
 * 報名之後仍寫進已經變成舊年度的那一年，前台卻查不到。鎖住之後：報名先讀到的，切換等它做完；
 * 切換先開始的，報名重新檢查時已經不是目前年度，丟出 registration_not_open（她重新整理就是新年度的報名表）。
 * 用 for key share 而不是 for share：報名之間不互相等，總管理員改內容或時程（一般的 update）也不會讓報名排隊，
 * 延後開放時間還沒確定時，報名照原定時間進行（registration.test.ts「跨過開放時間的修改」）。
 * 下面三個函式和原本的版本（20261025000000_confirmation_emails.sql、20261019000000_cancel_registration.sql）
 * 只差讀目前年度那一行。
 */

create or replace function public.submit_registration(
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean,
  p_locale text,
  p_course_ids uuid[] default '{}',
  p_lunch_option_id uuid default null,
  p_afternoon_activity_id uuid default null,
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default false
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_number text;
  v_registration public.registrations;
begin
  select * into v_conference from public.conferences where is_current for key share;
  if v_conference.id is null
    -- 時間點沒填時比較結果是 null，也當成不在報名期間。
    or not coalesce(
      now() >= v_conference.registration_opens_at and now() < v_conference.registration_closes_at,
      false
    )
  then
    raise exception 'registration_not_open';
  end if;

  if p_portrait_consent is not true then
    raise exception 'portrait_consent_required';
  end if;

  -- 場地在支聯會之前檢查，和之前的順序一樣。
  if not exists (
    select 1 from public.venues where id = p_venue_id and conference_id = v_conference.id
  ) then
    raise exception 'venue_invalid';
  end if;

  if not exists (select 1 from public.stakes where id = p_stake_id and is_active) then
    raise exception 'stake_invalid';
  end if;

  if not exists (
    select 1 from public.wards where id = p_ward_id and stake_id = p_stake_id and is_active
  ) then
    raise exception 'ward_not_in_stake';
  end if;

  perform public.check_registration_choices(
    v_conference.id, p_venue_id, v_course_ids, p_lunch_option_id, p_afternoon_activity_id, '{}'
  );

  -- 任何人都能直接呼叫這個函式，所以這裡也用 trim_blank 去掉頭尾空白，存下的資料才跟經過報名服務的一致。
  -- 沒有電話時發 100000–999999 的報名編號（不以 0 開頭，免得抄寫時漏掉）；
  -- 同時有人抽到同一組時，唯一索引會擋下，換一組再試。
  -- 報名語言不是 zh、en 時，資料表的 registrations_locale_valid 會擋下。
  loop
    if p_phone is null then
      v_number := (100000 + ('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 900000)::text;
    end if;
    begin
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, registration_number, email, line_id,
        portrait_consented_at, lunch_option_id, afternoon_activity_id, choir_part, services, printed_handbook,
        locale
      ) values (
        v_conference.id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now(),
        p_lunch_option_id, p_afternoon_activity_id, p_choir_part, public.ordered_services(p_services),
        coalesce(p_printed_handbook, false), p_locale
      )
      returning * into v_registration;
      exit;
    exception when unique_violation then
      if p_phone is not null then
        raise;
      end if;
    end;
  end loop;

  insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
  select v_registration.id, p_venue_id, session_id, id
  from public.courses
  where id = any(v_course_ids);

  return v_registration;
end;
$$;

create or replace function public.update_registration(
  p_registration_id uuid,
  p_lookup_name text,
  p_lookup_phone text,
  p_lookup_registration_number text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_venue_id uuid,
  p_course_ids uuid[] default '{}',
  p_lunch_option_id uuid default null,
  p_afternoon_activity_id uuid default null,
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_held_course_ids uuid[];
  v_hash text;
  v_registration public.registrations;
  v_detail text;
begin
  perform public.reject_read_only();

  select * into v_conference from public.conferences where is_current for key share;
  if v_conference.id is null or not public.registration_open_now(v_conference.id) then
    raise exception 'registration_not_open';
  end if;

  v_hash := public.lookup_attempt_start(p_lookup_name);

  -- 鎖住這一筆：同一筆同時送出兩次修改（或修改與取消）時依序處理，後到的看到的是前一次改好的內容。
  select r.* into v_registration
  from public.registrations r
  where r.id = p_registration_id
    and r.conference_id = v_conference.id
    and public.lookup_name_key(r.name) = public.lookup_name_key(p_lookup_name)
    and (
      r.phone = p_lookup_phone or r.phone = p_phone
      or r.registration_number = p_lookup_registration_number
    )
  for update;
  if v_registration.id is null then
    perform public.lookup_attempt_failed(
      v_hash,
      (select count(distinct guess)::integer
        from unnest(array[p_lookup_phone, p_phone, p_lookup_registration_number]) as guess)
    );
    return '{}';
  end if;

  -- 從這裡起姓名與電話已經對上，不再丟出例外（見檔案開頭）。
  if v_registration.status <> 'registered' then
    return jsonb_build_object('error', 'registration_cancelled');
  end if;

  -- 中途出錯時，這個區塊裡寫入的全部撤銷，原本的報名完整保留，錯誤放在回傳值裡。
  begin
    if (v_registration.phone is null) <> (p_phone is null) then
      raise exception 'phone_invalid';
    end if;

    -- 她原本已佔的課程、午餐、午后動態。修改中途換走又換回，送來的還是同一個，仍算她原本的位子。
    -- 先鎖住報名、再鎖選項；送出報名不碰既有的報名，所以順序不會和它互相卡住。
    v_held_course_ids := array(
      select course_id from public.registration_courses where registration_id = v_registration.id
    );
    perform public.check_registration_choices(
      v_conference.id, p_venue_id, v_course_ids, p_lunch_option_id, p_afternoon_activity_id,
      v_held_course_ids || array_remove(
        array[v_registration.lunch_option_id, v_registration.afternoon_activity_id], null
      )
    );

    -- 該上的鎖都拿到了；排隊期間跨過截止的修改，這裡擋下。
    if not public.registration_open_now(v_conference.id) then
      raise exception 'registration_not_open';
    end if;

    -- 先拿掉不要的課（換場地時是全部），報名才能換到新的場地；沒換的課留著原本的紀錄。
    delete from public.registration_courses
    where registration_id = v_registration.id and course_id <> all(v_course_ids);

    -- 和送出報名一樣，用 trim_blank 去掉頭尾空白。
    update public.registrations
    set
      venue_id = p_venue_id,
      phone = p_phone,
      email = nullif(public.trim_blank(p_email), ''),
      line_id = nullif(public.trim_blank(p_line_id), ''),
      lunch_option_id = p_lunch_option_id,
      afternoon_activity_id = p_afternoon_activity_id,
      choir_part = p_choir_part,
      services = public.ordered_services(p_services),
      -- 沒送來就保留原本的選擇（報名服務會先擋下，不會發生）。
      printed_handbook = coalesce(p_printed_handbook, printed_handbook),
      updated_at = now()
    where id = v_registration.id
    returning * into v_registration;

    insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
    select v_registration.id, p_venue_id, c.session_id, c.id
    from public.courses c
    where c.id = any(v_course_ids) and c.id <> all(v_held_course_ids);
  exception when others then
    -- 互相等待照樣丟出，報名服務會整筆重送。
    if sqlstate = '40P01' then
      raise;
    end if;
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('error', sqlerrm, 'detail', nullif(v_detail, ''));
  end;

  return to_jsonb(v_registration);
end;
$$;

create or replace function public.cancel_registration(
  p_registration_id uuid,
  p_lookup_name text,
  p_lookup_phone text,
  p_lookup_registration_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_hash text;
  v_registration public.registrations;
begin
  perform public.reject_read_only();

  select * into v_conference from public.conferences where is_current for key share;
  if v_conference.id is null or not public.registration_open_now(v_conference.id) then
    raise exception 'registration_not_open';
  end if;

  v_hash := public.lookup_attempt_start(p_lookup_name);

  -- 鎖住這一筆：同時送出的修改與取消依序處理，修改不會在取消之後又寫回來。
  select r.* into v_registration
  from public.registrations r
  where r.id = p_registration_id
    and r.conference_id = v_conference.id
    and public.lookup_name_key(r.name) = public.lookup_name_key(p_lookup_name)
    and (r.phone = p_lookup_phone or r.registration_number = p_lookup_registration_number)
  for update;
  if v_registration.id is null then
    perform public.lookup_attempt_failed(
      v_hash,
      (select count(distinct guess)::integer
        from unnest(array[p_lookup_phone, p_lookup_registration_number]) as guess)
    );
    return '{}';
  end if;

  -- 從這裡起姓名與電話已經對上，不再丟出例外（見檔案開頭）。
  if v_registration.status = 'registered' then
    if not public.registration_open_now(v_conference.id) then
      return jsonb_build_object('error', 'registration_not_open');
    end if;
    update public.registrations
    set status = 'cancelled', cancelled_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_registration.id
    returning * into v_registration;
  end if;

  return jsonb_build_object(
    'id', v_registration.id,
    'status', v_registration.status,
    'cancelled_at', v_registration.cancelled_at
  );
end;
$$;
