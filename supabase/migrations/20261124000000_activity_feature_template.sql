-- 活動頁 4 個共用範本的第二批（設計稿 docs/design/activity-templates-handoff.md）：
-- - 範本 B（圖文型，即席唱詩班、迷妳音樂會）：介紹頁有各教堂大按鈕、一張活動圖片、介紹內容與一句結語；
-- - 範本 C（各教堂頁）：每間教堂一頁，有節目名稱、海報、製作靈感（存在教堂分頁的說明 body）與團隊成員。
-- 只新增不刪除；新欄位沒送來時保留原值，先推 migration 到合併之間舊後台照常存檔。

alter table public.highlights drop constraint highlights_page_template_valid;
alter table public.highlights add constraint highlights_page_template_valid
  check (page_template in ('corner', 'spiritual', 'honor', 'missionary', 'exhibit', 'choir', 'concert'));

-- 範本 B 的活動圖片（highlight-images 裡的路徑，和人物照片同一個空間）、圖片說明與介紹內容最後放大的一句結語。
alter table public.highlights
  add column image_path text,
  add column image_alt_zh text not null default '',
  add column image_alt_en text not null default '',
  add column closing_zh text not null default '',
  add column closing_en text not null default '',
  add constraint highlights_image_path_valid check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

grant update (image_path, image_alt_zh, image_alt_en, closing_zh, closing_en) on public.highlights to authenticated;

