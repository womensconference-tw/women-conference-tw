-- 大會程序（#84）：大會當天一整天的時間軸，例如報到、開幕式、第一場次、午餐聯誼、閉幕式。屬於年度大會，
-- 每一列各場地共用（時間、名稱、子項目），地點、補充說明、對應的場次各場地不同。首頁的「大會程序」照這裡顯示（#85）。
-- 都是說明文字，報名開放後照樣能改，也不影響報名；不能從這裡改到場次本身。只有總管理員能寫入（ADR 0004）。

-- 每一列。
create table public.agenda_items (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  position integer not null default 0,
  -- 台灣時間。
  start_time time not null,
  end_time time not null,
  name_zh text not null,
  name_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint agenda_items_name_not_blank check (name_zh ~ '[^[:space:]]'),
  constraint agenda_items_start_before_end check (start_time < end_time),
  constraint agenda_items_id_conference_id unique (id, conference_id)
);

create index agenda_items_conference_id on public.agenda_items (conference_id, position);

-- 一列的子項目，例如開幕式的「即席唱詩班」「領袖演講」。可以連到同一年度的一項大會特色（#82）。
create table public.agenda_item_parts (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null,
  agenda_item_id uuid not null,
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  highlight_id uuid,

  constraint agenda_item_parts_item
    foreign key (agenda_item_id, conference_id) references public.agenda_items (id, conference_id) on delete cascade,
  -- 刪除大會特色時只清掉連結，子項目留著。
  constraint agenda_item_parts_highlight_same_conference
    foreign key (highlight_id, conference_id) references public.highlights (id, conference_id)
    on delete set null (highlight_id),
  constraint agenda_item_parts_name_not_blank check (name_zh ~ '[^[:space:]]')
);

create index agenda_item_parts_agenda_item_id on public.agenda_item_parts (agenda_item_id, position);
create index agenda_item_parts_highlight_id on public.agenda_item_parts (highlight_id);

-- 一列在一個場地的設定：地點、補充說明、對應的場次（首頁在這一列下面列出那個場次的課程）。都可空。
create table public.agenda_item_venues (
  agenda_item_id uuid not null,
  venue_id uuid not null,
  conference_id uuid not null,
  place_zh text not null default '',
  place_en text not null default '',
  note_zh text not null default '',
  note_en text not null default '',
  session_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (agenda_item_id, venue_id),
  constraint agenda_item_venues_item
    foreign key (agenda_item_id, conference_id) references public.agenda_items (id, conference_id) on delete cascade,
  constraint agenda_item_venues_venue
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete cascade,
  -- 場次要是同一間教堂的（也就一定是同一年度）。刪除場次時只清掉對應，地點與說明留著。
  constraint agenda_item_venues_session_same_venue
    foreign key (session_id, venue_id) references public.sessions (id, venue_id) on delete set null (session_id),
  -- 一個場次只能接到一列。
  constraint agenda_item_venues_session_once unique (session_id)
);

create index agenda_item_venues_venue_id on public.agenda_item_venues (venue_id);

alter table public.agenda_items enable row level security;
alter table public.agenda_item_parts enable row level security;
alter table public.agenda_item_venues enable row level security;

-- 前台訪客只能讀到目前年度的；公告上線前首頁不顯示，由頁面判斷（和常見問題、大會特色一樣）。
create policy "Anyone can read agenda items of the current conference"
  on public.agenda_items for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read agenda item parts of the current conference"
  on public.agenda_item_parts for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read agenda item venues of the current conference"
  on public.agenda_item_venues for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Admins can manage agenda items"
  on public.agenda_items for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage agenda item parts"
  on public.agenda_item_parts for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

create policy "Admins can manage agenda item venues"
  on public.agenda_item_venues for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 前台訪客只能讀。修改時不能換年度、換列或換場地；子項目整批換掉，不用修改。
revoke insert, update, delete on public.agenda_items, public.agenda_item_parts, public.agenda_item_venues from anon;
revoke update on public.agenda_items, public.agenda_item_parts, public.agenda_item_venues from authenticated;
grant update (position, start_time, end_time, name_zh, name_en, updated_at) on public.agenda_items to authenticated;
grant update (place_zh, place_en, note_zh, note_en, session_id, updated_at) on public.agenda_item_venues to authenticated;

/*
 * 新增或修改一列，連同子項目在同一個交易裡存好：子項目整批換成 p_parts（依陣列順序），
 * 每一項是 {"name_zh", "name_en", "highlight_id"}。p_id 空值是新增，排在最後。
 * 只能動目前年度的（lock_current_conference，見 20261028000000_content_editing_current_year.sql）。
 * 以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 */
