/*
 * 籌備委員會資訊（#45）：取代舊的 WordPress 籌備網站。屬於年度大會。
 * 三個文字頁（大會簡介、主席的話、籌備委員會備忘錄）、會議記錄、重要連結、工作團隊名單、籌備委員名單。
 * 所有工作人員（總管理員、課務組、報報組）都讀得到，只有總管理員能寫入（ADR 0004）；未登入與前台讀不到，
 * 名單是工作人員的個資。名單只是資訊，不給任何後台權限，名單上的人不一定有後台帳號，也不收聯絡方式。
 * repo 是公開的：真實姓名不寫進 migration、seed 或測試，上線後由總管理員在後台輸入。
 *
 * 和首頁內容不同，這裡哪個年度都能編輯：前台不顯示這些資料，不會有改到舊年度、前台卻沒變的問題；
 * 複製出新年度、還沒切換成目前年度之前，就能先輸入新一屆的名單。
 */

-- 連結只收有網域的 http(s) 網址，不能有空白或控制字元（和首頁自訂區塊的按鈕網址同一組字元）。
-- 網域前可以有帳號（user@），網域不能是空的，網域後只能接數字的連接埠，再來是 /、?、# 或結束
-- （https://@/、https://user@/、https://example.com:abc/ 打不開）。和後台的 isSafeExternalUrl 一致。
create function public.is_safe_external_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_url ~* '^https?://([^/\\?#@]*@)?[^/\\?#@:]+(:[0-9]{1,5})?([/?#]|$)'
    and p_url !~ '[\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
$$;

-- 三個文字頁，每個年度一列；還沒存過的年度沒有這一列，當成都是空的。
create table public.committee_texts (
  conference_id uuid primary key references public.conferences (id) on delete cascade,
  introduction text not null default '',
  chair_message text not null default '',
  memorandum text not null default '',
  updated_at timestamptz not null default now()
);

-- 會議記錄：籌備委員會的備忘錄、決策會議紀錄、第 N 次會議等，大多是 Canva 或 Google 文件的連結。依日期排列。
create table public.committee_meetings (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  title text not null,
  meeting_date date not null,
  url text not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint committee_meetings_title_not_blank check (public.trim_blank(title) <> ''),
  constraint committee_meetings_url_safe check (public.is_safe_external_url(url))
);

create index committee_meetings_conference_id on public.committee_meetings (conference_id, meeting_date);

-- 重要連結：例如執行計畫試算表。可排序。
create table public.committee_links (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  position integer not null,
  title text not null,
  url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint committee_links_title_not_blank check (public.trim_blank(title) <> ''),
  constraint committee_links_url_safe check (public.is_safe_external_url(url))
);

create index committee_links_conference_id on public.committee_links (conference_id, position);

/*
 * 工作團隊：籌備會的執行組（GLOSSARY「工作團隊」），和後台的工作人員帳號無關。
 * 組別：總召團（conveners）與課務、現場、報報、文宣、公關、秘書六組。
 * 職務是正職（lead）或副職（deputy）：總召團是總召、副總召，各組是組長、副組長，名稱依組別而定。
 * 區是負責的範圍，空值表示全區。
 */
