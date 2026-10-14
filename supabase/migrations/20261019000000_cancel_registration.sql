-- 取消報名，以及查詢、修改報名的幾個修正：只開放給網站伺服器、等鎖時跨過截止、已取消的不算猜錯。

/*
 * 查詢、修改、取消只開放給網站伺服器（service_role），訪客不能直接呼叫（ADR 0009，權限在檔案最後）。
 * 訪客能直接呼叫時，可以要 PostgREST 對回傳值同時加篩選與轉型
 * （例如 ?pgrst_scalar=eq.[]&select=pgrst_scalar::boolean）：猜錯的呼叫轉型失敗、整個交易撤銷，
 * 猜錯的紀錄跟著不見；猜對的被篩掉、正常回應。這樣就能不計次數一直猜，只改回傳的形狀擋不住。
 *
 * 網站伺服器只用固定的方式呼叫，不加篩選或轉型。修改、取消另外守住兩條規則，萬一權限設錯也比較難被利用：
 * - 比對不到時回傳空物件 {}，不是 null：猜對時回傳的也是物件，不管怎麼轉型，兩邊的錯誤都一樣。
 * - 姓名與電話對上之後不再丟出例外：場地、名額、電話等問題放在回傳的 {"error": 代碼, "detail": ...}，
 *   猜對時故意送錯資料，也不會得到和猜錯不同的錯誤。
 *   只有資料庫互相等待（deadlock）照樣丟出，報名服務才會重送；這不是呼叫的人能控制的。
 *
 * 報名期間的判斷：開始時先看一次（還沒比對身分，大家都一樣）；等到鎖之後，用當下的時間（clock_timestamp）
 * 和最新的截止時間再看一次，排隊等鎖期間跨過截止的修改、取消也擋得下。
 */

create function public.registration_open_now(p_conference_id uuid)
returns boolean
language sql
volatile
set search_path = ''
as $$
  select coalesce(
    clock_timestamp() >= registration_opens_at and clock_timestamp() < registration_closes_at,
    false
  )
  from public.conferences
  where id = p_conference_id
$$;

revoke all on function public.registration_open_now from public, anon, authenticated;

/*
 * 報名服務的取消：前台唯一能取消報名的地方。
 * 和修改一樣，姓名與電話（或沒有電話者的報名編號）都要符合這一筆（ADR 0002），只能在報名中取消目前年度的報名。
 * 取消只把狀態改成已取消、記下取消時間，不刪除；課程、午餐、午后動態的紀錄都留著。
 * 名額只算未取消的報名（course_seats_taken 等），所以提交後名額立即釋出，不必再檢查名額。
 *
 * 和查詢、修改共用猜錯次數：姓名與電話不符算猜錯一次，這時不丟出例外、回傳 {}，猜錯的紀錄才會留下。
 * 唯讀時一律拒絕，不能用 GET 讓猜錯的紀錄撤銷。
 *
 * 已經取消的報名再取消一次（例如取消已經存下、只是回應在路上斷掉，她再按一次）照樣成功，取消時間不變。
 * 查詢本來就看得到已取消的報名，所以這不會多透露什麼。
 */
create function public.cancel_registration(
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

  select * into v_conference from public.conferences where is_current;
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


/*
 * 報名服務的修改，規則與之前相同（見 20261017000000_update_registration.sql），只改了這些：
 * - 比對不到時回傳 {}（之前是 null）；姓名與電話對上之後，錯誤放在回傳的 {"error": 代碼, "detail": ...}，不丟出例外。
 * - 已取消的報名：姓名與電話對上就不算猜錯（之前算），回傳 registration_cancelled。
 *   她在一個分頁取消、另一個分頁還開著修改表單時，送出修改不會讓自己被暫停查詢。
 * - 等到鎖之後再確認一次還在報名期間。
 */
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

  select * into v_conference from public.conferences where is_current;
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

-- 只開放給網站伺服器（見檔案開頭）。送出報名不比對身分，仍開放給訪客。
revoke all on function public.lookup_registration from public, anon, authenticated;
revoke all on function public.update_registration from public, anon, authenticated;
revoke all on function public.cancel_registration from public, anon, authenticated;
grant execute on function public.lookup_registration to service_role;
grant execute on function public.update_registration to service_role;
grant execute on function public.cancel_registration to service_role;
