/*
 * 複製年度時，文字頁連同是不是 Markdown 一起複製：從還是純文字的舊年度複製，新年度也照純文字顯示（#75，Codex 審查）。
 * 其他和上一版（20261107000000_preparatory_committee.sql）相同。
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
