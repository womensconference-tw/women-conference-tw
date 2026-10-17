-- 後台新增、修改、取消報名與身分類別（#17）：只有總管理員能做，不受報名期間限制（ADR 0004）。

/*
 * 前台與後台走同一套報名規則（ADR 0006）：寫入新報名、改寫既有報名的步驟抽成下面兩個函式，
 * 前台的 submit_registration、update_registration 與後台的 staff_* 都呼叫它們，差別只在入口：
 * - 前台：要在報名期間；修改要先比對姓名與電話。身分類別一律是與會姐妹，修改時不動。
 * - 後台：要是總管理員，不看報名期間；可以設身分類別；可以超收。
 *
 * 超收（ADR 0006）：後台帶了確認旗標（p_confirm_full），所選的課程、午餐、午后動態都當成她已佔的位子，
 * 不檢查名額（check_registration_choices 的 p_held_ids）。沒帶時和前台一樣丟出 course_full、choice_full，
 * 報名服務轉成「需要確認」，畫面問過之後再帶旗標送一次。確認旗標不是權限：先確認呼叫者是總管理員。
 * 其他檢查（場地、支聯會、支會、成對課程等）照樣做，帶了旗標也一樣。
 *
 * 只能新增、修改、取消目前年度的報名，和前台一樣讀目前年度時用 for key share，切換年度會等它做完
 * （20261029000000_year_management.sql）。
 */

-- 寫入一筆新報名，規則見 20261017000000_update_registration.sql 的 submit_registration。只由下面的函式呼叫。
create function public.insert_registration(
  p_conference_id uuid,
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean,
  p_locale text,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_choir_part text,
  p_services text[],
  p_printed_handbook boolean,
  p_role text,
  p_allow_full boolean
)
returns public.registrations
language plpgsql
set search_path = ''
as $$
declare
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_number text;
  v_registration public.registrations;
