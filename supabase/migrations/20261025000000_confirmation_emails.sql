-- 報名語言與確認信的寄信紀錄（#14）。

-- 報名語言：送出當下的畫面語言，確認信依這個語言寄送（ADR 0008）。
-- 新增這個欄位前已存在的報名一律補為 zh；之後的報名必須由 submit_registration 明確帶入。
alter table public.registrations
  add column locale text not null default 'zh',
  add constraint registrations_locale_valid check (locale in ('zh', 'en'));
alter table public.registrations alter column locale drop default;

-- 清除個資的時間（ADR 0008）。清除功能在 #26 實作；寄信紀錄寫回結果時先用它判斷要不要丟棄含個資的內容。
alter table public.conferences add column personal_data_cleared_at timestamptz;

/*
 * 寄信紀錄：每封確認信一筆，記下類型、寄送時間與結果。寄信失敗不影響報名，只在這裡記下失敗。
 * 收件地址與錯誤回應可能含個資：清除個資時（#26）要在同一個交易內一起清掉。
 */
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.registrations (id) on delete cascade,
  -- 報名、修改、取消各一種。
  kind text not null,
  -- 寄出當下的收件地址。
  recipient text,
  -- 寄送中、已寄出、失敗。寄送中的紀錄沒寫回結果，表示寄信的工作中途停掉了。
  status text not null default 'sending',
  error text,
  -- Resend 回傳的信件編號，查寄送狀況用。
  provider_message_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint email_logs_kind_valid check (kind in ('registered', 'updated', 'cancelled')),
  constraint email_logs_status_valid check (status in ('sending', 'sent', 'failed')),
  constraint email_logs_finished_at check ((status = 'sending') = (finished_at is null))
);

create index email_logs_registration_id on public.email_logs (registration_id, created_at);

alter table public.email_logs enable row level security;
-- 只有網站伺服器透過下面的函式寫入。後台檢視在 #18 開放。
revoke all on public.email_logs from anon, authenticated;

/*
 * 開始寄一封確認信：記下一筆寄送中的寄信紀錄，回傳寫信需要的報名資料。
 * 以下情況不寄，回傳 {}：
 * - Email 是空的，或該年度已清除個資。
 * - 報名、修改的信輪到寄出時，這筆報名已經取消（例如報名後馬上取消）：不寄跟取消信矛盾的內容。
 * - 取消信已經寄過：已取消的報名再按一次取消照樣成功，不能拿來一直寄信到她的信箱。
 * 鎖住報名（for share）：和清除個資搶同一筆，清除先完成就讀到空的 Email；
 * 這裡先完成，清除會等這筆寄信紀錄寫入後再一起清掉。
 */
create function public.begin_confirmation_email(p_registration_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found jsonb;
  v_log_id uuid;
begin
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
      'ward_name_zh', w.name_zh, 'ward_name_en', w.name_en
    )
  into v_found
  from public.registrations r
  join public.conferences c on c.id = r.conference_id
  join public.stakes s on s.id = r.stake_id
  join public.wards w on w.id = r.ward_id
  where r.id = p_registration_id and r.email is not null and c.personal_data_cleared_at is null
    and (r.status = 'cancelled') = (p_kind = 'cancelled')
    and not (
      p_kind = 'cancelled'
      and exists (
        select 1 from public.email_logs l where l.registration_id = r.id and l.kind = 'cancelled'
      )
    )
  for share of r;

  if v_found is null then
    return '{}';
  end if;

  insert into public.email_logs (registration_id, kind, recipient)
  values (p_registration_id, p_kind, v_found ->> 'email')
  returning id into v_log_id;

  return jsonb_build_object('log_id', v_log_id, 'registration', v_found);
end;
$$;

/*
 * 寫回寄送結果。寄信期間該年度剛好清除了個資（ADR 0008）時，只更新寄送結果，
 * 不寫入錯誤回應（可能含收件地址或姓名），收件地址也一併清空。
 * 先鎖住這筆寄信紀錄再看清除時間：清除在同一個交易裡也會改這筆紀錄，
 * 所以拿到鎖時，清除不是已經完成（看得到清除時間），就是還沒開始（之後會清掉這裡寫的內容）。
 * 只寫回寄送中的紀錄，重複寫回不會蓋掉第一次的結果。
 */
create function public.finish_email_log(
  p_log_id uuid,
  p_sent boolean,
  p_error text,
  p_provider_message_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registration_id uuid;
  v_cleared boolean;
begin
  select registration_id into v_registration_id
  from public.email_logs
  where id = p_log_id and status = 'sending'
  for update;
  if v_registration_id is null then
    return;
  end if;

  select c.personal_data_cleared_at is not null into v_cleared
  from public.registrations r
  join public.conferences c on c.id = r.conference_id
  where r.id = v_registration_id;

  update public.email_logs
  set
    status = case when p_sent then 'sent' else 'failed' end,
    finished_at = now(),
    error = case when v_cleared or p_sent then null else left(p_error, 1000) end,
    provider_message_id = p_provider_message_id,
    recipient = case when v_cleared then null else recipient end
  where id = p_log_id;
end;
$$;

revoke all on function public.begin_confirmation_email from public, anon, authenticated;
revoke all on function public.finish_email_log from public, anon, authenticated;
grant execute on function public.begin_confirmation_email to service_role;
grant execute on function public.finish_email_log to service_role;

/*
 * 報名服務的送出：多了必填的報名語言（p_locale），其他規則與之前相同
 * （見 20261017000000_update_registration.sql）。
 */
drop function public.submit_registration(
  uuid, uuid, uuid, text, text, text, text, boolean, uuid[], uuid, uuid, text, text[], boolean
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

revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;
