-- 大會特色介紹頁的人物版型（設計稿 docs/design/activity-*.dc.html）：向貴賓致敬、與年長夫婦傳教士有約、靜態展示
-- 三種版型共用一個版面，介紹頁上面是副標、引言與介紹內容，下面是人物卡片（照片、支聯會與支會、姓名、連結）。
-- 一般的大會特色不選版型（page_template 是 null），介紹頁照舊。都屬於年度大會，只有總管理員能寫入（ADR 0004）。

alter table public.highlights
  add column page_template text,
  -- 標題下面的一句副標，可空。
  add column subtitle_zh text not null default '',
  add column subtitle_en text not null default '',
  -- 介紹區左邊放大的引言與出處，可空。
  add column lead_quote_zh text not null default '',
  add column lead_quote_en text not null default '',
  add column lead_quote_source_zh text not null default '',
  add column lead_quote_source_en text not null default '',
  add constraint highlights_page_template_valid check (page_template in ('honor', 'missionary', 'exhibit'));

grant update (
  page_template, subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en
) on public.highlights to authenticated;

-- 介紹頁的人物，例如八十歲的貴賓、年長夫婦傳教士、參展的姐妹。照片放在 highlight-images（和介紹內容的圖片同一個空間），
-- 複製新年度時新舊年度用同一個檔案，所以換照片、刪人物時不刪檔案。
create table public.highlight_people (
  id uuid primary key default gen_random_uuid(),
  highlight_id uuid not null,
  conference_id uuid not null,
  position integer not null default 0,
  stake_zh text not null default '',
  stake_en text not null default '',
  -- 支會或分會；傳教士也可以寫傳道部。
  ward_zh text not null default '',
  ward_en text not null default '',
  name_zh text not null,
  name_en text not null default '',
  -- highlight-images 裡的路徑：<年度大會編號>/<隨機編號>.<副檔名>。沒有照片是 null。
  photo_path text,
  -- 照片裁成圓形時對準的高度：0 是最上面、100 是最下面（object-position 的垂直位置）。
  photo_focus integer not null default 50,
  -- 連結按鈕的文字；靜態展示寫作品名稱，其他版型空白時用預設文字。
  link_label_zh text not null default '',
  link_label_en text not null default '',
  -- 個人或作品的介紹頁；沒有是 null，卡片不放按鈕。
  link_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint highlight_people_highlight
    foreign key (highlight_id, conference_id) references public.highlights (id, conference_id) on delete cascade,
  constraint highlight_people_name_not_blank check (name_zh ~ '[^[:space:]]'),
  constraint highlight_people_photo_path_valid check (photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  constraint highlight_people_photo_focus_range check (photo_focus between 0 and 100),
  -- 和自訂區塊的按鈕網址同一個規則（custom_blocks_button_url_safe）。
  constraint highlight_people_link_url_safe check (
    link_url is null
    or (
      link_url ~* '^(https?://[^/\\?#]+|/([^/\\]|$))'
      and link_url !~ '[\u0001- \u007f-   -     　﻿]'
    )
  )
);

create index highlight_people_highlight_id on public.highlight_people (highlight_id, position);
create index highlight_people_conference_id on public.highlight_people (conference_id);

alter table public.highlight_people enable row level security;

-- 前台訪客只能讀到目前年度的；公告上線前介紹頁不顯示，由頁面判斷（和大會特色一樣）。
create policy "Anyone can read highlight people of the current conference"
  on public.highlight_people for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Admins can manage highlight people"
  on public.highlight_people for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 前台訪客只能讀。修改時不能換年度或換大會特色。
revoke insert, update, delete on public.highlight_people from anon;
revoke update on public.highlight_people from authenticated;
grant update (
  position, stake_zh, stake_en, ward_zh, ward_en, name_zh, name_en, photo_path, photo_focus,
  link_label_zh, link_label_en, link_url, updated_at
) on public.highlight_people to authenticated;

/*
 * 新增或修改大會特色的一位人物。p_id 空值是新增，排在最後。p_values 是要寫入的欄位，鍵是欄位名稱；
 * 只取內容欄位，其他的忽略（不能換年度、大會特色或排序）。只能動目前年度的；以呼叫者的權限執行。
 */
create function public.save_highlight_person(p_highlight_id uuid, p_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_id uuid;
  v record;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id into v_conference_id from public.highlights where id = p_highlight_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  select * into v from jsonb_populate_record(null::public.highlight_people, p_values);
  if p_id is null then
    insert into public.highlight_people (
      conference_id, highlight_id, position, stake_zh, stake_en, ward_zh, ward_en, name_zh, name_en,
      photo_path, photo_focus, link_label_zh, link_label_en, link_url
    )
    values (
      v_conference_id, p_highlight_id,
      coalesce((select max(position) from public.highlight_people where highlight_id = p_highlight_id), 0) + 1,
      coalesce(v.stake_zh, ''), coalesce(v.stake_en, ''), coalesce(v.ward_zh, ''), coalesce(v.ward_en, ''),
      v.name_zh, coalesce(v.name_en, ''), v.photo_path, coalesce(v.photo_focus, 50),
      coalesce(v.link_label_zh, ''), coalesce(v.link_label_en, ''), v.link_url
    )
    returning id into v_id;
  else
    update public.highlight_people
    set stake_zh = coalesce(v.stake_zh, ''), stake_en = coalesce(v.stake_en, ''),
      ward_zh = coalesce(v.ward_zh, ''), ward_en = coalesce(v.ward_en, ''),
      name_zh = v.name_zh, name_en = coalesce(v.name_en, ''),
      photo_path = v.photo_path, photo_focus = coalesce(v.photo_focus, 50),
      link_label_zh = coalesce(v.link_label_zh, ''), link_label_en = coalesce(v.link_label_en, ''),
      link_url = v.link_url, updated_at = now()
    where id = p_id and highlight_id = p_highlight_id
    returning id into v_id;
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_highlight_person from public, anon;
grant execute on function public.save_highlight_person to authenticated;

-- 刪除一位人物。只能刪目前年度的。
create function public.delete_highlight_person(p_id uuid)
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
  select conference_id into v_conference_id from public.highlight_people where id = p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  delete from public.highlight_people where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;

revoke all on function public.delete_highlight_person from public, anon;
grant execute on function public.delete_highlight_person to authenticated;

-- 一位人物在同一項大會特色裡往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。
create function public.move_highlight_person(p_id uuid, p_up boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_highlight_id uuid;
  v_ids uuid[];
  v_index integer;
  v_target integer;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id, highlight_id into v_conference_id, v_highlight_id from public.highlight_people where id = p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  select array_agg(id order by position, id) into v_ids
  from (select id, position from public.highlight_people where highlight_id = v_highlight_id for update) as people;

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

  update public.highlight_people as person
  set position = ordered.position, updated_at = now()
  from unnest(v_ids) with ordinality as ordered(id, position)
  where person.id = ordered.id and person.position <> ordered.position;
end;
$$;

revoke all on function public.move_highlight_person from public, anon;
grant execute on function public.move_highlight_person to authenticated;

/*
 * 存大會特色時一起存版型、副標與引言。其餘和 20261113000000_highlights.sql 相同。
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
        'lead_quote_source_zh', 'lead_quote_source_en']
  end;
  if v_columns is null then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  perform public.lock_current_conference(p_conference_id);

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
 * 複製建立新年度時一起複製介紹頁的版型、副標、引言與人物（大會特色對到新年度的那一項，照片用同一個檔案）。
 * 其餘和 20261117000000_highlight_venues.sql 相同。
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
        page_template, subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, row_number() over (order by position, id),
        name_zh, name_en, summary_zh, summary_en, description_zh, description_en,
        page_template, subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en
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
      insert into public.highlight_venues (conference_id, highlight_id, venue_id, body_zh, body_en)
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        body_zh, body_en
      from public.highlight_venues
      where conference_id = p_source_id
    ),
    highlight_people as (
      insert into public.highlight_people (
        conference_id, highlight_id, position, stake_zh, stake_en, ward_zh, ward_en, name_zh, name_en,
        photo_path, photo_focus, link_label_zh, link_label_en, link_url
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text),
        row_number() over (partition by highlight_id order by position, id), stake_zh, stake_en, ward_zh, ward_en,
        name_zh, name_en, photo_path, photo_focus, link_label_zh, link_label_en, link_url
      from public.highlight_people
      where conference_id = p_source_id
    ),
    committee_texts as (
      insert into public.committee_texts (conference_id, introduction, chair_message, memorandum, markdown)
      select v_id, introduction, chair_message, memorandum, markdown
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
