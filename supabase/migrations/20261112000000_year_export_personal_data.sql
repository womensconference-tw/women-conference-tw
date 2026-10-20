/*
 * 大會結束後下載年度 Excel，確認存好再清除個資（#26，ADR 0008）。
 *
 * - 每個年度有資料版本號（conference_data_versions）：凡會改變年度 Excel 內容的寫入，成功時在同一個交易內加一，失敗的交易不加。
 *   版本在交易提交時才加（延後到提交才執行的觸發器），版本那一列只在提交的一瞬間被鎖住，同時送出的報名不會互相卡住整個交易。
 *   版本號另外放一張表，不放在年度上：後台修改年度內容（鎖住年度那一列）時，報名照樣提交得了。
 *   同一個交易改了很多筆，只加一（見 bump_data_version）。
 * - 下載（start_year_export）：名單、場次對照與版本號在同一個指令裡讀，是同一個資料快照；同一個指令先記一筆還沒完成的匯出紀錄。
 *   網站把 Excel 完整產生之後才呼叫 complete_year_export 標成完成；產檔失敗的紀錄一直沒完成，畫面不列、也不能拿來清除。
 * - 清除（clear_personal_data）：綁定畫面上那一筆匯出紀錄。先鎖住年度那一列（for update），和報名送出、修改、取消搶同一把鎖
 *   （它們都先拿 for key share），再比對版本號；不相等就拒絕，請總管理員重新下載。
 * - 已清除的報名允許姓名、電話、報名編號都是空的；還沒清除的照原本的規則。清除之後不能再新增或修改這個年度的報名。
 */