create table public.committee_team_members (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  team text not null,
  role text not null,
  name text not null,
  region text,
  stake_id uuid not null references public.stakes (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint committee_team_members_team_valid check (
    team in ('conveners', 'course', 'onsite', 'registration', 'publicity', 'public_relations', 'secretariat')
  ),
  constraint committee_team_members_role_valid check (role in ('lead', 'deputy')),
  constraint committee_team_members_region_valid check (region in ('north', 'central', 'south')),
  constraint committee_team_members_name_not_blank check (public.trim_blank(name) <> '')
);

create index committee_team_members_conference_id on public.committee_team_members (conference_id);
create index committee_team_members_stake_id on public.committee_team_members (stake_id);

-- 籌備委員：每個支聯會推兩位，其中一位須為慈助會會長團成員，代表姐妹的需求。
create table public.committee_members (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  name text not null,
  stake_id uuid not null references public.stakes (id),
  relief_society_presidency boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint committee_members_name_not_blank check (public.trim_blank(name) <> '')
);

create index committee_members_conference_id on public.committee_members (conference_id);
create index committee_members_stake_id on public.committee_members (stake_id);

alter table public.committee_texts enable row level security;
alter table public.committee_meetings enable row level security;
alter table public.committee_links enable row level security;
alter table public.committee_team_members enable row level security;
alter table public.committee_members enable row level security;

create policy "Staff can read committee texts"
  on public.committee_texts for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read committee meetings"
  on public.committee_meetings for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read committee links"
  on public.committee_links for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read committee team members"
  on public.committee_team_members for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read committee members"
  on public.committee_members for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Admins can manage committee texts"
  on public.committee_texts for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage committee meetings"
  on public.committee_meetings for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage committee links"
  on public.committee_links for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage committee team members"
  on public.committee_team_members for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage committee members"
  on public.committee_members for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 修改時不能換年度。前台訪客本來就被權限規則擋下，這裡連權限都拿掉。
revoke all on public.committee_texts, public.committee_meetings, public.committee_links,
  public.committee_team_members, public.committee_members from anon;
revoke update on public.committee_texts, public.committee_meetings, public.committee_links,
  public.committee_team_members, public.committee_members from authenticated;
grant update (introduction, chair_message, memorandum, updated_at) on public.committee_texts to authenticated;
grant update (title, meeting_date, url, note, updated_at) on public.committee_meetings to authenticated;
grant update (position, title, url, updated_at) on public.committee_links to authenticated;
grant update (team, role, name, region, stake_id, updated_at) on public.committee_team_members to authenticated;
grant update (name, stake_id, relief_society_presidency, updated_at) on public.committee_members to authenticated;

/*
 * 儲存一個年度的三個文字頁；還沒有那一列時新增。年度不存在時丟出 not_found。
 * 以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 */
create function public.save_committee_texts(
  p_conference_id uuid,
  p_introduction text,
  p_chair_message text,
  p_memorandum text
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  insert into public.committee_texts (conference_id, introduction, chair_message, memorandum)
  values (p_conference_id, p_introduction, p_chair_message, p_memorandum)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    updated_at = now();
end;
$$;

revoke all on function public.save_committee_texts from public, anon;
grant execute on function public.save_committee_texts to authenticated;

/*
 * 把一個重要連結往前（p_up）或往後移一格。和首頁的 move_home_item 一樣：同年度的連結依目前順序
 * （排序相同時依 id）重新編成 1、2、3…，再和相鄰的一個對調；先鎖住同年度的連結，兩位總管理員同時移動時排隊。
 * 已經在最前或最後時不動。以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 */
create function public.move_committee_link(p_id uuid, p_up boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_ids uuid[];
  v_index integer;
  v_target integer;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  select conference_id into v_conference_id from public.committee_links where id = p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;

  select array_agg(id order by position, id) into v_ids
  from (select id, position from public.committee_links where conference_id = v_conference_id for update) as links;

  v_index := array_position(v_ids, p_id);
  -- 等鎖的時候被別人刪掉了。
  if v_index is null then
    raise exception 'not_found';
  end if;
  v_target := v_index + case when p_up then -1 else 1 end;
  if v_target < 1 or v_target > cardinality(v_ids) then
    return;
  end if;
  v_ids[v_index] := v_ids[v_target];
  v_ids[v_target] := p_id;

  update public.committee_links as link
  set position = ordered.position, updated_at = now()
  from unnest(v_ids) with ordinality as ordered(id, position)
  where link.id = ordered.id and link.position <> ordered.position;
end;
$$;

revoke all on function public.move_committee_link from public, anon;
grant execute on function public.move_committee_link to authenticated;

/*
 * 複製年度（#25）時，一併複製三個文字頁與重要連結；會議記錄與兩份名單不複製（每屆換人、會議重開）。
 * 其他和上一版（20261106000001_drop_afternoon_activity_functions.sql）相同。
 */
create or replace function public.copy_conference(p_source_id uuid, p_year integer, p_conference_date date)
returns table (new_conference_id uuid, skipped_course_pairs integer)
language plpgsql
security definer
set search_path = ''
as $$
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
    ),
    committee_texts as (
      insert into public.committee_texts (conference_id, introduction, chair_message, memorandum)
      select v_id, introduction, chair_message, memorandum
      from public.committee_texts
      where conference_id = p_source_id
    ),
    committee_links as (
      insert into public.committee_links (conference_id, position, title, url)
      select v_id, row_number() over (order by position, id), title, url
      from public.committee_links
      where conference_id = p_source_id
    )
  -- 上面的寫入不管有沒有被讀到都會執行。
  select (select count(*) from public.course_pairs where conference_id = p_source_id) - count(*)
  into v_skipped
  from kept_pairs;

  return query select v_id, v_skipped;
end;
$$;
