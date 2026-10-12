-- 支聯會／支會：教會的地區單位，名單不屬於任何年度大會。
-- 重新劃分時停用舊單位、新增新單位，不更改既有支會所屬的支聯會。
create table public.stakes (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  -- 停用的支聯會不出現在報名表，但舊報名仍指向它。
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stakes_name_not_blank check (name_zh ~ '[^[:space:]]')
);

create table public.wards (
  id uuid primary key default gen_random_uuid(),
  stake_id uuid not null references public.stakes (id),
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wards_name_not_blank check (name_zh ~ '[^[:space:]]'),
  -- 讓報名可以用（支會, 支聯會）一起參照，保證兩者相符。
  constraint wards_id_stake_id unique (id, stake_id)
);

create index wards_stake_id on public.wards (stake_id, position);

-- 讓報名可以用（場地, 年度大會）一起參照，保證場地屬於該年度。
alter table public.venues add constraint venues_id_conference_id unique (id, conference_id);

-- 報名：一位姐妹參加某年度大會的一筆紀錄。
create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  venue_id uuid not null,
  -- 報名當下的支聯會與支會，兩個都存，不從支會推算支聯會。
  stake_id uuid not null references public.stakes (id),
  ward_id uuid not null,
  name text not null,
  -- 只存數字（國際號碼可有開頭的 +），查詢時用同樣的規則整理後比對。
  phone text,
  -- 沒有電話的報名者由系統發的 6 碼報名編號；有電話者為空。
  registration_number text,
  email text,
  line_id text,
  -- 身分類別。前台報名一律是與會姐妹，其他由後台修改。
  role text not null default 'attendee',
  portrait_consented_at timestamptz not null,
  status text not null default 'registered',
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint registrations_venue_in_conference
    foreign key (venue_id, conference_id) references public.venues (id, conference_id),
  constraint registrations_ward_in_stake
    foreign key (ward_id, stake_id) references public.wards (id, stake_id),
  constraint registrations_name_valid check (name ~ '[^[:space:]]' and char_length(name) <= 50),
  constraint registrations_phone_format check (phone ~ '^\+?[0-9]{8,15}$'),
  constraint registrations_number_format check (registration_number ~ '^[1-9][0-9]{5}$'),
  -- 有電話就不發報名編號，沒電話就一定要有報名編號。
  constraint registrations_phone_or_number check ((phone is null) <> (registration_number is null)),
  constraint registrations_email_format check (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint registrations_line_id_length check (char_length(line_id) between 1 and 50),
  constraint registrations_role_valid check (
    role in ('attendee', 'committee', 'speaker', 'guest_leader', 'team', 'volunteer')
  ),
  constraint registrations_status_valid check (status in ('registered', 'cancelled')),
  constraint registrations_cancelled_at check ((status = 'cancelled') = (cancelled_at is not null))
);

create index registrations_conference_id on public.registrations (conference_id, venue_id);
create index registrations_conference_phone on public.registrations (conference_id, phone);
create unique index registrations_conference_number
  on public.registrations (conference_id, registration_number);

alter table public.stakes enable row level security;
alter table public.wards enable row level security;
alter table public.registrations enable row level security;

-- 報名表只列出啟用中的單位；支聯會停用時，它的支會也一起不出現。
create policy "Anyone can read active stakes"
  on public.stakes for select
  to anon, authenticated
  using (is_active);

create policy "Anyone can read active wards of active stakes"
  on public.wards for select
  to anon, authenticated
  using (is_active and exists (select 1 from public.stakes s where s.id = stake_id and s.is_active));

-- 報名資料表不開放前台直接讀寫，只能透過 submit_registration 寫入。
revoke all on public.registrations from anon, authenticated;

/*
 * 報名服務的送出：前台唯一能寫入報名的地方。
 * 欄位格式由報名服務先檢查、資料表的限制再擋一次；這裡檢查要看資料庫當下狀態的規則：
 * 目前年度是否報名中、場地是否屬於目前年度、支會在報名當下是否隸屬於該支聯會且都啟用中。
 * 不符合時丟出代碼（例如 registration_not_open），由報名服務轉成欄位旁的錯誤訊息。
 */
create function public.submit_registration(
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
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

  -- 任何人都能直接呼叫這個函式，所以這裡也去掉頭尾空白，存下的資料才跟經過報名服務的一致。
  -- 沒有電話時發 100000–999999 的報名編號（不以 0 開頭，免得抄寫時漏掉）；
  -- 同時有人抽到同一組時，唯一索引會擋下，換一組再試。
  loop
    if p_phone is null then
      v_number := (100000 + ('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 900000)::text;
    end if;
    begin
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, registration_number, email, line_id,
        portrait_consented_at
      ) values (
        v_conference.id, p_venue_id, p_stake_id, p_ward_id, btrim(p_name), p_phone, v_number,
        nullif(btrim(p_email), ''), nullif(btrim(p_line_id), ''), now()
      )
      returning * into v_registration;
      exit;
    exception when unique_violation then
      if p_phone is not null then
        raise;
      end if;
    end;
  end loop;

  return v_registration;
end;
$$;

revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;
