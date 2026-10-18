-- 回應斷掉後重送（#60）：送出報名、修改報名都帶一個送出編號，同一個編號再送一次，回傳上次存下的結果。

/*
 * 送出報名後資料庫已經存好，但回覆傳回畫面的途中斷了，她（或總管理員）以為沒存到又按一次：
 * 新增會多出一筆一模一樣的報名，修改會多寄一封「報名已修改」的信。前台與後台的新增、修改都有這個情況；
 * 取消不受影響（已取消的再取消照樣成功，取消信只寄一次）。
 *
 * 畫面每次送出帶一個隨機的送出編號（uuid），同一次填表重按時沿用；內容改了或送出成功之後就換新的。
 * 存下報名時在同一個交易裡記下這個編號。同一個編號再送來時，不再新增、不再修改，回傳那一筆報名現在的內容；
 * 確認信也依送出編號只寄一封（email_logs_one_per_submission）。
 *
 * 送出編號不能拿來讀別人的報名：記下的除了編號，還有是哪一種送出、送出內容的雜湊（fingerprint）。
 * 重送時三者都要一樣，才回傳那一筆；內容一樣表示送的人本來就知道這些資料。修改還要是同一筆報名，
 * 而且照常先比對姓名與電話（前台）或確認是總管理員（後台）。不一樣時丟出 submission_key_reused，
 * 什麼都不改（畫面在內容改了時會換新的編號，正常使用不會碰到）。
 * 存雜湊、不存內容：送出內容含個資。姓名、電話猜得到，雜湊仍可能被逐一比對出來，所以紀錄只留一天
 * （重送都在幾分鐘內），之後記下新編號時順手刪掉（claim_submission）。
 * 報名語言不算在內容裡：她重送前切換了畫面語言，仍是同一次送出。
 *
 * 後台確認超收時重送的是同一份內容，雜湊不含確認旗標：沒帶旗標被拒時什麼都沒存，編號也沒被用掉。
 * 任何一步不通過時，記下的編號跟著報名一起撤銷，改好之後用同一個編號再送照樣成功。
 */
create table public.submissions (
  key uuid primary key,
  -- submit、update 是前台的新增、修改，staff_submit、staff_update 是後台的。
  kind text not null,
  fingerprint text not null,
  -- 新增報名時先記下編號、存好報名後才填上；交易提交時一定有值。報名刪除時一起刪除。
  registration_id uuid references public.registrations (id) on delete cascade,
  created_at timestamptz not null default now(),

  constraint submissions_kind_valid check (kind in ('submit', 'update', 'staff_submit', 'staff_update'))
);

create index submissions_registration_id on public.submissions (registration_id);
create index submissions_created_at on public.submissions (created_at);

alter table public.submissions enable row level security;
-- 只由下面的函式讀寫。
revoke all on public.submissions from anon, authenticated;

-- 送出內容的雜湊。jsonb 的文字形式固定依鍵排序，同樣的內容得到同樣的雜湊。
create function public.submission_fingerprint(p_values jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(p_values::text, 'UTF8')), 'hex');
$$;

/*
 * 記下送出編號。第一次用這個編號時記下並回傳 null，照常存報名；用過的編號回傳當時的報名 id，不必再存。
 * 編號是 null 時（直接呼叫資料庫、沒帶編號）不記，照常存報名。
 * 同一個編號同時送來兩次時，後到的等先到的提交（唯一索引），再看到它記下的報名；先到的撤銷了就換後到的記。
 * 順手刪掉一天以前的紀錄（見開頭）；別的送出正在刪的跳過，不必等它。
 */
create function public.claim_submission(p_key uuid, p_kind text, p_fingerprint text, p_registration_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_submission public.submissions;
begin
  if p_key is null then
    return null;
  end if;

  delete from public.submissions
  where key in (
    select key from public.submissions where created_at < now() - interval '1 day' for update skip locked
  );

  insert into public.submissions (key, kind, fingerprint, registration_id)
  values (p_key, p_kind, p_fingerprint, p_registration_id)
  on conflict (key) do nothing;
  if found then
    return null;
  end if;

  select * into v_submission from public.submissions where key = p_key;
  if v_submission.kind <> p_kind
    or v_submission.fingerprint <> p_fingerprint
    or (p_registration_id is not null and v_submission.registration_id <> p_registration_id)
  then
    raise exception 'submission_key_reused';
  end if;
  return v_submission.registration_id;
end;
$$;

revoke all on function public.submission_fingerprint from public, anon, authenticated, service_role;
revoke all on function public.claim_submission from public, anon, authenticated, service_role;

-- 新增報名的送出內容。後台多了身分類別；報名語言、確認超收的旗標不算在內（見開頭）。
create function public.new_registration_fingerprint(
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean,
  p_course_ids uuid[],
  p_lunch_option_id uuid,
  p_afternoon_activity_id uuid,
  p_choir_part text,
  p_services text[],
  p_printed_handbook boolean,
  p_role text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.submission_fingerprint(jsonb_build_object(
    'venue_id', p_venue_id, 'stake_id', p_stake_id, 'ward_id', p_ward_id, 'name', p_name, 'phone', p_phone,
    'email', p_email, 'line_id', p_line_id, 'portrait_consent', p_portrait_consent,
    'course_ids', p_course_ids, 'lunch_option_id', p_lunch_option_id,
    'afternoon_activity_id', p_afternoon_activity_id, 'choir_part', p_choir_part, 'services', p_services,
    'printed_handbook', p_printed_handbook, 'role', p_role
  ));
$$;

-- 修改報名的送出內容。前台不改身分類別，p_role 是 null。
create function public.change_fingerprint(
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
  p_role text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select public.submission_fingerprint(jsonb_build_object(
    'phone', p_phone, 'email', p_email, 'line_id', p_line_id, 'venue_id', p_venue_id,
    'course_ids', p_course_ids, 'lunch_option_id', p_lunch_option_id,
    'afternoon_activity_id', p_afternoon_activity_id, 'choir_part', p_choir_part, 'services', p_services,
    'printed_handbook', p_printed_handbook, 'role', p_role
  ));
$$;

revoke all on function public.new_registration_fingerprint from public, anon, authenticated, service_role;
revoke all on function public.change_fingerprint from public, anon, authenticated, service_role;

/*
 * 下面四個入口函式多了最後一個參數 p_submission_key，其他和 20261031000000_staff_registration_editing.sql 的版本相同。
 * 參數變了要先刪掉舊的，不然會多出一個同名的函式。
 */
drop function public.submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, uuid, text, text[], boolean
);
drop function public.update_registration(
  uuid, text, text, text, text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean
);
drop function public.staff_submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, text, uuid[], uuid, uuid, text, text[], boolean, text, boolean
);
drop function public.staff_update_registration(
  uuid, text, text, text, uuid, uuid[], uuid, uuid, text, text[], boolean, text, boolean
);

-- 重送時先回傳上次存下的報名，才看報名期間：截止前一刻存好、重送時剛好截止，她看到的仍是報名成功。
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
  p_afternoon_activity_id uuid default null,
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default false,
  p_submission_key uuid default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
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
      p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id, p_portrait_consent, p_course_ids, p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
      'attendee'
    ),
    null
  );
  if v_saved_id is not null then
    select * into v_registration from public.registrations where id = v_saved_id;
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
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    p_choir_part, p_services, p_printed_handbook, 'attendee', false
  );
  update public.submissions set registration_id = v_registration.id where key = p_submission_key;
  return v_registration;
