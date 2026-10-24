-- 活動頁改成 4 個共用範本（設計稿 docs/design/activity-templates-handoff.md）。這張是範本 A（人物卡片）與 D（個人介紹頁）：
-- - 角落課程、靈性課程也用人物卡片，版型多了 corner、spiritual；
-- - 人物卡片依教堂分組（不再依北／中／南區），每位人物記教堂，或對應到一門課程（教堂與課名從課程帶，不用重打）；
-- - 每位人物有自己的個人介紹頁：講師（貴賓）介紹、課程簡介、課程大綱，依版型顯示其中幾項；
--   卡片的按鈕連到這一頁，不再填按鈕文字與連結網址。
--
-- 這張 migration 只新增、不刪除：上線順序是先推 migration 再合併，中間線上還是舊程式，會讀寫 link_label、link_url。
-- 新程式不再用這兩欄（靜態展示的作品名稱搬到 course_title），等新程式上線後由下一張 migration 刪除。

alter table public.highlights drop constraint highlights_page_template_valid;
alter table public.highlights add constraint highlights_page_template_valid
  check (page_template in ('corner', 'spiritual', 'honor', 'missionary', 'exhibit'));

alter table public.highlight_people
  -- 人物在哪一間教堂（卡片依這個分組）。對應到課程時以課程的教堂為準，這一欄存檔時跟著改。
  add column venue_id uuid,
  -- 對應的課程：課名與教堂從課程帶。課程刪除時只拿掉對應，人物留著。
  add column course_id uuid,
  -- 沒有對應課程時自己打的課程名稱；靜態展示是作品名稱。
  add column course_title_zh text not null default '',
  add column course_title_en text not null default '',
  -- 個人介紹頁的文字（純文字，空一行分段）。大綱一行一點。
  add column bio_zh text not null default '',
  add column bio_en text not null default '',
  add column summary_zh text not null default '',
  add column summary_en text not null default '',
  add column outline_zh text not null default '',
  add column outline_en text not null default '',
  add constraint highlight_people_venue
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete set null (venue_id),
  add constraint highlight_people_course
    foreign key (course_id, conference_id) references public.courses (id, conference_id) on delete set null (course_id);

create index highlight_people_venue_id on public.highlight_people (venue_id);
create index highlight_people_course_id on public.highlight_people (course_id);

-- 靜態展示原本把作品名稱寫在按鈕文字。
update public.highlight_people p
set course_title_zh = p.link_label_zh, course_title_en = p.link_label_en
from public.highlights h
where h.id = p.highlight_id and h.page_template = 'exhibit';

grant update (
  venue_id, course_id, course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en
) on public.highlight_people to authenticated;

/*
 * 存人物：多了教堂、對應課程、課程（作品）名稱與個人介紹頁的文字。
 * 有對應課程時（這次送來的，或沒送 course_id 時原本的），教堂一定以課程所在的教堂為準，不會存成對不上的組合。
 * 新欄位沒送來時保留原本的值：先推 migration 到合併之間，舊後台存檔不會把新欄位清掉；
 * 舊欄位 link_label、link_url 也一樣（新程式不送）。
 * 舊後台存靜態展示的人物時（送了 link_label、沒送 course_title），作品名稱照舊從按鈕文字換算，
 * 和上面的資料轉換一樣，免得新程式上線後作品名稱是舊的或空白。
 * 其餘和 20261122000000_drop_legacy_person_units.sql 相同。
 */
