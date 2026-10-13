-- 修改報名，以及送出與修改共用的選項檢查、查詢與修改共用的猜錯次數。

/*
 * 送出與修改報名共用的選項檢查（ADR 0006：報名、修改、取消必須走同一套名額檢查）：
 * 場地是否屬於這個年度、所選課程是否在該場地且每個場次最多一門、午餐與午后動態是否在該場地，以及這些選項的名額。
 * 不符合時丟出代碼（venue_invalid、courses_invalid、course_full 等），由報名服務轉成欄位旁的錯誤訊息。
 *
 * 名額：先鎖住所選的課程、午餐、午后動態，再數已佔用的名額；呼叫的函式在同一個交易裡接著寫入，鎖到交易結束才放開。
 * 兩人同時搶最後一個名額時，後到的會等先到的寫完，才數到已滿。
 * p_held_ids 是她原本已佔的選項（修改時），仍算她的位子，不檢查名額；送出時是空的。
 * 任何一項額滿就丟出錯誤，detail 是所有額滿選項的 id（以逗號分隔）。
 * 有課程額滿時丟出 course_full（舊網站才認得），只有午餐、午后動態額滿時丟出 choice_full。
 */
create function public.check_registration_choices(
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

  select array_agg(id) into v_full
  from (
    select id from public.courses
    where id = any(p_course_ids) and capacity is not null and public.course_seats_taken(id) >= capacity
    union all
    select id from public.lunch_options
    where id = p_lunch_option_id and capacity is not null and public.lunch_seats_taken(id) >= capacity
    union all
    select id from public.afternoon_activities
    where id = p_afternoon_activity_id and capacity is not null
      and public.afternoon_activity_seats_taken(id) >= capacity
  ) as full_choices
  where id <> all(p_held_ids);
  if v_full is not null then
    if exists (select 1 from public.courses where id = any(v_full)) then
      raise exception 'course_full' using detail = array_to_string(v_full, ',');
    end if;
    raise exception 'choice_full' using detail = array_to_string(v_full, ',');
  end if;
end;
$$;

-- 服務意願依報名表的順序（SERVICES）、去掉重複；不認得的代碼排在最後留著，交給資料表的限制擋下。
create function public.ordered_services(p_services text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array(
    select s from unnest(coalesce(p_services, '{}')) as s
    group by s
    order by array_position(array['setup', 'translation', 'reception', 'cleanup'], s), s
  )
$$;

-- 只給送出、修改報名的函式在裡面呼叫，前台不能直接呼叫。
revoke all on function public.check_registration_choices from public, anon, authenticated;
revoke all on function public.ordered_services from public, anon, authenticated;

/*
 * 報名服務的送出，改用共用的選項檢查，規則與之前相同（見 20261015000000_lunch_activities_services.sql）。
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
  select * into v_conference from public.conferences where is_current;
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
  loop
    if p_phone is null then
      v_number := (100000 + ('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 900000)::text;
    end if;
    begin
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, registration_number, email, line_id,
        portrait_consented_at, lunch_option_id, afternoon_activity_id, choir_part, services, printed_handbook
      ) values (
        v_conference.id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now(),
        p_lunch_option_id, p_afternoon_activity_id, p_choir_part, public.ordered_services(p_services),
        coalesce(p_printed_handbook, false)
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
 * 查詢與修改共用的猜錯次數（ADR 0002）：同一個姓名一小時內猜錯 10 次，就從那一刻起暫停一小時。
 * lookup_attempt_start 讓同一個姓名的查詢、修改排隊（鎖到交易結束），清掉過期的紀錄，
 * 暫停中就丟出 too_many_attempts；回傳姓名的雜湊，猜錯時交給 lookup_attempt_failed 記下。
 * 一次呼叫帶了幾組不同的電話或報名編號，就算猜了幾次（p_guesses），不能一次多猜幾組卻只算一次。
 * 記下猜錯的交易不能丟出例外，否則紀錄會跟著撤銷。
 */
create function public.lookup_attempt_start(p_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_hash text := md5(coalesce(public.lookup_name_key(p_name), ''));
begin
  perform pg_advisory_xact_lock(hashtextextended('lookup_registration:' || v_hash, 0));

  delete from public.lookup_failures f where f.attempted_at < now() - interval '1 hour';
  delete from public.lookup_locks l where l.locked_until <= now();
  if exists (select 1 from public.lookup_locks l where l.name_hash = v_hash) then
    raise exception 'too_many_attempts';
  end if;
  return v_hash;
end;
$$;

create function public.lookup_attempt_failed(p_hash text, p_guesses integer)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.lookup_failures (name_hash)
  select p_hash from generate_series(1, greatest(p_guesses, 1));
  if (select count(*) from public.lookup_failures f where f.name_hash = p_hash) >= 10 then
    insert into public.lookup_locks (name_hash, locked_until) values (p_hash, now() + interval '1 hour');
  end if;
end;
$$;

-- 唯讀的呼叫（例如用 GET 呼叫）寫不進猜錯紀錄，所以會比對身分的函式一開始就拒絕。
create function public.reject_read_only()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('transaction_read_only') = 'on' then
    raise exception 'read_only_call';
  end if;
end;
$$;

revoke all on function public.reject_read_only from public, anon, authenticated;
revoke all on function public.lookup_attempt_start from public, anon, authenticated;
revoke all on function public.lookup_attempt_failed from public, anon, authenticated;

/*
 * 查詢改用共用的猜錯次數，比對規則與之前相同（見 20261016000000_lookup_registration.sql）。
 *
 * 任何人都能拿匿名金鑰直接呼叫，不經過網站，所以要防範讓猜錯的紀錄跟著撤銷的呼叫方式：
 * - 回傳一個 JSON 陣列（查不到是空陣列），不是一列一列的結果：呼叫的人不能要求「只回一筆」或加篩選，
 *   讓查不到時回應出錯、整個交易撤銷。陣列裡每一筆的欄位和之前一樣，舊網站照樣看得懂。
 * - 唯讀的呼叫（GET）寫不進猜錯紀錄，查不到時會出錯、查到時照常回傳；所以唯讀時一律先拒絕，什麼都不比對。
 */
drop function public.lookup_registration(text, text, text);

create function public.lookup_registration(
  p_name text,
  p_phone text,
  p_registration_number text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.lookup_name_key(p_name);
  v_hash text;
  v_found jsonb;
begin
  perform public.reject_read_only();
  if coalesce(v_key, '') = '' or (p_phone is null and p_registration_number is null) then
    return '[]';
  end if;

  v_hash := public.lookup_attempt_start(p_name);

  select coalesce(jsonb_agg(to_jsonb(matched) - 'created_at' order by matched.created_at desc, matched.id), '[]')
  into v_found
  from (
    select
      r.id, r.name, r.phone, r.registration_number, r.email, r.line_id,
      r.stake_id, r.ward_id, r.venue_id,
      array(
        select rc.course_id from public.registration_courses rc where rc.registration_id = r.id
      ) as course_ids,
      r.lunch_option_id, r.afternoon_activity_id, r.choir_part, r.services, r.printed_handbook,
      r.status,
      s.name_zh as stake_name_zh, s.name_en as stake_name_en,
      w.name_zh as ward_name_zh, w.name_en as ward_name_en,
      r.created_at
    from public.registrations r
    join public.conferences c on c.id = r.conference_id and c.is_current
    join public.stakes s on s.id = r.stake_id
    join public.wards w on w.id = r.ward_id
    where (r.phone = p_phone or r.registration_number = p_registration_number)
      and public.lookup_name_key(r.name) = v_key
  ) as matched;

  if v_found = '[]' then
    perform public.lookup_attempt_failed(
      v_hash, (p_phone is not null)::integer + (p_registration_number is not null)::integer
    );
  end if;
  return v_found;
end;
$$;

revoke all on function public.lookup_registration from public;
grant execute on function public.lookup_registration to anon, authenticated;

/*
 * 報名服務的修改：前台唯一能修改報名的地方。
 * 和查詢一樣，姓名與電話（或沒有電話者的報名編號）都要符合這一筆（ADR 0002），只能改目前年度、未取消的報名。
 * 和查詢共用猜錯次數：姓名與電話不符（或報名已取消）算猜錯一次，這時不丟出例外、回傳 JSON 的 null，
 * 猜錯的紀錄才會留下；報名服務把 null 當成找不到。曾經拿到報名 id 的人（例如代報人），也不能用修改一直猜。
 * 和查詢一樣回傳 JSON、唯讀時一律拒絕，不能用篩選、「只回一筆」或 GET 讓猜錯的紀錄撤銷。
 *
 * 電話可以是原本的（p_lookup_phone），也可以是這次改成的（p_phone）：
 * 改電話的修改已經存下、只是回應在路上斷掉時，她再按一次送出，原本的電話已經對不上，用新的電話仍對得上，
 * 而且比對成功，不記猜錯，快到暫停門檻時重送也不會把自己暫停。
 * 比對不到時，帶了幾組不同的電話或報名編號就算猜了幾次，猜的人不能一次多試一支電話卻只算一次。
 *
 * 可以改聯絡資料（電話、Email、LINE ID）與場地、課程、午餐、午后動態、服務意願、紙本手冊。
 * 姓名、支聯會、支會不能改；有沒有電話在報名時就決定了（報名編號是她查詢用的），想改丟出 phone_invalid。
 *
 * 和送出報名用同一個 check_registration_choices 檢查選項與名額（ADR 0006），丟出的代碼也相同。
 * 她原本已佔的課程、午餐、午后動態以資料庫裡存的為準，仍算她的位子，不再檢查名額；新選的才檢查。
 * 任何一項不通過就整筆不寫入，原本的報名完整保留。
 */
create function public.update_registration(
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
begin
  perform public.reject_read_only();

  select * into v_conference from public.conferences where is_current;
  if v_conference.id is null
    -- 時間點沒填時比較結果是 null，也當成不在報名期間。
    or not coalesce(
      now() >= v_conference.registration_opens_at and now() < v_conference.registration_closes_at,
      false
    )
  then
    raise exception 'registration_not_open';
  end if;

  v_hash := public.lookup_attempt_start(p_lookup_name);

  -- 鎖住這一筆：同一筆同時送出兩次修改時依序處理，後到的看到的是前一次改好的內容。
  select r.* into v_registration
  from public.registrations r
  where r.id = p_registration_id
    and r.conference_id = v_conference.id
    and r.status = 'registered'
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
    return 'null';
  end if;

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

  return to_jsonb(v_registration);
end;
$$;

revoke all on function public.update_registration from public;
grant execute on function public.update_registration to anon, authenticated;