create function public.save_agenda_item(
  p_id uuid,
  p_conference_id uuid,
  p_start_time time,
  p_end_time time,
  p_name_zh text,
  p_name_en text,
  p_parts jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  perform public.lock_current_conference(p_conference_id);

  if p_id is null then
    insert into public.agenda_items (conference_id, position, start_time, end_time, name_zh, name_en)
    select p_conference_id,
      coalesce((select max(position) from public.agenda_items where conference_id = p_conference_id), 0) + 1,
      p_start_time, p_end_time, p_name_zh, p_name_en
    returning id into v_id;
  else
    update public.agenda_items
    set start_time = p_start_time, end_time = p_end_time, name_zh = p_name_zh, name_en = p_name_en, updated_at = now()
    where id = p_id and conference_id = p_conference_id
    returning id into v_id;
    if v_id is null then
      raise exception 'not_found';
    end if;
    delete from public.agenda_item_parts where agenda_item_id = v_id;
  end if;

  insert into public.agenda_item_parts (conference_id, agenda_item_id, position, name_zh, name_en, highlight_id)
  select p_conference_id, v_id, part.position, part.value ->> 'name_zh', coalesce(part.value ->> 'name_en', ''),
    (part.value ->> 'highlight_id')::uuid
  from jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) with ordinality as part(value, position);

  return v_id;
end;
$$;

revoke all on function public.save_agenda_item from public, anon;
grant execute on function public.save_agenda_item to authenticated;

/*
 * 存一列在一個場地的地點、補充說明、對應場次；還沒有就新增。場地不是這一列同一年度的，被外鍵擋下。
 * 只能動目前年度的；以呼叫者的權限執行。
 */
create function public.save_agenda_item_venue(
  p_agenda_item_id uuid,
  p_venue_id uuid,
  p_place_zh text,
  p_place_en text,
  p_note_zh text,
  p_note_en text,
  p_session_id uuid
)
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
  select conference_id into v_conference_id from public.agenda_items where id = p_agenda_item_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  insert into public.agenda_item_venues (
    conference_id, agenda_item_id, venue_id, place_zh, place_en, note_zh, note_en, session_id
  ) values (
    v_conference_id, p_agenda_item_id, p_venue_id, p_place_zh, p_place_en, p_note_zh, p_note_en, p_session_id
  )
  on conflict (agenda_item_id, venue_id) do update
  set place_zh = excluded.place_zh,
    place_en = excluded.place_en,
    note_zh = excluded.note_zh,
    note_en = excluded.note_en,
    session_id = excluded.session_id,
    updated_at = now();
end;
$$;

revoke all on function public.save_agenda_item_venue from public, anon;
grant execute on function public.save_agenda_item_venue to authenticated;

-- 排序、刪除沿用首頁項目的函式，加上大會程序。其餘和 20261113000000_highlights.sql 相同。
create or replace function public.move_home_item(p_table text, p_id uuid, p_up boolean)
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
  if p_table is null or p_table not in ('faqs', 'custom_blocks', 'highlights', 'agenda_items') then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  execute format('select conference_id from public.%I where id = $1', p_table)
    into v_conference_id
    using p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  execute format(
    'select array_agg(id order by position, id)
    from (select id, position from public.%I where conference_id = $1 for update) as items',
    p_table
  )
    into v_ids
    using v_conference_id;

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

  execute format(
    'update public.%I as item
    set position = ordered.position, updated_at = now()
    from unnest($1::uuid[]) with ordinality as ordered(id, position)
    where item.id = ordered.id and item.position <> ordered.position',
    p_table
  )
    using v_ids;
end;
$$;

create or replace function public.delete_home_item(p_table text, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_deleted uuid;
begin
  if p_table is null or p_table not in ('faqs', 'custom_blocks', 'highlights', 'agenda_items') then
    raise exception 'not_found';
  end if;
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  execute format('select conference_id from public.%I where id = $1', p_table)
    into v_conference_id
    using p_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  execute format('delete from public.%I where id = $1 and conference_id = $2 returning id', p_table)
    into v_deleted
    using p_id, v_conference_id;
  if v_deleted is null then
    raise exception 'not_found';
  end if;
end;
$$;

/*
 * 複製建立新年度時一起複製大會程序：每一列、子項目（大會特色對到新年度的那一項）、各場地的設定（場地、場次對到
 * 新年度的）。編號都用 uuid_generate_v5 從去年的編號算出。其餘和 20261114000000_course_speaker_category.sql 相同。
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
        id, conference_id, position, name_zh, name_en, summary_zh, summary_en, description_zh, description_en
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, row_number() over (order by position, id),
        name_zh, name_en, summary_zh, summary_en, description_zh, description_en
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
