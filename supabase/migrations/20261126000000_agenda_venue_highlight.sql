-- 大會程序接大會特色（#118）：靜態展示整天展示、不用報名，不是報名表上的場次，「對應的場次」選不到它。
-- 各教堂的設定改成可以接一項大會特色（和場次擇一），首頁在這一列下面列出那項大會特色裡屬於這間教堂的人物。
-- 只新增不刪除，讓先推 migration 到合併之間的舊程式照常運作（舊程式存各教堂設定時會清掉大會特色，那時還沒有人設定）。

alter table public.agenda_item_venues
  add column highlight_id uuid,
  -- 大會特色要是同一年度的。刪除大會特色時只清掉對應，地點與說明留著。
  add constraint agenda_item_venues_highlight_same_conference
    foreign key (highlight_id, conference_id) references public.highlights (id, conference_id)
    on delete set null (highlight_id),
  -- 場次與大會特色擇一或都不接。
  add constraint agenda_item_venues_session_or_highlight check (session_id is null or highlight_id is null);

create index agenda_item_venues_highlight_id on public.agenda_item_venues (highlight_id);

grant update (highlight_id) on public.agenda_item_venues to authenticated;

/*
 * 存一列在一個場地的設定，多了對應的大會特色。p_highlight_id 有預設值，舊程式不傳也能存（大會特色清空）。
 * 其餘和 20261115000000_agenda.sql 相同。
 */
drop function public.save_agenda_item_venue(uuid, uuid, text, text, text, text, uuid);

create function public.save_agenda_item_venue(
  p_agenda_item_id uuid,
  p_venue_id uuid,
  p_place_zh text,
  p_place_en text,
  p_note_zh text,
  p_note_en text,
  p_session_id uuid,
  p_highlight_id uuid default null
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
    conference_id, agenda_item_id, venue_id, place_zh, place_en, note_zh, note_en, session_id, highlight_id
  ) values (
    v_conference_id, p_agenda_item_id, p_venue_id, p_place_zh, p_place_en, p_note_zh, p_note_en, p_session_id, p_highlight_id
  )
  on conflict (agenda_item_id, venue_id) do update
  set place_zh = excluded.place_zh,
    place_en = excluded.place_en,
    note_zh = excluded.note_zh,
    note_en = excluded.note_en,
    session_id = excluded.session_id,
    highlight_id = excluded.highlight_id,
    updated_at = now();

  -- 和 save_agenda_item 一樣，等鎖的時候被移出工作人員名單的話整筆不存。
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
end;
$$;

revoke all on function public.save_agenda_item_venue from public, anon;
grant execute on function public.save_agenda_item_venue to authenticated;

/*
 * 複製建立新年度：各教堂設定對應的大會特色一起複製，對到新年度的那一項。
 * 其餘和 20261125000000_drop_legacy_activity_fields.sql 相同。
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
        conference_id, agenda_item_id, venue_id, place_zh, place_en, note_zh, note_en, session_id, highlight_id
      )
      select v_id, extensions.uuid_generate_v5(v_id, agenda_item_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        place_zh, place_en, note_zh, note_en, extensions.uuid_generate_v5(v_id, session_id::text),
        extensions.uuid_generate_v5(v_id, highlight_id::text)
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
        photo_path, photo_focus,
        venue_id, course_id, course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text),
        row_number() over (partition by highlight_id order by position, id), stake_id, ward_id, service_area_zh, service_area_en,
        name_zh, name_en, photo_path, photo_focus,
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