begin
  if p_portrait_consent is not true then
    raise exception 'portrait_consent_required';
  end if;

  -- 場地在支聯會之前檢查，和之前的順序一樣。
  if not exists (
    select 1 from public.venues where id = p_venue_id and conference_id = p_conference_id
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
    p_conference_id, p_venue_id, v_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    case when p_allow_full
      then v_course_ids || array_remove(array[p_lunch_option_id, p_afternoon_activity_id], null)
      else '{}'
    end
  );

  -- 任何人都能直接呼叫送出的函式，所以這裡也用 trim_blank 去掉頭尾空白，存下的資料才跟經過報名服務的一致。
  -- 沒有電話時發 100000–999999 的報名編號（不以 0 開頭，免得抄寫時漏掉）；
  -- 同時有人抽到同一組時，唯一索引會擋下，換一組再試。
  -- 報名語言、身分類別不認得時，資料表的 registrations_locale_valid、registrations_role_valid 會擋下。
  loop
    if p_phone is null then
      v_number := (100000 + ('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 900000)::text;
    end if;
    begin
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, registration_number, email, line_id,
        portrait_consented_at, lunch_option_id, afternoon_activity_id, choir_part, services, printed_handbook,
        locale, role
      ) values (
        p_conference_id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now(),
        p_lunch_option_id, p_afternoon_activity_id, p_choir_part, public.ordered_services(p_services),
        coalesce(p_printed_handbook, false), p_locale, p_role
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

/*
 * 改寫一筆已鎖住（for update）、仍有效的報名，規則見 20261017000000_update_registration.sql 的 update_registration：
 * 她原本已佔的課程、午餐、午后動態仍算她的位子，新選的才檢查名額。不符合時丟出代碼。
 * p_role 是 null 時不改身分類別（前台）。p_require_open 時，等到選項的鎖之後再確認一次在報名期間（前台）。
 * 只由下面的函式呼叫。
 */
create function public.change_registration(
  p_registration public.registrations,
  p_conference_id uuid,
  p_phone text,
  p_email text,
  p_line_id text,
  p_venue_id uuid,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_choir_part text,
  p_services text[],
  p_printed_handbook boolean,
  p_role text,
  p_allow_full boolean,
  p_require_open boolean
)
returns public.registrations
language plpgsql
set search_path = ''
as $$
declare
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_held_course_ids uuid[];
  v_registration public.registrations;
begin
  -- 有沒有電話在報名時就決定了（有電話的不發報名編號）。
  if (p_registration.phone is null) <> (p_phone is null) then
    raise exception 'phone_invalid';
  end if;

  -- 她原本已佔的課程、午餐、午后動態。修改中途換走又換回，送來的還是同一個，仍算她原本的位子。
  -- 先鎖住報名、再鎖選項；送出報名不碰既有的報名，所以順序不會和它互相卡住。
  v_held_course_ids := array(
    select course_id from public.registration_courses where registration_id = p_registration.id
  );
  perform public.check_registration_choices(
    p_conference_id, p_venue_id, v_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    v_held_course_ids
      || array_remove(array[p_registration.lunch_option_id, p_registration.afternoon_activity_id], null)
      || case when p_allow_full
        then v_course_ids || array_remove(array[p_lunch_option_id, p_afternoon_activity_id], null)
        else '{}'
      end
  );

  -- 該上的鎖都拿到了；排隊期間跨過截止的修改，這裡擋下。
  if p_require_open and not public.registration_open_now(p_conference_id) then
    raise exception 'registration_not_open';
  end if;

  -- 先拿掉不要的課（換場地時是全部），報名才能換到新的場地；沒換的課留著原本的紀錄。
  delete from public.registration_courses
  where registration_id = p_registration.id and course_id <> all(v_course_ids);

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
    role = coalesce(p_role, role),
    updated_at = now()
  where id = p_registration.id
  returning * into v_registration;

  insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
  select v_registration.id, p_venue_id, c.session_id, c.id
  from public.courses c
  where c.id = any(v_course_ids) and c.id <> all(v_held_course_ids);

  return v_registration;
end;
$$;

-- 只由下面的入口函式呼叫（以擁有者的權限）。Supabase 預設也給 service_role 執行權限，一併拿掉。
revoke all on function public.insert_registration from public, anon, authenticated, service_role;
revoke all on function public.change_registration from public, anon, authenticated, service_role;

-- 前台的送出、修改改成呼叫上面兩個函式，其他和 20261029000000_year_management.sql 的版本相同。
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

  -- 前台報名一律是與會姐妹，不能超收。
  return public.insert_registration(
    v_conference.id, p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id,
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    p_choir_part, p_services, p_printed_handbook, 'attendee', false
  );
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

  -- 從這裡起姓名與電話已經對上，不再丟出例外（見 20261019000000_cancel_registration.sql 開頭）。
  if v_registration.status <> 'registered' then
    return jsonb_build_object('error', 'registration_cancelled');
  end if;

  -- 中途出錯時，這個區塊裡寫入的全部撤銷，原本的報名完整保留，錯誤放在回傳值裡。
  -- 前台修改不改身分類別，不能超收，要在報名期間。
  begin
    v_registration := public.change_registration(
      v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
      p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
      null, false, true
    );
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

/*
 * 後台新增報名。報名語言（確認信依它寄送）由呼叫的人帶入；後台畫面目前一律是中文。不符合時丟出代碼：
 * 不是總管理員 not_allowed；其他和前台送出相同（沒有目前年度時是 venue_invalid）。
 */
create function public.staff_submit_registration(
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean,
  p_locale text,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_choir_part text,
  p_services text[],
  p_printed_handbook boolean,
  p_role text,
  p_confirm_full boolean
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_conference from public.conferences where is_current for key share;

  return public.insert_registration(
    v_conference.id, p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id,
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    p_choir_part, p_services, p_printed_handbook, p_role, coalesce(p_confirm_full, false)
  );
end;
$$;

/*
 * 後台修改報名：可以改的和前台修改相同，另外可以改身分類別。不符合時丟出代碼：
 * 不是總管理員 not_allowed；不是目前年度的報名 registration_not_found；已取消 registration_cancelled；
 * 其他和前台修改相同。
 */
create function public.staff_update_registration(
  p_registration_id uuid,
  p_phone text,
  p_email text,
  p_line_id text,
  p_venue_id uuid,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_choir_part text,
  p_services text[],
  p_printed_handbook boolean,
  p_role text,
  p_confirm_full boolean
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_registration public.registrations;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_conference from public.conferences where is_current for key share;

  -- 鎖住這一筆：和報名者自己的修改、取消依序處理。
  select * into v_registration
  from public.registrations
  where id = p_registration_id and conference_id = v_conference.id
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found';
  end if;
  if v_registration.status <> 'registered' then
    raise exception 'registration_cancelled';
  end if;

  -- 身分類別必填；沒送來（null）時 change_registration 會保留原本的，所以這裡先擋下。
  if p_role is null then
    raise exception 'role_invalid';
  end if;

  return public.change_registration(
    v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
    p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
    p_role, coalesce(p_confirm_full, false), false
  );
end;
$$;

/*
 * 後台取消報名：標記為已取消並記下取消時間，不刪除，名額立即釋出。已經取消的再取消一次照樣成功。
 * 不是總管理員 not_allowed；不是目前年度的報名 registration_not_found。
 */
create function public.staff_cancel_registration(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_registration public.registrations;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_conference from public.conferences where is_current for key share;

  select * into v_registration
  from public.registrations
  where id = p_registration_id and conference_id = v_conference.id
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found';
  end if;

  if v_registration.status = 'registered' then
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

-- 用登入的工作人員身分呼叫；是不是總管理員由函式自己確認。訪客不能呼叫。
revoke all on function public.staff_submit_registration from public, anon;
revoke all on function public.staff_update_registration from public, anon;
revoke all on function public.staff_cancel_registration from public, anon;
grant execute on function public.staff_submit_registration to authenticated;
grant execute on function public.staff_update_registration to authenticated;
grant execute on function public.staff_cancel_registration to authenticated;