-- 大會只記日期；「大會結束」是大會日期翌日的台北時間 00:00（ADR 0008）。
create function public.conference_ended(p_conference_date date, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_at >= ((p_conference_date + 1)::timestamp at time zone 'Asia/Taipei');
$$;

create table public.conference_data_versions (
  conference_id uuid primary key references public.conferences (id) on delete cascade,
  version bigint not null default 0
);

alter table public.conference_data_versions enable row level security;
-- 只由資料庫函式讀寫。
revoke all on public.conference_data_versions from anon, authenticated;

insert into public.conference_data_versions (conference_id) select id from public.conferences;

-- 每個年度一建立就有版本號；年度被刪除時一起刪除。
create function public.conferences_data_version_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.conference_data_versions (conference_id) values (new.id);
  return null;
end;
$$;

create trigger conferences_data_version_row
  after insert on public.conferences
  for each row execute function public.conferences_data_version_row();

-- 已清除的報名記下清除時間；資料表限制靠它分辨要不要照原本的規則檢查。
alter table public.registrations add column personal_data_cleared_at timestamptz;
alter table public.registrations alter column name drop not null;
alter table public.registrations
  drop constraint registrations_name_valid,
  add constraint registrations_name_valid check (
    case when personal_data_cleared_at is null
      then name is not null and public.trim_blank(name) <> '' and char_length(name) <= 50
      else name is null and phone is null and registration_number is null and email is null
        and line_id is null and submitted_phone is null
    end
  ),
  drop constraint registrations_phone_or_number,
  add constraint registrations_phone_or_number check (
    personal_data_cleared_at is not null or (phone is null) <> (registration_number is null)
  );

/*
 * 資料版本號加一：版本那一列在交易提交時才鎖，同一個交易對同一個年度只加一次
 * （記在只到交易結束的設定裡，用交易編號分辨，換了交易就不算）。以擁有者的權限執行，才改得到年度。
 */
create function public.bump_data_version(p_conference_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_setting text := 'app.data_version_bumped_' || replace(p_conference_id::text, '-', '_');
begin
  if p_conference_id is null or current_setting(v_setting, true) = txid_current()::text then
    return;
  end if;
  -- 先拿年度的 for key share，和報名送出、修改、取消一樣：清除個資（for update）進行中時，
  -- 會改變 Excel 的寫入（包括不經過報名函式的場地、課程名稱修改）要等清除結束才能提交，排在清除之後；
  -- 已經拿到鎖的，清除要等它提交、讀到加過的版本號而拒絕。清除讀版本號與清除之間不會被插隊。
  perform 1 from public.conferences where id = p_conference_id for key share;
  -- 年度在同一個交易裡被刪除時，版本那一列也不在了，不必加。
  update public.conference_data_versions set version = version + 1 where conference_id = p_conference_id;
  perform set_config(v_setting, txid_current()::text, true);
end;
$$;

revoke all on function public.bump_data_version(uuid) from public, anon, authenticated;

-- 有 conference_id 欄位的資料表（報名、場地、場次、課程、午餐）共用：新的、舊的所屬年度都加。
create function public.data_version_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.bump_data_version(old.conference_id);
  end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.conference_id is distinct from old.conference_id) then
    perform public.bump_data_version(new.conference_id);
  end if;
  return null;
end;
$$;

-- 選課紀錄沒有 conference_id，從報名找。年度整個被刪除時找不到，也就不必加。
create function public.registration_courses_data_version_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    perform public.bump_data_version((select conference_id from public.registrations where id = old.registration_id));
  end if;
  if tg_op <> 'DELETE' then
    perform public.bump_data_version((select conference_id from public.registrations where id = new.registration_id));
  end if;
  return null;
end;
$$;

-- 報名與選課：任何新增、修改、取消都算（包括後台改身分類別、超收新增，以及只改到聯絡方式的修改）。
create constraint trigger registrations_data_version
  after insert or update or delete on public.registrations
  deferrable initially deferred
  for each row execute function public.data_version_changed();

create constraint trigger registration_courses_data_version
  after insert or update or delete on public.registration_courses
  deferrable initially deferred
  for each row execute function public.registration_courses_data_version_changed();

-- 場地、場次、課程、午餐：新增、刪除，以及 Excel 上看得到的名稱、順序改了才算。只調名額、停止或重新開放報名、改教室不算。
create constraint trigger venues_data_version
  after insert or delete on public.venues
  deferrable initially deferred
  for each row execute function public.data_version_changed();
create constraint trigger venues_data_version_update
  after update on public.venues
  deferrable initially deferred
  for each row
  when (old.name_zh is distinct from new.name_zh or old.position is distinct from new.position
    or old.conference_id is distinct from new.conference_id)
  execute function public.data_version_changed();

create constraint trigger sessions_data_version
  after insert or delete on public.sessions
  deferrable initially deferred
  for each row execute function public.data_version_changed();
create constraint trigger sessions_data_version_update
  after update on public.sessions
  deferrable initially deferred
  for each row
  when (old.name_zh is distinct from new.name_zh or old.position is distinct from new.position
    or old.venue_id is distinct from new.venue_id or old.conference_id is distinct from new.conference_id)
  execute function public.data_version_changed();

create constraint trigger courses_data_version
  after insert or delete on public.courses
  deferrable initially deferred
  for each row execute function public.data_version_changed();
create constraint trigger courses_data_version_update
  after update on public.courses
  deferrable initially deferred
  for each row
  when (old.title_zh is distinct from new.title_zh or old.session_id is distinct from new.session_id
    or old.conference_id is distinct from new.conference_id)
  execute function public.data_version_changed();

create constraint trigger lunch_options_data_version
  after insert or delete on public.lunch_options
  deferrable initially deferred
  for each row execute function public.data_version_changed();
create constraint trigger lunch_options_data_version_update
  after update on public.lunch_options
  deferrable initially deferred
  for each row
  when (old.name_zh is distinct from new.name_zh or old.venue_id is distinct from new.venue_id
    or old.conference_id is distinct from new.conference_id)
  execute function public.data_version_changed();

/*
 * 清除之後不能再新增或修改這個年度的報名（前台、後台都一樣）。清除本身先改報名、最後才記下年度的清除時間，不會被這裡擋下。
 * 清除時鎖住年度那一列，等著送出、修改的交易拿到鎖之後才讀年度，讀到的就是清除之後的。
 */
create function public.registrations_after_personal_data_cleared()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.conferences
    where id = new.conference_id and personal_data_cleared_at is not null
  ) then
    raise exception 'personal_data_cleared';
  end if;
  return new;
