/*
 * 籌備委員會公開頁面改成有選單的網站：大會簡介、主席的話、會議記錄、工作團隊、籌備委員、執行計畫、大會網站。
 * 1. 第四個文字頁「執行計畫」：和另外三頁一樣用 Markdown 排版，先存草稿、預覽後發布；複製新年度時一起複製。
 * 2. 籌備委員的個人頁：照片與自我介紹（純文字）。照片由後台的瀏覽器直接上傳到存放空間 committee-photos。
 * repo 是公開的：真實姓名、照片與介紹不寫進 migration、seed 或測試，上線後由總管理員在後台輸入。
 */

alter table public.committee_texts add column execution_plan text not null default '';
alter table public.committee_text_drafts add column execution_plan text not null default '';

alter table public.committee_members
  add column bio text not null default '',
  -- 照片在存放空間 committee-photos 裡的路徑：<年度大會編號>/<籌備委員編號>-<隨機編號>.<副檔名>。
  -- 每次上傳都是新的檔名，換照片之後瀏覽器與 CDN 不會拿到舊的。只能指到這位委員自己的檔案。
  add column photo_path text,
  add constraint committee_members_photo_path_valid check (
    photo_path is null
    or photo_path ~ ('^' || conference_id::text || '/' || id::text || '-[0-9a-f-]{36}\.(jpg|png|webp)$')
  );

grant update (bio, photo_path) on public.committee_members to authenticated;

/*
 * 存放籌備委員照片的空間：任何人都能用公開網址讀（公開頁面要顯示），只有總管理員能上傳、刪除（ADR 0004）。
 * 只收 JPG、PNG、WebP，單張上限 5 MB，由存放空間本身擋下；後台在上傳前也先檢查，好說明原因。
 * 圖片由瀏覽器直接上傳到這裡（不經過網站伺服器），所以權限一定要在這裡擋。
 * 名單不複製到新年度，每張照片只屬於一位委員：換照片、刪照片、刪委員時一併刪掉檔案。
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('committee-photos', 'committee-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 公開的空間用公開網址讀不需要權限規則；刪除、覆寫、確認檔案在不在時存放空間要先讀得到，所以總管理員要能讀。
create policy "Admins can read committee photos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'committee-photos' and public.is_staff_admin());

create policy "Admins can upload committee photos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'committee-photos' and public.is_staff_admin());

create policy "Admins can replace committee photos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'committee-photos' and public.is_staff_admin())
  with check (bucket_id = 'committee-photos' and public.is_staff_admin());

create policy "Admins can delete committee photos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'committee-photos' and public.is_staff_admin());

-- 20261111000000_committee_text_drafts.sql 說好下一次改資料庫時刪掉的舊函式（直接發布、不經草稿）。
drop function public.save_committee_texts(uuid, text, text, text);

/*
 * 正式環境的 migration 和網站不是同時上線，三頁版先留著，舊版網站在上線前的空檔（或回滾時）照樣存得了；
 * 下一次改資料庫時再刪掉。舊版網站不知道執行計畫：新開的草稿沿用已發布的執行計畫，已經有草稿時不動它，
 * 否則草稿的執行計畫是空的，一發布就把已發布的清掉（Codex 審查）。其餘和 20261111000000_committee_text_drafts.sql 相同。
 */
create or replace function public.save_committee_text_draft(
  p_conference_id uuid,
  p_introduction text,
  p_chair_message text,
  p_memorandum text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision uuid := gen_random_uuid();
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  insert into public.committee_text_drafts (
    conference_id, introduction, chair_message, memorandum, execution_plan, revision
  )
  values (
    p_conference_id, p_introduction, p_chair_message, p_memorandum,
    coalesce((select execution_plan from public.committee_texts where conference_id = p_conference_id), ''),
    v_revision
  )
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    revision = excluded.revision,
    updated_at = now();
  return v_revision;
end;
$$;

/*
 * 存四個文字頁的草稿，多了執行計畫；其餘和 20261111000000_committee_text_drafts.sql 的三頁版相同。
 */
create function public.save_committee_text_draft(
  p_conference_id uuid,
  p_introduction text,
  p_chair_message text,
  p_memorandum text,
  p_execution_plan text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revision uuid := gen_random_uuid();
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from public.conferences where id = p_conference_id) then
    raise exception 'not_found';
  end if;

  insert into public.committee_text_drafts (
    conference_id, introduction, chair_message, memorandum, execution_plan, revision
  )
  values (p_conference_id, p_introduction, p_chair_message, p_memorandum, p_execution_plan, v_revision)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    execution_plan = excluded.execution_plan,
    revision = excluded.revision,
    updated_at = now();
  return v_revision;
end;
$$;

revoke all on function public.save_committee_text_draft(uuid, text, text, text, text) from public, anon;
grant execute on function public.save_committee_text_draft(uuid, text, text, text, text) to authenticated;

/* 發布草稿，多了執行計畫；其餘和 20261111000000_committee_text_drafts.sql 相同。 */
create or replace function public.publish_committee_texts(p_conference_id uuid, p_revision uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.committee_text_drafts;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  select * into v_draft from public.committee_text_drafts where conference_id = p_conference_id for update;
  if not found then
    raise exception 'no_draft';
  end if;
  -- 沒帶代號（null）也不發布：<> 遇到 null 不成立，會跳過檢查。
  if v_draft.revision is distinct from p_revision then
    raise exception 'draft_changed';
  end if;

  insert into public.committee_texts (conference_id, introduction, chair_message, memorandum, execution_plan, markdown)
  values (p_conference_id, v_draft.introduction, v_draft.chair_message, v_draft.memorandum, v_draft.execution_plan, true)
  on conflict (conference_id) do update
  set introduction = excluded.introduction,
    chair_message = excluded.chair_message,
    memorandum = excluded.memorandum,
    execution_plan = excluded.execution_plan,
    markdown = true,
    updated_at = now();
  delete from public.committee_text_drafts where conference_id = p_conference_id;
end;
$$;

/*
 * 複製建立新年度時一起複製執行計畫。其餘和 20261117000000_highlight_venues.sql 相同。
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
    highlight_venues as (
      insert into public.highlight_venues (conference_id, highlight_id, venue_id, body_zh, body_en)
      select v_id, extensions.uuid_generate_v5(v_id, highlight_id::text), extensions.uuid_generate_v5(v_id, venue_id::text),
        body_zh, body_en
      from public.highlight_venues
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