create or replace function public.save_highlight_person(p_highlight_id uuid, p_id uuid, p_values jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_template text;
  v_id uuid;
  v public.highlight_people%rowtype;
  v_old public.highlight_people%rowtype;
  v_stake_id uuid;
  v_course_id uuid;
  v_venue_id uuid;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  select conference_id, page_template into v_conference_id, v_template from public.highlights where id = p_highlight_id;
  if v_conference_id is null then
    raise exception 'not_found';
  end if;
  perform public.lock_current_conference(v_conference_id);

  if p_id is not null then
    select * into v_old from public.highlight_people where id = p_id and highlight_id = p_highlight_id for update;
    if v_old.id is null then
      raise exception 'not_found';
    end if;
  end if;

  select * into v from jsonb_populate_record(null::public.highlight_people, p_values);
  v_stake_id := v.stake_id;
  if v.ward_id is not null then
    select stake_id into v_stake_id from public.wards where id = v.ward_id;
    if v_stake_id is null then
      raise exception 'not_found';
    end if;
  end if;

  v_course_id := case when p_values ? 'course_id' then v.course_id else v_old.course_id end;
  v_venue_id := case when p_values ? 'venue_id' then v.venue_id else v_old.venue_id end;
  if v_course_id is not null then
    select s.venue_id into v_venue_id
    from public.courses c
    join public.sessions s on s.id = c.session_id
    where c.id = v_course_id and c.conference_id = v_conference_id;
    if v_venue_id is null then
      raise exception 'not_found';
    end if;
  end if;

  -- 中英分開判斷：只送了其中一個語言的按鈕文字時，另一個語言的作品名稱保留原本的值。
  if v_template = 'exhibit' and p_values ? 'link_label_zh' and not p_values ? 'course_title_zh' then
    v.course_title_zh := coalesce(v.link_label_zh, '');
  end if;
  if v_template = 'exhibit' and p_values ? 'link_label_en' and not p_values ? 'course_title_en' then
    v.course_title_en := coalesce(v.link_label_en, '');
  end if;

  if p_id is null then
    insert into public.highlight_people (
      conference_id, highlight_id, position, stake_id, ward_id, service_area_zh, service_area_en, name_zh, name_en,
      photo_path, photo_focus, link_label_zh, link_label_en, link_url,
      venue_id, course_id, course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en
    )
    values (
      v_conference_id, p_highlight_id,
      coalesce((select max(position) from public.highlight_people where highlight_id = p_highlight_id), 0) + 1,
      v_stake_id, v.ward_id, coalesce(v.service_area_zh, ''), coalesce(v.service_area_en, ''),
      v.name_zh, coalesce(v.name_en, ''), v.photo_path, coalesce(v.photo_focus, 50),
      coalesce(v.link_label_zh, ''), coalesce(v.link_label_en, ''), v.link_url,
      v_venue_id, v_course_id, coalesce(v.course_title_zh, ''), coalesce(v.course_title_en, ''),
      coalesce(v.bio_zh, ''), coalesce(v.bio_en, ''), coalesce(v.summary_zh, ''), coalesce(v.summary_en, ''),
      coalesce(v.outline_zh, ''), coalesce(v.outline_en, '')
    )
    returning id into v_id;
  else
    update public.highlight_people p
    set stake_id = v_stake_id, ward_id = v.ward_id,
      service_area_zh = coalesce(v.service_area_zh, ''), service_area_en = coalesce(v.service_area_en, ''),
      name_zh = v.name_zh, name_en = coalesce(v.name_en, ''),
      photo_path = v.photo_path, photo_focus = coalesce(v.photo_focus, 50),
      link_label_zh = case when p_values ? 'link_label_zh' then coalesce(v.link_label_zh, '') else p.link_label_zh end,
      link_label_en = case when p_values ? 'link_label_en' then coalesce(v.link_label_en, '') else p.link_label_en end,
      link_url = case when p_values ? 'link_url' then v.link_url else p.link_url end,
      venue_id = v_venue_id,
      course_id = v_course_id,
      course_title_zh = coalesce(v.course_title_zh, p.course_title_zh),
      course_title_en = coalesce(v.course_title_en, p.course_title_en),
      bio_zh = coalesce(v.bio_zh, p.bio_zh),
      bio_en = coalesce(v.bio_en, p.bio_en),
      summary_zh = coalesce(v.summary_zh, p.summary_zh),
      summary_en = coalesce(v.summary_en, p.summary_en),
      outline_zh = coalesce(v.outline_zh, p.outline_zh),
      outline_en = coalesce(v.outline_en, p.outline_en),
      updated_at = now()
    where p.id = p_id
    returning p.id into v_id;
  end if;

  return v_id;
end;
$$;

/*
 * 複製建立新年度：人物的教堂、對應課程（換成新年度的同一間教堂、同一門課）與個人介紹頁的文字也複製。
 * 其餘和 20261122000000_drop_legacy_person_units.sql 相同。
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