end;
$$;

create trigger registrations_after_personal_data_cleared
  before insert or update on public.registrations
  for each row execute function public.registrations_after_personal_data_cleared();

-- 後台與前台的修改共用這一步：已清除的報名直接以 personal_data_cleared 拒絕，畫面才說得出原因。
-- 其他和 20261106000001_drop_afternoon_activity_functions.sql 的版本相同。
CREATE OR REPLACE FUNCTION public.change_registration(p_registration public.registrations, p_conference_id uuid, p_phone text, p_email text, p_line_id text, p_venue_id uuid, p_course_ids uuid[], p_lunch_option_id uuid, p_choir_part text, p_services text[], p_printed_handbook boolean, p_role text, p_allow_full boolean, p_require_open boolean) RETURNS public.registrations
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
declare
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_held_course_ids uuid[];
  v_registration public.registrations;
begin
  -- 已清除個資的報名不能再修改（清除後電話是空的，不先擋下的話會被當成電話不對）。
  if p_registration.personal_data_cleared_at is not null then
    raise exception 'personal_data_cleared';
  end if;

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
$$;

revoke all on function public.change_registration from public, anon, authenticated, service_role;

-- 匯出紀錄：哪一份 Excel、是哪個資料版本、幾筆有效報名、誰在什麼時候下載。completed_at 空著表示 Excel 沒有產生完成。
create table public.year_exports (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  data_version bigint not null,
  registration_count integer not null,
  exported_by uuid references auth.users (id) on delete set null,
  -- 下載者當時的名字（沒填名字時是 Email）；帳號之後被移除也看得出是誰。
  exported_by_name text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index year_exports_conference_id on public.year_exports (conference_id, created_at);

alter table public.year_exports enable row level security;

create policy "Admins can read year exports"
  on public.year_exports for select
  to authenticated
  using ((select public.is_staff_admin()));

-- 只透過下面的函式寫入。
revoke all on public.year_exports from anon;
revoke insert, update, delete, truncate on public.year_exports from authenticated;

/*
 * 開始下載年度 Excel：只有總管理員、只在大會結束之後、還沒清除個資時。
 * 回傳匯出紀錄的編號，以及產生 Excel 需要的全部內容：
 * - venues：依顯示順序的場地，每個場地依順序列出設定的全部場次（沒有開課的也列，報名者在那一欄是「不選課」）。
 * - registrations：有效報名（已取消的不列），依場地順序、報名先後排序；courses 是「場次編號 → 所選課程名稱」。
 * 名單、場次、版本號與記下匯出紀錄都在同一個指令裡，讀的是同一個資料快照：產檔期間有人修改，這份紀錄仍是讀到的那個版本。
 */
create function public.start_year_export(p_conference_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_result jsonb;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  select * into v_conference from public.conferences where id = p_conference_id;
  if v_conference.id is null then
    raise exception 'not_found';
  end if;
  if not public.conference_ended(v_conference.conference_date, now()) then
    raise exception 'conference_not_ended';
  end if;

  with conference as (
    select c.id, d.version as data_version, c.personal_data_cleared_at
    from public.conferences c
    join public.conference_data_versions d on d.conference_id = c.id
    where c.id = p_conference_id
  ),
  roster as (
    select r.id, r.name, r.venue_id, r.locale, l.name_zh as lunch, r.role, r.choir_part, r.services,
      r.printed_handbook, v.position as venue_position, r.created_at
    from public.registrations r
    join public.venues v on v.id = r.venue_id
    left join public.lunch_options l on l.id = r.lunch_option_id
    where r.conference_id = p_conference_id and r.status = 'registered'
  ),
  recorded as (
    insert into public.year_exports (conference_id, data_version, registration_count, exported_by, exported_by_name)
    select c.id, c.data_version, (select count(*) from roster), (select auth.uid()),
      coalesce(
        (select coalesce(s.name, u.email) from public.staff_members s join auth.users u on u.id = s.user_id
          where s.user_id = (select auth.uid())),
        ''
      )
    from conference c
    where c.personal_data_cleared_at is null
    returning id, data_version, registration_count
  )
  select jsonb_build_object(
    'export_id', recorded.id,
    'data_version', recorded.data_version,
    'registration_count', recorded.registration_count,
    'venues', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', v.id,
          'name', v.name_zh,
          'sessions', coalesce((
            select jsonb_agg(jsonb_build_object('id', se.id, 'name', se.name_zh) order by se.position, se.id)
            from public.sessions se
            where se.venue_id = v.id
          ), '[]')
        )
        order by v.position, v.id
      )
      from public.venues v
      where v.conference_id = p_conference_id
    ), '[]'),
    'registrations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', ro.name,
          'venue_id', ro.venue_id,
          'locale', ro.locale,
          'lunch', ro.lunch,
          'role', ro.role,
          'choir_part', ro.choir_part,
          'services', to_jsonb(ro.services),
          'printed_handbook', ro.printed_handbook,
          'courses', coalesce((
            select jsonb_object_agg(co.session_id, co.title_zh)
            from public.registration_courses rc
            join public.courses co on co.id = rc.course_id
            where rc.registration_id = ro.id
          ), '{}')
        )
        order by ro.venue_position, ro.venue_id, ro.created_at, ro.id
      )
      from roster ro
    ), '[]')
  )
  into v_result
  from recorded;

  -- 已清除個資時沒有記下匯出紀錄（也就沒有結果）。
  if v_result is null then
    raise exception 'personal_data_cleared';
  end if;
  return v_result;
