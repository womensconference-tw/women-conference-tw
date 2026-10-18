-- 午后動態改成場次（#65）之二：移除只為午后動態存在的函式，其他函式拿掉午后動態的參數與欄位。
-- 午后動態的名額、停止報名、寄信內容、統計、複製到新年度，現在都和其他課程走同一套（課程、場次）。
-- 下面的函式除了少了午后動態，其他和之前的版本相同（最後一版見 20261103000000_submission_keys.sql、
-- 20261104000000_stop_registration.sql、20261105000000_resend_confirmation_email.sql 等）。

drop function public.full_afternoon_activities();
drop function public.afternoon_activity_seats_taken(uuid);

-- 參數變了要先刪掉舊的，不然會多出一個同名的函式。
drop function public.submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, uuid, text, text[], boolean, uuid
);
drop function public.update_registration(
  uuid, text, text, text, text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean, uuid
);
drop function public.staff_submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, uuid, text, text[], boolean, text, boolean, uuid
);
drop function public.staff_update_registration(
  uuid, text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean, text, boolean, uuid
);
drop function public.insert_registration(
  uuid, uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, uuid, text, text[], boolean, text, boolean
);
drop function public.change_registration(
  public.registrations, uuid, text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean, text, boolean, boolean
);
drop function public.check_registration_choices(uuid, uuid, uuid[], uuid, uuid, uuid[]);
drop function public.new_registration_fingerprint(
  uuid, uuid, uuid, text, text, text, text, boolean, uuid[], uuid, uuid, text, text[], boolean, text
);
drop function public.change_fingerprint(text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean, text);

