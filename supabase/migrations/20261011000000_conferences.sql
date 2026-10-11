-- 年度大會：場地、課程、午餐、報名等資料的最上層歸屬。
create table public.conferences (
  id uuid primary key default gen_random_uuid(),
  year integer not null unique,
  conference_date date not null,
  -- 時程時間點。複製去年建立新年度時清空待填，所以可以是空值。
  announce_at timestamptz,
  registration_opens_at timestamptz,
  registration_closes_at timestamptz,
  -- 目前年度：前台正在顯示、接受報名的那一個年度大會。
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- 已填的時間點必須依序：公告上線 ≤ 報名開放 < 報名截止。每一對都要檢查，中間那個空著時也一樣。
  constraint conferences_announce_before_opens check (announce_at <= registration_opens_at),
  constraint conferences_opens_before_closes check (registration_opens_at < registration_closes_at),
  constraint conferences_announce_before_closes check (announce_at < registration_closes_at),
  -- 目前年度的時程必須填完整，才不會出現「報名中但沒有截止時間」。
  constraint conferences_current_schedule_complete check (
    not is_current
    or (announce_at is not null and registration_opens_at is not null and registration_closes_at is not null)
  )
);

-- 同一時間最多只有一個目前年度。
create unique index conferences_one_current on public.conferences (is_current) where is_current;

alter table public.conferences enable row level security;

-- 前台訪客只能讀到目前年度。
create policy "Anyone can read the current conference"
  on public.conferences for select
  to anon, authenticated
  using (is_current);