end;
$$;

revoke all on function public.start_year_export(uuid) from public, anon;
grant execute on function public.start_year_export(uuid) to authenticated;

/*
 * Excel 完整產生了：把自己開始的那一筆匯出紀錄標成完成，之後才列在清除畫面上、才能拿來清除。
 * 已經清除個資的年度不再標（清除之後不能下載）。
 */
create function public.complete_year_export(p_export_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  -- 產檔期間別的總管理員清除了個資：照實說，不要說成找不到。
  if exists (
    select 1 from public.year_exports e join public.conferences c on c.id = e.conference_id
    where e.id = p_export_id and c.personal_data_cleared_at is not null
  ) then
    raise exception 'personal_data_cleared';
  end if;

  update public.year_exports e
  set completed_at = now()
  from public.conferences c
  where e.id = p_export_id and e.exported_by = (select auth.uid()) and e.completed_at is null
    and c.id = e.conference_id and c.personal_data_cleared_at is null;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.complete_year_export(uuid) from public, anon;
grant execute on function public.complete_year_export(uuid) to authenticated;

/*
 * 確認 Excel 已存好之後清除一個年度的個資。p_export_id 是畫面上勾選的那一筆匯出紀錄，要屬於 p_conference_id 這個年度、
 * 已完成、是自己下載的（各自確認自己那一份，ADR 0008），而且它的資料版本號仍是目前的版本；p_confirmed 是「Excel 已存好、打得開」有沒有勾。
 * 清除該年度全部報名（含已取消）的姓名、電話、報名編號、Email、LINE ID、送出時使用的電話，
 * 寄信紀錄的收件地址與錯誤回應，以及送出編號紀錄（裡面的指紋是用姓名、電話算的）。保留的欄位不動。
 * 全部在同一個交易裡：中途失敗就全部回復、不記清除時間。已清除過的回傳已完成，清除時間不變。
 */
create function public.clear_personal_data(p_conference_id uuid, p_export_id uuid, p_confirmed boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.year_exports;
  v_conference public.conferences;
  v_cleared_at timestamptz := clock_timestamp();
  v_count integer;
  v_version bigint;
begin
  perform public.reject_read_only();
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  -- 和報名送出、修改、取消同一把鎖：它們先拿 for key share，這裡要等它們提交，之後的也要等這裡結束。
  select * into v_conference from public.conferences where id = p_conference_id for update;
  if v_conference.id is null then
    raise exception 'not_found';
  end if;
  -- 等鎖的期間被移出工作人員名單的話，不清除。
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  if v_conference.personal_data_cleared_at is not null then
    return jsonb_build_object('cleared_at', v_conference.personal_data_cleared_at, 'already_cleared', true);
  end if;
  if not public.conference_ended(v_conference.conference_date, now()) then
    raise exception 'conference_not_ended';
  end if;
  if p_confirmed is not true then
    raise exception 'not_confirmed';
  end if;

  select * into v_export
  from public.year_exports
  where id = p_export_id and conference_id = p_conference_id and completed_at is not null;
  if v_export.id is null then
    raise exception 'export_not_found';
  end if;
  if v_export.exported_by is distinct from (select auth.uid()) then
    raise exception 'export_not_mine';
  end if;
  -- 年度那一列已經鎖住，這時才讀版本號：先拿到鎖的修改都已提交，版本號也加好了。
  select version into v_version from public.conference_data_versions where conference_id = p_conference_id;
  if v_export.data_version is distinct from v_version then
    raise exception 'export_outdated';
  end if;

  update public.registrations
  set name = null, phone = null, registration_number = null, email = null, line_id = null,
    submitted_phone = null, personal_data_cleared_at = v_cleared_at
  where conference_id = p_conference_id;
  get diagnostics v_count = row_count;

  update public.email_logs
  set recipient = null, error = null
  where registration_id in (select id from public.registrations where conference_id = p_conference_id);

  delete from public.submissions
  where registration_id in (select id from public.registrations where conference_id = p_conference_id);

  update public.conferences set personal_data_cleared_at = v_cleared_at where id = p_conference_id;

  return jsonb_build_object('cleared_at', v_cleared_at, 'already_cleared', false, 'cleared_count', v_count);
end;
$$;

revoke all on function public.clear_personal_data(uuid, uuid, boolean) from public, anon;
grant execute on function public.clear_personal_data(uuid, uuid, boolean) to authenticated;

/*
 * 清除畫面要的內容（只有總管理員）：大會結束了沒、清除時間、該年度全部報名的筆數（含已取消，也就是將清除個資的筆數），
 * 以及已完成的匯出紀錄（新的在前），每一筆標出下載之後資料有沒有變動（outdated：不能拿來清除，要重新下載）、
 * 是不是自己下載的（mine：只能用自己下載的那一份清除）。
 */
create function public.year_export_overview(p_conference_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  select jsonb_build_object(
    'ended', public.conference_ended(c.conference_date, now()),
    'cleared_at', c.personal_data_cleared_at,
    'registration_total', (select count(*) from public.registrations r where r.conference_id = c.id),
    'exports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'completed_at', e.completed_at,
          'exported_by_name', e.exported_by_name,
          'registration_count', e.registration_count,
          'outdated', e.data_version <> d.version,
          'mine', e.exported_by is not distinct from (select auth.uid())
        )
        order by e.completed_at desc, e.id
      )
      from public.year_exports e
      where e.conference_id = c.id and e.completed_at is not null
    ), '[]')
  )
  into v_result
  from public.conferences c
  join public.conference_data_versions d on d.conference_id = c.id
  where c.id = p_conference_id;

  if v_result is null then
    raise exception 'not_found';
  end if;
  return v_result;
end;
$$;

revoke all on function public.year_export_overview(uuid) from public, anon;
grant execute on function public.year_export_overview(uuid) to authenticated;