end;
$$;

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
  p_printed_handbook boolean default null,
  p_submission_key uuid default null
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
  -- 前台修改不改身分類別，不能超收，要在報名期間。用過的送出編號不再修改，回傳這一筆現在的內容。
  begin
    if public.claim_submission(
      p_submission_key,
      'update',
      public.change_fingerprint(
        p_phone, p_email, p_line_id, p_venue_id, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
        p_choir_part, p_services, p_printed_handbook, null
      ),
      v_registration.id
    ) is null then
      v_registration := public.change_registration(
        v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
        p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
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
$$;

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
  p_confirm_full boolean,
  p_submission_key uuid default null
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
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
      p_venue_id, p_stake_id, p_ward_id, p_name, p_phone, p_email, p_line_id, p_portrait_consent, p_course_ids, p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
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
    p_portrait_consent, p_locale, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
    p_choir_part, p_services, p_printed_handbook, p_role, coalesce(p_confirm_full, false)
  );
  update public.submissions set registration_id = v_registration.id where key = p_submission_key;
  return v_registration;
end;
$$;

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
  p_confirm_full boolean,
  p_submission_key uuid default null
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

  -- 用過的送出編號不再修改，回傳這一筆現在的內容。
  if public.claim_submission(
    p_submission_key,
    'staff_update',
    public.change_fingerprint(
      p_phone, p_email, p_line_id, p_venue_id, p_course_ids, p_lunch_option_id, p_afternoon_activity_id,
      p_choir_part, p_services, p_printed_handbook, p_role
    ),
    v_registration.id
  ) is not null then
    return v_registration;
  end if;

  return public.change_registration(
    v_registration, v_conference.id, p_phone, p_email, p_line_id, p_venue_id, p_course_ids,
    p_lunch_option_id, p_afternoon_activity_id, p_choir_part, p_services, p_printed_handbook,
    p_role, coalesce(p_confirm_full, false), false
  );
end;
$$;

revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;
-- 和 20261019000000_cancel_registration.sql 一樣，只有網站伺服器能呼叫（ADR 0009）。
revoke all on function public.update_registration from public, anon, authenticated;
grant execute on function public.update_registration to service_role;
revoke all on function public.staff_submit_registration from public, anon;
revoke all on function public.staff_update_registration from public, anon;
grant execute on function public.staff_submit_registration to authenticated;
grant execute on function public.staff_update_registration to authenticated;

/*
 * 確認信依送出編號只寄一封：重送時同一個編號的信已經寄過（或正在寄）就不再寄。
 * 第一次的信沒寄成（寄信失敗，或伺服器中途停了、還沒開始寄），重送時才寄出。
 * 開始寄信多了最後一個參數 p_submission_key，其他和 20261025000000_confirmation_emails.sql 的版本相同。
 */
alter table public.email_logs add column submission_key uuid;
create unique index email_logs_one_per_submission on public.email_logs (submission_key) where status <> 'failed';

drop function public.begin_confirmation_email(uuid, text);

create function public.begin_confirmation_email(p_registration_id uuid, p_kind text, p_submission_key uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      'lunch_option_id', r.lunch_option_id, 'afternoon_activity_id', r.afternoon_activity_id,
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
        'afternoon_activities', coalesce((
          select jsonb_agg(
            jsonb_build_object('id', a.id, 'title_zh', a.title_zh, 'title_en', a.title_en)
            order by a.position, a.id
          )
          from public.afternoon_activities a where a.venue_id = v.id
        ), '[]')
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
$$;

revoke all on function public.begin_confirmation_email from public, anon, authenticated;
grant execute on function public.begin_confirmation_email to service_role;
