-- 課程加講師與分類（#83）。分類就是同一年度的一項大會特色（#82），可以不選。
-- 兩欄都只是文字與歸類，報名開放後照樣能改（courses_locked_after_opening 只擋換時段），也不影響名額；
-- 年度 Excel 不列這兩欄，所以不加資料版本號（courses_data_version_update 只看課名、場次與年度）。

-- 課程的分類要和課程同一年度：外鍵連同年度一起對。
alter table public.highlights add constraint highlights_id_conference_id unique (id, conference_id);

alter table public.courses
  -- 講師，例如「蔡婷儀」「沈亦斌 姐妹、黃蘋 姐妹」，可空。
  add column speaker_zh text not null default '',
  add column speaker_en text not null default '',
  add column highlight_id uuid,
  -- 刪除大會特色時，分到它的課程變成沒有分類（只清掉 highlight_id，年度不動），不擋刪除。
  add constraint courses_highlight_same_conference
    foreign key (highlight_id, conference_id) references public.highlights (id, conference_id)
    on delete set null (highlight_id);

create index courses_highlight_id on public.courses (highlight_id);

-- 前台訪客對課程是欄位層級的讀取權限（20261104000000_stop_registration.sql），新欄位要另外開放。
grant select (speaker_zh, speaker_en, highlight_id) on public.courses to anon;

/*
 * 新增或修改課程時一起存講師與分類。參數變了，舊的函式先拿掉。其餘和 20261022000000_programme_editing.sql 相同：
 * 課程連同教室在同一個交易裡存好；以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
 * 分類不是同一年度的大會特色時，被外鍵 courses_highlight_same_conference 擋下。
 */
drop function public.save_course(uuid, uuid, uuid, integer, text, text, text, text, integer, text);

create function public.save_course(
  p_id uuid,
  p_conference_id uuid,
  p_session_id uuid,
  p_position integer,
  p_title_zh text,
  p_title_en text,
  p_description_zh text,
  p_description_en text,
  p_capacity integer,
  p_classroom text,
  p_speaker_zh text,
  p_speaker_en text,
  p_highlight_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.courses (
      conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity,
      speaker_zh, speaker_en, highlight_id
    ) values (
      p_conference_id, p_session_id, p_position, p_title_zh, p_title_en, p_description_zh, p_description_en, p_capacity,
      p_speaker_zh, p_speaker_en, p_highlight_id
    )
    returning id into v_id;
  else
    update public.courses
    set session_id = coalesce(p_session_id, session_id),
      position = p_position,
      title_zh = p_title_zh,
      title_en = p_title_en,
      description_zh = p_description_zh,
      description_en = p_description_en,
      capacity = p_capacity,
      speaker_zh = p_speaker_zh,
      speaker_en = p_speaker_en,
      highlight_id = p_highlight_id,
      updated_at = now()
    where id = p_id
    returning id into v_id;
    -- 不存在、或呼叫者看不到（不是總管理員、不是目前年度）。
    if v_id is null then
      raise exception 'not_found';
    end if;
  end if;

  if p_classroom is null then
    delete from public.course_classrooms where course_id = v_id;
  else
    insert into public.course_classrooms (course_id, classroom)
    values (v_id, p_classroom)
    on conflict (course_id) do update set classroom = excluded.classroom, updated_at = now();
  end if;

  -- 權限規則讓非總管理員的寫入找不到資料、不會出錯。等課程的列鎖時被移出工作人員名單的話，
  -- 課程照舊更新、教室卻刪不到，所以最後再確認一次，不是總管理員就整筆不存。
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  return v_id;
end;
$$;

revoke all on function public.save_course from public, anon;
grant execute on function public.save_course to authenticated;

/*
 * 複製建立新年度時一起複製講師與分類。大會特色的新編號由去年的編號固定算出（20261113000000_highlights.sql），
 * 分類用同樣的算法就對到新年度複製出來的那一項；沒有分類的照樣沒有（uuid_generate_v5 遇到空值回傳空值）。
 * 其餘和 20261113000000_highlights.sql 相同。
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
