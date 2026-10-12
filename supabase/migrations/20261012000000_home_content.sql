-- 首頁每年會變的內容。全部屬於某一年度大會；中英兩欄以 `<欄位>_zh`、`<欄位>_en` 命名，
-- 英文空白時前台顯示中文。

-- 年度大會本身的內容欄位。
alter table public.conferences
  -- 大會當天的開始與結束時間（台灣時間）。
  add column start_time time,
  add column end_time time,
  add column theme_scripture_zh text not null default '',
  add column theme_scripture_en text not null default '',
  -- 主題經文出處，例如「以賽亞書 54:13」。
  add column theme_scripture_reference_zh text not null default '',
  add column theme_scripture_reference_en text not null default '',
  add column welcome_zh text not null default '',
  add column welcome_en text not null default '',
  -- 首頁「需要幫忙」顯示的管理員 LINE ID。官方帳號以 @ 開頭。
  add column admin_line_id text,
  add constraint conferences_start_before_end check (start_time < end_time),
  -- 只有結束時間沒有開始時間時，首頁沒辦法顯示，所以不接受。
  add constraint conferences_end_needs_start check (end_time is null or start_time is not null);

-- 場地：舉行大會的一間教堂。
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  -- 顯示順序，小的在前。
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  address_zh text not null default '',
  address_en text not null default '',
  -- 場地特色，例如「另有午后動態」「停車位有限」。
  features_zh text not null default '',
  features_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venues_name_not_blank check (btrim(name_zh) <> '')
);

create index venues_conference_id on public.venues (conference_id, position);

-- 常見問題。
create table public.faqs (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  position integer not null default 0,
  question_zh text not null,
  question_en text not null default '',
  answer_zh text not null,
  answer_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint faqs_not_blank check (btrim(question_zh) <> '' and btrim(answer_zh) <> '')
);

create index faqs_conference_id on public.faqs (conference_id, position);

-- 自訂區塊：首頁上由後台新增的內容區塊，包含標題、內文、按鈕，可排序。
create table public.custom_blocks (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  position integer not null default 0,
  title_zh text not null,
  title_en text not null default '',
  body_zh text not null default '',
  body_en text not null default '',
  -- 按鈕可有可無；有網址就必須有中文按鈕文字。
  button_label_zh text not null default '',
  button_label_en text not null default '',
  button_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint custom_blocks_title_not_blank check (btrim(title_zh) <> ''),
  constraint custom_blocks_button_has_label check (button_url is null or btrim(button_label_zh) <> ''),
  -- 只接受站內路徑或 http(s) 網址，擋掉 javascript: 之類的連結。
  constraint custom_blocks_button_url_safe check (
    button_url is null or button_url ~ '^(https?://|/[^/\\])' or button_url = '/'
  )
);

create index custom_blocks_conference_id on public.custom_blocks (conference_id, position);

alter table public.venues enable row level security;
alter table public.faqs enable row level security;
alter table public.custom_blocks enable row level security;

-- 前台訪客只能讀到目前年度的內容。
create policy "Anyone can read venues of the current conference"
  on public.venues for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read FAQs of the current conference"
  on public.faqs for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read custom blocks of the current conference"
  on public.custom_blocks for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));
