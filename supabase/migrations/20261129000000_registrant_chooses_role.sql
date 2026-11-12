-- 報名者自己選身分類別（#132）：前台報名、修改都可以選，不再一律是與會姐妹。

/*
 * submit_registration、update_registration 多了最後一個參數 p_role，其他和
 * 20261106000001_drop_afternoon_activity_functions.sql 的版本相同。
 * - 新增：沒送（還沒更新的舊版報名表）當成與會姐妹。
 * - 修改：沒送（還沒更新的舊版查詢頁）保留原本的身分類別，不會把總管理員設好的改掉。
 * 身分類別不認得時，資料表的 registrations_role_valid 擋下。
 * 參數變了要先刪掉舊的，不然會多出一個同名的函式。
 */
drop function public.submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, text, text[], boolean, uuid
);

create function public.submit_registration(
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
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default false,
  p_submission_key uuid default null,
  p_role text default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_role text := coalesce(p_role, 'attendee');
  v_saved_id uuid;
  v_registration public.registrations;
begin
  select * into v_conference from public.conferences where is_current for key share;

  v_saved_id := public.claim_submission(
    p_submission_key,
    'submit',
    public.new_registration_fingerprint(
      p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id, p_portrait_consent,
      p_course_ids, p_lunch_option_id, p_choir_part, p_services, p_printed_handbook, v_role
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

  -- 前台不能超收。
  v_registration := public.insert_registration(
    v_conference.id, p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id,
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id,
    p_choir_part, p_services, p_printed_handbook, v_role, false
  );
  update public.submissions set registration_id = v_registration.id where key = p_submission_key;
  return v_registration;
end;
$$;

revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;

drop function public.update_registration(
  uuid, text, text, text, text, text, text, uuid, uuid[], uuid, text, text[], boolean, uuid
);

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
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default null,
  p_submission_key uuid default null,
  p_role text default null
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

  -- 中途出錯時，這個區塊裡寫入的全部撤銷（包括記下的送出編號），原本的報名完整保留，錯誤放在回傳值裡。
  -- 前台修改不能超收，要在報名期間；身分類別沒送來時保留原本的。用過的送出編號不再修改，回傳這一筆現在的內容。
  begin
    if public.claim_submission(
      p_submission_key,
      'update',
      public.change_fingerprint(
        p_phone, p_email, p_line_id, p_venue_id, p_course_ids, p_lunch_option_id, p_choir_part, p_services,
        p_printed_handbook, p_role
      ),
      v_registration.id
    ) is null then
      v_registration := public.change_registration(
        v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
        p_lunch_option_id, p_choir_part, p_services, p_printed_handbook,
        p_role, false, true
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
$$;

-- 和 20261019000000_cancel_registration.sql 一樣，只有網站伺服器能呼叫（ADR 0009）。
revoke all on function public.update_registration from public, anon, authenticated;
grant execute on function public.update_registration to service_role;

-- 查詢多回傳身分類別，修改時報名表才帶得出她原本選的。其他和之前的版本相同。
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
      r.lunch_option_id, r.choir_part, r.services, r.printed_handbook, r.role,
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

-- 確認信多列身分類別：開始寄信時多給 role。其他和 20261106000001_drop_afternoon_activity_functions.sql 的版本相同。
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
      'role', r.role, 'locale', r.locale,
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