CREATE OR REPLACE FUNCTION public.begin_confirmation_email(p_registration_id uuid, p_kind text, p_submission_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found jsonb;
  v_log_id uuid;
begin
  perform 1 from public.registrations where id = p_registration_id for share;

  select
    jsonb_build_object(
      'id', r.id, 'name', r.name, 'phone', r.phone, 'registration_number', r.registration_number,
      'email', r.email, 'line_id', r.line_id, 'stake_id', r.stake_id, 'ward_id', r.ward_id,
      'venue_id', r.venue_id,
      -- 取消後選課紀錄仍保留，取消信也列得出原本的課程。
      'course_ids', array(
        select rc.course_id from public.registration_courses rc where rc.registration_id = r.id
      ),
      'lunch_option_id', r.lunch_option_id,
      'choir_part', r.choir_part, 'services', r.services, 'printed_handbook', r.printed_handbook,
      'locale', r.locale,
      'stake_name_zh', s.name_zh, 'stake_name_en', s.name_en,
      'ward_name_zh', w.name_zh, 'ward_name_en', w.name_en,
      'venue', jsonb_build_object(
        'name_zh', v.name_zh, 'name_en', v.name_en,
        -- 和報名表一樣，只列有開課的場次，依排序。
        'sessions', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', se.id, 'name_zh', se.name_zh, 'name_en', se.name_en,
              'courses', (
                select jsonb_agg(
                  jsonb_build_object('id', co.id, 'title_zh', co.title_zh, 'title_en', co.title_en)
                  order by co.position, co.id
                )
                from public.courses co where co.session_id = se.id
              )
            )
            order by se.position, se.id
          )
          from public.sessions se
          where se.venue_id = v.id and exists (select 1 from public.courses co where co.session_id = se.id)
        ), '[]'),
        'lunch_options', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', l.id, 'name_zh', l.name_zh, 'name_en', l.name_en)
            order by l.position, l.id
          )
          from public.lunch_options l where l.venue_id = v.id
        ), '[]'),
        -- 給還沒部署新版、仍在寄信的舊版網站用：沒有這一項，舊版寄不出信（取消信之後也不能補寄）。
        -- 新版不讀它，舊版網站都換掉之後可以移除。
        'afternoon_activities', '[]'::jsonb
      )
    )
  into v_found
  from public.registrations r
  join public.conferences c on c.id = r.conference_id
  join public.venues v on v.id = r.venue_id
  join public.stakes s on s.id = r.stake_id
  join public.wards w on w.id = r.ward_id
  where r.id = p_registration_id and r.email is not null and c.personal_data_cleared_at is null
    and (r.status = 'cancelled') = (p_kind = 'cancelled');

  if v_found is null then
    return '{}';
  end if;

  -- 取消信已經寄過（email_logs_one_cancellation），或這個送出編號的信已經寄過（email_logs_one_per_submission）就不寄。
  insert into public.email_logs (registration_id, kind, recipient, submission_key)
  values (p_registration_id, p_kind, v_found ->> 'email', p_submission_key)
  on conflict do nothing
  returning id into v_log_id;

  if v_log_id is null then
    return '{}';
  end if;
  return jsonb_build_object('log_id', v_log_id, 'registration', v_found);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.change_fingerprint(p_phone text, p_email text, p_line_id text, p_venue_id uuid, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select public.submission_fingerprint(jsonb_build_object(
    'phone', p_phone, 'email', p_email, 'line_id', p_line_id, 'venue_id', p_venue_id,
    'course_ids', p_course_ids, 'lunch_option_id', p_lunch_option_id, 'choir_part', p_choir_part, 'services', p_services,
    'printed_handbook', p_printed_handbook, 'role', p_role
  ));
$function$
;

CREATE OR REPLACE FUNCTION public.change_registration(p_registration registrations, p_conference_id uuid, p_phone text, p_email text, p_line_id text, p_venue_id uuid, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text, p_allow_full boolean, p_require_open boolean)
 RETURNS registrations
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_held_course_ids uuid[];
  v_registration public.registrations;
begin
  -- 有沒有電話在報名時就決定了（有電話的不發報名編號）。
  if (p_registration.phone is null) <> (p_phone is null) then
    raise exception 'phone_invalid';
  end if;

  -- 她原本已佔的課程、午餐。修改中途換走又換回，送來的還是同一個，仍算她原本的位子。
  -- 先鎖住報名、再鎖選項；送出報名不碰既有的報名，所以順序不會和它互相卡住。
  v_held_course_ids := array(
    select course_id from public.registration_courses where registration_id = p_registration.id
  );
  perform public.check_registration_choices(
    p_conference_id, p_venue_id, v_course_ids, p_lunch_option_id,
    v_held_course_ids
      || array_remove(array[p_registration.lunch_option_id], null)
      || case when p_allow_full
        then v_course_ids || array_remove(array[p_lunch_option_id], null)
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
$function$
;

CREATE OR REPLACE FUNCTION public.check_registration_choices(p_conference_id uuid, p_venue_id uuid, p_course_ids uuid[], p_lunch_option_id uuid, p_held_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_full uuid[];
begin
  if not exists (
    select 1 from public.venues where id = p_venue_id and conference_id = p_conference_id
  ) then
    raise exception 'venue_invalid';
  end if;

  -- 固定先課程（依 id 順序）、再午餐，不會互相卡住。
  -- 報名期間場次與課程不能增刪或換時段（見 sessions_locked_after_opening），所以不必防範這些變動。
  perform 1 from public.courses where id = any(p_course_ids) order by id for update;
  perform 1 from public.lunch_options where id = p_lunch_option_id for update;

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
  ) as full_choices;
  if v_full is not null then
    if exists (select 1 from public.courses where id = any(v_full)) then
      raise exception 'course_full' using detail = array_to_string(v_full, ',');
    end if;
    raise exception 'choice_full' using detail = array_to_string(v_full, ',');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.copy_conference(p_source_id uuid, p_year integer, p_conference_date date)
 RETURNS TABLE(new_conference_id uuid, skipped_course_pairs integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.insert_registration(p_conference_id uuid, p_venue_id uuid, p_stake_id uuid, p_ward_id uuid, p_name text, p_phone text, p_email text, p_line_id text, p_portrait_consent boolean, p_locale text, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text, p_allow_full boolean)
 RETURNS registrations
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    p_conference_id, p_venue_id, v_course_ids, p_lunch_option_id,
    case when p_allow_full
      then v_course_ids || array_remove(array[p_lunch_option_id], null)
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
        portrait_consented_at, lunch_option_id, choir_part, services, printed_handbook,
        locale, role
      ) values (
        p_conference_id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now(),
        p_lunch_option_id, p_choir_part, public.ordered_services(p_services),
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
$function$
;

CREATE OR REPLACE FUNCTION public.lookup_registration(p_name text, p_phone text, p_registration_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      r.lunch_option_id, r.choir_part, r.services, r.printed_handbook,
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
$function$
;

CREATE OR REPLACE FUNCTION public.new_registration_fingerprint(p_venue_id uuid, p_stake_id uuid, p_ward_id uuid, p_name text, p_phone text, p_email text, p_line_id text, p_portrait_consent boolean, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select public.submission_fingerprint(jsonb_build_object(
    'venue_id', p_venue_id, 'stake_id', p_stake_id, 'ward_id', p_ward_id, 'name', p_name, 'phone', p_phone,
    'email', p_email, 'line_id', p_line_id, 'portrait_consent', p_portrait_consent,
    'course_ids', p_course_ids, 'lunch_option_id', p_lunch_option_id, 'choir_part', p_choir_part, 'services', p_services,
    'printed_handbook', p_printed_handbook, 'role', p_role
  ));
$function$
;

CREATE OR REPLACE FUNCTION public.registration_counts(p_conference_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with r as (
    select *
    from public.registrations
    where conference_id = p_conference_id and status = 'registered'
  ),
  counts (kind, key, count, name, parent, position) as (
    select 'total', null, count(*)::integer, null, null, null::integer from r
    union all
    select 'venue', venue_id::text, count(*)::integer, null, null, null from r group by venue_id
    union all
    select 'stake', st.id::text, count(*)::integer, st.name_zh, null, st.position
    from r join public.stakes st on st.id = r.stake_id
    group by st.id
    union all
    select 'ward', w.id::text, count(*)::integer, w.name_zh, w.stake_id::text, w.position
    from r join public.wards w on w.id = r.ward_id
    group by w.id
    union all
    select 'course', rc.course_id::text, count(*)::integer, null, null, null
    from r join public.registration_courses rc on rc.registration_id = r.id
    group by rc.course_id
    union all
    select 'lunch', lunch_option_id::text, count(*)::integer, null, null, null from r where lunch_option_id is not null group by lunch_option_id
    union all
    select 'choir', choir_part, count(*)::integer, null, null, null from r where choir_part is not null group by choir_part
    union all
    select 'service', service, count(*)::integer, null, null, null from r, unnest(r.services) as service group by service
    union all
    select 'handbook', null, count(*)::integer, null, null, null from r where printed_handbook
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(
    jsonb_build_object('kind', kind, 'key', key, 'count', count, 'name', name, 'parent', parent, 'position', position)
  )), '[]'::jsonb)
  from counts
$function$
;

CREATE OR REPLACE FUNCTION public.set_registration_stopped(p_kind text, p_id uuid, p_stopped boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- 先鎖課程、再排設定成對課程的隊，和設定成對課程、直接改課程的交易同一個順序，不會互相卡住：
    -- 那些交易先碰課程（設定成對課程的外鍵檢查只加 key share，和這裡的 no key update 不衝突），提交時才排隊。
    v_ids := array_remove(array[p_id, public.paired_course(p_id)], null);
    perform 1 from public.courses where id = any(v_ids) order by id for no key update;
    perform pg_advisory_xact_lock(hashtextextended('course_pairs_valid', 0));
    -- 排到隊之後再讀一次成對關係：上鎖期間剛好有人把它設成一組或拆開，就不改，請總管理員再試一次。
    -- 之後才要提交的成對設定會排在這裡後面，看到兩堂不一致而不成立（見 course_pairs_stopped_together）。
    if array_remove(array[p_id, public.paired_course(p_id)], null) <> v_ids then
      raise exception 'course_pair_stopped_apart';
    end if;
    update public.courses c
    set registration_stopped = p_stopped, updated_at = now()
    from public.conferences cf
    where c.id = any(v_ids) and cf.id = c.conference_id and cf.is_current;
  elsif p_kind = 'lunch' then
    update public.lunch_options l
    set registration_stopped = p_stopped, updated_at = now()
    from public.conferences cf
    where l.id = p_id and cf.id = l.conference_id and cf.is_current;
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
$function$
;

CREATE OR REPLACE FUNCTION public.staff_submit_registration(p_venue_id uuid, p_stake_id uuid, p_ward_id uuid, p_name text, p_phone text, p_email text, p_line_id text, p_portrait_consent boolean, p_locale text, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text, p_confirm_full boolean, p_submission_key uuid DEFAULT NULL::uuid)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conference public.conferences;
  v_saved_id uuid;
  v_registration public.registrations;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_allowed';
  end if;

  select * into v_conference from public.conferences where is_current for key share;

  v_saved_id := public.claim_submission(
    p_submission_key,
    'staff_submit',
    public.new_registration_fingerprint(
      p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id, p_portrait_consent, p_course_ids, p_lunch_option_id, p_choir_part, p_services, p_printed_handbook,
      p_role
    ),
    null
  );
  if v_saved_id is not null then
    select * into v_registration from public.registrations where id = v_saved_id;
    return v_registration;
  end if;

  v_registration := public.insert_registration(
    v_conference.id, p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id,
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id,
    p_choir_part, p_services, p_printed_handbook, p_role, coalesce(p_confirm_full, false)
  );
  update public.submissions set registration_id = v_registration.id where key = p_submission_key;
  return v_registration;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.staff_update_registration(p_registration_id uuid, p_phone text, p_email text, p_line_id text, p_venue_id uuid, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text, p_confirm_full boolean, p_submission_key uuid DEFAULT NULL::uuid)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 用過的送出編號不再修改，回傳這一筆現在的內容。
  if public.claim_submission(
    p_submission_key,
    'staff_update',
    public.change_fingerprint(
      p_phone, p_email, p_line_id, p_venue_id, p_course_ids, p_lunch_option_id,
      p_choir_part, p_services, p_printed_handbook, p_role
    ),
    v_registration.id
  ) is not null then
    return v_registration;
  end if;

  return public.change_registration(
    v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
    p_lunch_option_id, p_choir_part, p_services, p_printed_handbook,
    p_role, coalesce(p_confirm_full, false), false
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_registration(p_venue_id uuid, p_stake_id uuid, p_ward_id uuid, p_name text, p_phone text, p_email text, p_line_id text, p_portrait_consent boolean, p_locale text, p_course_ids uuid[] DEFAULT '{}'::uuid[], p_lunch_option_id uuid DEFAULT NULL::uuid, p_choir_part text DEFAULT NULL::text, p_services text[] DEFAULT '{}'::text[], p_printed_handbook boolean DEFAULT false, p_submission_key uuid DEFAULT NULL::uuid)
 RETURNS registrations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_conference public.conferences;
  v_saved_id uuid;
  v_registration public.registrations;
begin
  select * into v_conference from public.conferences where is_current for key share;

  v_saved_id := public.claim_submission(
    p_submission_key,
    'submit',
    public.new_registration_fingerprint(
      p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id, p_portrait_consent, p_course_ids, p_lunch_option_id, p_choir_part, p_services, p_printed_handbook,
      'attendee'
    ),
    null
  );
  if v_saved_id is not null then
    select r.* into v_registration
    from public.registrations r
    join public.submissions s on s.registration_id = r.id
    where s.key = p_submission_key and r.status = 'registered' and r.updated_at <= s.created_at;
    if v_registration.id is null then
      raise exception 'submission_key_reused';
    end if;
    return v_registration;
  end if;

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
  v_registration := public.insert_registration(
    v_conference.id, p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id,
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id,
    p_choir_part, p_services, p_printed_handbook, 'attendee', false
  );
  update public.submissions set registration_id = v_registration.id where key = p_submission_key;
  return v_registration;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_registration(p_registration_id uuid, p_lookup_name text, p_lookup_phone text, p_lookup_registration_number text, p_phone text, p_email text, p_line_id text, p_venue_id uuid, p_course_ids uuid[] DEFAULT '{}'::uuid[], p_lunch_option_id uuid DEFAULT NULL::uuid, p_choir_part text DEFAULT NULL::text, p_services text[] DEFAULT '{}'::text[], p_printed_handbook boolean DEFAULT NULL::boolean, p_submission_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- 中途出錯時，這個區塊裡寫入的全部撤銷（包括記下的送出編號），原本的報名完整保留，錯誤放在回傳值裡。
  -- 前台修改不改身分類別，不能超收，要在報名期間。用過的送出編號不再修改，回傳這一筆現在的內容。
  begin
    if public.claim_submission(
      p_submission_key,
      'update',
      public.change_fingerprint(
        p_phone, p_email, p_line_id, p_venue_id, p_course_ids, p_lunch_option_id, p_choir_part, p_services, p_printed_handbook, null
      ),
      v_registration.id
    ) is null then
      v_registration := public.change_registration(
        v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
        p_lunch_option_id, p_choir_part, p_services, p_printed_handbook,
        null, false, true
      );
    end if;
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
$function$
;

-- 新建的函式照之前的權限：內部步驟誰都不能直接呼叫，入口函式和之前一樣開放。
revoke all on function public.check_registration_choices from public, anon, authenticated, service_role;
revoke all on function public.insert_registration from public, anon, authenticated, service_role;
revoke all on function public.change_registration from public, anon, authenticated, service_role;
revoke all on function public.new_registration_fingerprint from public, anon, authenticated, service_role;
revoke all on function public.change_fingerprint from public, anon, authenticated, service_role;
revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;
revoke all on function public.update_registration from public, anon, authenticated;
grant execute on function public.update_registration to service_role;
revoke all on function public.staff_submit_registration from public, anon;
revoke all on function public.staff_update_registration from public, anon;
grant execute on function public.staff_submit_registration to authenticated;
grant execute on function public.staff_update_registration to authenticated;