-- 範本 C：節目名稱（例如〈妳是我的寶〉）、直式海報與圖片說明。製作靈感用原本的 body。
alter table public.highlight_venues
  add column show_title_zh text not null default '',
  add column show_title_en text not null default '',
  add column poster_path text,
  add column poster_alt_zh text not null default '',
  add column poster_alt_en text not null default '',
  add constraint highlight_venues_poster_path_valid check (poster_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$');

grant update (show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en) on public.highlight_venues to authenticated;

-- 範本 C 的團隊成員（指揮、司琴、製作人、主持…）。照片和人物一樣存原始照片與對準位置。
create table public.highlight_venue_team (
  id uuid primary key default gen_random_uuid(),
  highlight_id uuid not null,
  venue_id uuid not null,
  conference_id uuid not null,
  position integer not null default 0,
  -- 事工，例如指揮、司琴。
  role_zh text not null default '',
  role_en text not null default '',
  name_zh text not null,
  name_en text not null default '',
  photo_path text,
  photo_focus integer not null default 50,
  -- 人物介紹（純文字，一行一段）。
  bio_zh text not null default '',
  bio_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint highlight_venue_team_highlight
    foreign key (highlight_id, conference_id) references public.highlights (id, conference_id) on delete cascade,
  constraint highlight_venue_team_venue
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete cascade,
  constraint highlight_venue_team_name_not_blank check (name_zh ~ '[^[:space:]]'),
  constraint highlight_venue_team_photo_path_valid check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  constraint highlight_venue_team_photo_focus_range check (photo_focus between 0 and 100)
);

create index highlight_venue_team_page on public.highlight_venue_team (highlight_id, venue_id, position);
create index highlight_venue_team_venue_id on public.highlight_venue_team (venue_id);
create index highlight_venue_team_conference_id on public.highlight_venue_team (conference_id);

alter table public.highlight_venue_team enable row level security;

-- 前台訪客只能讀到目前年度的；公告上線前頁面不顯示，由頁面判斷（和大會特色一樣）。
create policy "Anyone can read highlight venue team of the current conference"
  on public.highlight_venue_team for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Admins can manage highlight venue team"
  on public.highlight_venue_team for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 前台訪客只能讀。修改時不能換年度、大會特色或教堂。
revoke insert, update, delete on public.highlight_venue_team from anon;
revoke update on public.highlight_venue_team from authenticated;
grant update (position, role_zh, role_en, name_zh, name_en, photo_path, photo_focus, bio_zh, bio_en, updated_at)
  on public.highlight_venue_team to authenticated;

/*
 * 存首頁項目：只寫有送來的欄位（沒送的保留原值，新增時用預設值），大會特色多了活動圖片、圖片說明與結語。
 * 先推 migration 到合併之間，舊後台存大會特色時不會把新欄位清掉。其餘和 20261120000000_highlight_people.sql 相同。
 */
create or replace function public.save_home_item(p_table text, p_id uuid, p_conference_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_columns text[];
  v_id uuid;
begin
  -- 只接受這三張表；表名與欄位名用 %I 帶進去，不會被當成指令。
  v_columns := case p_table
    when 'faqs' then array['question_zh', 'question_en', 'answer_zh', 'answer_en']
    when 'custom_blocks' then
      array['title_zh', 'title_en', 'body_zh', 'body_en', 'button_label_zh', 'button_label_en', 'button_url']
    when 'highlights' then
      array['name_zh', 'name_en', 'summary_zh', 'summary_en', 'description_zh', 'description_en',
        'page_template', 'subtitle_zh', 'subtitle_en', 'lead_quote_zh', 'lead_quote_en',
        'lead_quote_source_zh', 'lead_quote_source_en', 'image_path', 'image_alt_zh', 'image_alt_en', 'closing_zh', 'closing_en']
  end;
  if v_columns is null then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  perform public.lock_current_conference(p_conference_id);
  v_columns := array(select c from unnest(v_columns) as c where p_values ? c);
  if cardinality(v_columns) = 0 then
    raise exception 'not_found';
  end if;

  if p_id is null then
    execute format(
      'insert into public.%1$I (conference_id, position, %2$s)
      select $1,
        coalesce((select max(position) from public.%1$I where conference_id = $1), 0) + 1,
        %3$s
      from jsonb_populate_record(null::public.%1$I, $2) as v
      returning id',
      p_table,
      (select string_agg(format('%I', c), ', ') from unnest(v_columns) as c),
      (select string_agg(format('v.%I', c), ', ') from unnest(v_columns) as c)
    )
      into v_id
      using p_conference_id, p_values;
  else
    execute format(
      'update public.%1$I as item
      set (%2$s, updated_at) = (select %3$s, now() from jsonb_populate_record(null::public.%1$I, $3) as v)
      where item.id = $1 and item.conference_id = $2
      returning item.id',
      p_table,
      (select string_agg(format('%I', c), ', ') from unnest(v_columns) as c),
      (select string_agg(format('v.%I', c), ', ') from unnest(v_columns) as c)
    )
      into v_id
      using p_id, p_conference_id, p_values;
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

/*
 * 存一項大會特色在一間教堂的頁面：說明（範本 C 是製作靈感）、節目名稱、海報與圖片說明。
 * p_values 的鍵是欄位名稱，沒送的保留原值。說明、節目名稱、海報都沒有時刪掉這一列（團隊成員另外存，不受影響）。
 * 場地不是同一年度的當成找不到。只能動目前年度的；以呼叫者的權限執行。
 * 有海報時要有圖片說明，由網站程式檢查（和主視覺一樣）。
 */
create function public.save_highlight_venue_page(p_highlight_id uuid, p_venue_id uuid, p_values jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v public.highlight_venues%rowtype;
  v_old public.highlight_venues%rowtype;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id into v_conference_id from public.highlights where id = p_highlight_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);
  if not exists (select 1 from public.venues where id = p_venue_id and conference_id = v_conference_id) then
    raise exception 'not_found';
  end if;

  -- 同一項大會特色的教堂頁一次只存一個：這間教堂還沒有資料列時沒有東西可鎖，兩位管理員同時第一次存檔，
  -- 後存的會照它讀到的（空的）原值把先存的節目名稱、海報蓋掉。鎖大會特色那一列，後存的等先存的做完再讀原值。
  -- no key update 不擋其他表參照這一列的外鍵檢查。
  perform 1 from public.highlights where id = p_highlight_id for no key update;
  select * into v_old from public.highlight_venues where highlight_id = p_highlight_id and venue_id = p_venue_id;
  select * into v from jsonb_populate_record(null::public.highlight_venues, p_values);
  v.body_zh := case when p_values ? 'body_zh' then coalesce(v.body_zh, '') else coalesce(v_old.body_zh, '') end;
  v.body_en := case when p_values ? 'body_en' then coalesce(v.body_en, '') else coalesce(v_old.body_en, '') end;
  v.show_title_zh := case when p_values ? 'show_title_zh' then coalesce(v.show_title_zh, '') else coalesce(v_old.show_title_zh, '') end;
  v.show_title_en := case when p_values ? 'show_title_en' then coalesce(v.show_title_en, '') else coalesce(v_old.show_title_en, '') end;
  v.poster_path := case when p_values ? 'poster_path' then v.poster_path else v_old.poster_path end;
  v.poster_alt_zh := case when p_values ? 'poster_alt_zh' then coalesce(v.poster_alt_zh, '') else coalesce(v_old.poster_alt_zh, '') end;
  v.poster_alt_en := case when p_values ? 'poster_alt_en' then coalesce(v.poster_alt_en, '') else coalesce(v_old.poster_alt_en, '') end;

  if v.body_zh !~ '[^[:space:]]' and v.body_en !~ '[^[:space:]]'
    and v.show_title_zh !~ '[^[:space:]]' and v.show_title_en !~ '[^[:space:]]' and v.poster_path is null then
    delete from public.highlight_venues where highlight_id = p_highlight_id and venue_id = p_venue_id;
  else
    insert into public.highlight_venues (
      conference_id, highlight_id, venue_id, body_zh, body_en, show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en
    )
    values (
      v_conference_id, p_highlight_id, p_venue_id, v.body_zh, v.body_en, v.show_title_zh, v.show_title_en,
      v.poster_path, v.poster_alt_zh, v.poster_alt_en
    )
    on conflict (highlight_id, venue_id) do update
    set body_zh = excluded.body_zh, body_en = excluded.body_en,
      show_title_zh = excluded.show_title_zh, show_title_en = excluded.show_title_en,
      poster_path = excluded.poster_path, poster_alt_zh = excluded.poster_alt_zh, poster_alt_en = excluded.poster_alt_en,
      updated_at = now();
  end if;

  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
end;
$$;

revoke all on function public.save_highlight_venue_page from public, anon;
grant execute on function public.save_highlight_venue_page to authenticated;

/*
 * 舊後台存教堂說明用的函式：改成只改說明，節目名稱與海報保留（說明清空時不會把有海報的那一列刪掉）。
 * 新程式改用 save_highlight_venue_page，之後的 migration 刪除這個函式。
 */
create or replace function public.save_highlight_venue(p_highlight_id uuid, p_venue_id uuid, p_body_zh text, p_body_en text)
returns void
language sql
set search_path = ''
as $$
  select public.save_highlight_venue_page(
    p_highlight_id, p_venue_id, jsonb_build_object('body_zh', coalesce(p_body_zh, ''), 'body_en', coalesce(p_body_en, ''))
  );
$$;

/*
 * 新增或修改一位團隊成員。p_id 空值是新增，排在這間教堂的最後。p_values 只取內容欄位。
 * 場地不是同一年度的當成找不到。只能動目前年度的；以呼叫者的權限執行。
 */
create function public.save_highlight_team_member(p_highlight_id uuid, p_venue_id uuid, p_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_id uuid;
  v public.highlight_venue_team%rowtype;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id into v_conference_id from public.highlights where id = p_highlight_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);
  if not exists (select 1 from public.venues where id = p_venue_id and conference_id = v_conference_id) then
    raise exception 'not_found';
  end if;

  select * into v from jsonb_populate_record(null::public.highlight_venue_team, p_values);
  if p_id is null then
    insert into public.highlight_venue_team (
      conference_id, highlight_id, venue_id, position, role_zh, role_en, name_zh, name_en, photo_path, photo_focus, bio_zh, bio_en
    )
    values (
      v_conference_id, p_highlight_id, p_venue_id,
      coalesce((select max(position) from public.highlight_venue_team where highlight_id = p_highlight_id and venue_id = p_venue_id), 0) + 1,
      coalesce(v.role_zh, ''), coalesce(v.role_en, ''), v.name_zh, coalesce(v.name_en, ''), v.photo_path,
      coalesce(v.photo_focus, 50), coalesce(v.bio_zh, ''), coalesce(v.bio_en, '')
    )
    returning id into v_id;
  else
    update public.highlight_venue_team
    set role_zh = coalesce(v.role_zh, ''), role_en = coalesce(v.role_en, ''), name_zh = v.name_zh, name_en = coalesce(v.name_en, ''),
      photo_path = v.photo_path, photo_focus = coalesce(v.photo_focus, 50),
      bio_zh = coalesce(v.bio_zh, ''), bio_en = coalesce(v.bio_en, ''), updated_at = now()
    where id = p_id and highlight_id = p_highlight_id and venue_id = p_venue_id
    returning id into v_id;
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_highlight_team_member from public, anon;
grant execute on function public.save_highlight_team_member to authenticated;

-- 刪除一位團隊成員。照片檔案不刪（複製的新年度可能也在用）。只能刪目前年度的。
create function public.delete_highlight_team_member(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id into v_conference_id from public.highlight_venue_team where id = p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  delete from public.highlight_venue_team where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_highlight_team_member from public, anon;
grant execute on function public.delete_highlight_team_member to authenticated;

-- 一位團隊成員在同一間教堂裡往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。
create function public.move_highlight_team_member(p_id uuid, p_up boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_highlight_id uuid;
  v_venue_id uuid;
  v_ids uuid[];
  v_index integer;
  v_target integer;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id, highlight_id, venue_id into v_conference_id, v_highlight_id, v_venue_id
  from public.highlight_venue_team where id = p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  select array_agg(id order by position, id) into v_ids
  from (
    select id, position from public.highlight_venue_team
    where highlight_id = v_highlight_id and venue_id = v_venue_id
    for update
  ) as team;

  v_index := array_position(v_ids, p_id);
  if v_index is null then
    raise exception 'not_found';
  end if;
  v_target := v_index + case when p_up then -1 else 1 end;
  if v_target < 1 or v_target > cardinality(v_ids) then
    return;
  end if;
  v_ids[v_index] := v_ids[v_target];
  v_ids[v_target] := p_id;

  update public.highlight_venue_team as member
  set position = ordered.position, updated_at = now()
  from unnest(v_ids) with ordinality as ordered(id, position)
  where member.id = ordered.id and member.position <> ordered.position;
end;
$$;

revoke all on function public.move_highlight_team_member from public, anon;
grant execute on function public.move_highlight_team_member to authenticated;

/*
 * 複製建立新年度：活動圖片與結語、教堂頁的節目名稱與海報、團隊成員也複製（大會特色、教堂對到新年度的，照片用同一個檔案）。
 * 其餘和 20261123000000_activity_cards_template.sql 相同。
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
        welcome_zh, welcome_en, welcome_signature_zh, welcome_signature_en, admin_line_id
      )
      select v_id, p_year, p_conference_date, start_time, end_time,
        theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
        welcome_zh, welcome_en, welcome_signature_zh, welcome_signature_en, admin_line_id
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
        id, conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity,
        speaker_zh, speaker_en, highlight_id
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, session_id::text),
        row_number() over (partition by session_id order by position, id), title_zh, title_en, description_zh, description_en, capacity,
        speaker_zh, speaker_en, extensions.uuid_generate_v5(v_id, highlight_id::text)
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
    highlights as (
      insert into public.highlights (
        id, conference_id, position, name_zh, name_en, summary_zh, summary_en, description_zh, description_en,
        page_template, subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en,
        image_path, image_alt_zh, image_alt_en, closing_zh, closing_en
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, row_number() over (order by position, id),
        name_zh, name_en, summary_zh, summary_en, description_zh, description_en,
        page_template, subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en,
        image_path, image_alt_zh, image_alt_en, closing_zh, closing_en
      from public.highlights
      where conference_id = p_source_id
    ),
    agenda_items as (
      insert into public.agenda_items (id, conference_id, position, start_time, end_time, name_zh, name_en)
      select extensions.uuid_generate_v5(v_id, id::text), v_id, row_number() over (order by position, id),
        start_time, end_time, name_zh, name_en
      from public.agenda_items
      where conference_id = p_source_id
    ),
    agenda_item_parts as (
      insert into public.agenda_item_parts (conference_id, agenda_item_id, position, name_zh, name_en, highlight_id)
      select v_id, extensions.uuid_generate_v5(v_id, agenda_item_id::text),
        row_number() over (partition by agenda_item_id order by position, id), name_zh, name_en,
        extensions.uuid_generate_v5(v_id, highlight_id::text)
      from public.agenda_item_parts
      where conference_id = p_source_id
    ),
    agenda_item_venues as (
      insert into public.agenda_item_venues (
        conference_id, agenda_item_id, venue_id, place_zh, place_en, note_zh, note_en, session_id
      )
      select v_id, extensions.uuid_generate_v5(v_id, agenda_item_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        place_zh, place_en, note_zh, note_en, extensions.uuid_generate_v5(v_id, session_id::text)
      from public.agenda_item_venues
      where conference_id = p_source_id
    ),
    highlight_venues as (
      insert into public.highlight_venues (
        conference_id, highlight_id, venue_id, body_zh, body_en, show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        body_zh, body_en, show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en
      from public.highlight_venues
      where conference_id = p_source_id
    ),
    highlight_venue_team as (
      insert into public.highlight_venue_team (
        conference_id, highlight_id, venue_id, position, role_zh, role_en, name_zh, name_en, photo_path, photo_focus, bio_zh, bio_en
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        row_number() over (partition by highlight_id, venue_id order by position, id), role_zh, role_en, name_zh, name_en,
        photo_path, photo_focus, bio_zh, bio_en
      from public.highlight_venue_team
      where conference_id = p_source_id
    ),
    highlight_people as (
      insert into public.highlight_people (
        conference_id, highlight_id, position, stake_id, ward_id, service_area_zh, service_area_en, name_zh, name_en,
        photo_path, photo_focus, link_label_zh, link_label_en, link_url,
        venue_id, course_id, course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text),
        row_number() over (partition by highlight_id order by position, id), stake_id, ward_id, service_area_zh, service_area_en,
        name_zh, name_en, photo_path, photo_focus, link_label_zh, link_label_en, link_url,
        extensions.uuid_generate_v5(v_id, venue_id::text), extensions.uuid_generate_v5(v_id, course_id::text),
        course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en
      from public.highlight_people
      where conference_id = p_source_id
    ),
    committee_texts as (
      insert into public.committee_texts (conference_id, introduction, chair_message, memorandum, execution_plan, markdown)
      select v_id, introduction, chair_message, memorandum, execution_plan, markdown
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
