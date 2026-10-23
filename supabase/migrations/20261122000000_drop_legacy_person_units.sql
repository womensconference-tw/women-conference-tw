-- 刪除介紹頁人物的舊欄位（打字的支聯會、支會）與過渡期間的換算。
-- 20261121000000 只新增不刪除，讓先推 migration 到合併之間的舊程式照常運作；PR #109 的程式上線後就不再用這些。

/*
 * 存人物：不再接受舊後台的文字欄位、也不再寫舊欄位。
 * 其餘和 20261121000000_highlight_people_units.sql 相同。
 */
create or replace function public.save_highlight_person(p_highlight_id uuid, p_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_id uuid;
  v public.highlight_people%rowtype;
  v_stake_id uuid;
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
  v_stake_id := v.stake_id;
  if v.ward_id is not null then
    select stake_id into v_stake_id from public.wards where id = v.ward_id;
    if v_stake_id is null then
      raise exception 'not_found';
    end if;
  end if;

  if p_id is null then
    insert into public.highlight_people (
      conference_id, highlight_id, position, stake_id, ward_id, service_area_zh, service_area_en, name_zh, name_en,
      photo_path, photo_focus, link_label_zh, link_label_en, link_url
    )
    values (
      v_conference_id, p_highlight_id,
      coalesce((select max(position) from public.highlight_people where highlight_id = p_highlight_id), 0) + 1,
      v_stake_id, v.ward_id, coalesce(v.service_area_zh, ''), coalesce(v.service_area_en, ''),
      v.name_zh, coalesce(v.name_en, ''), v.photo_path, coalesce(v.photo_focus, 50),
      coalesce(v.link_label_zh, ''), coalesce(v.link_label_en, ''), v.link_url
    )
    returning id into v_id;
  else
    update public.highlight_people
    set stake_id = v_stake_id, ward_id = v.ward_id,
      service_area_zh = coalesce(v.service_area_zh, ''), service_area_en = coalesce(v.service_area_en, ''),
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

/*
 * 複製建立新年度：不再複製舊欄位。
 * 其餘和 20261121000000_highlight_people_units.sql 相同。
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
        conference_id, highlight_id, position, stake_id, ward_id, service_area_zh, service_area_en, name_zh, name_en,
        photo_path, photo_focus, link_label_zh, link_label_en, link_url
      )
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text),
        row_number() over (partition by highlight_id order by position, id), stake_id, ward_id, service_area_zh, service_area_en,
        name_zh, name_en, photo_path, photo_focus, link_label_zh, link_label_en, link_url
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

drop function public.legacy_stake_id(text, uuid);
drop function public.legacy_ward_id(uuid, text, uuid);

-- 欄位層級的 update 權限隨欄位一起拿掉。
alter table public.highlight_people
  drop column stake_zh,
  drop column stake_en,
  drop column ward_zh,
  drop column ward_en;
