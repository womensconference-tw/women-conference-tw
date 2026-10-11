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

  constraint conferences_schedule_in_order check (
    (announce_at is null or registration_opens_at is null or announce_at <= registration_opens_at)
    and (registration_opens_at is null or registration_closes_at is null or registration_opens_at < registration_closes_at)
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
