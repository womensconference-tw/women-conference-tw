-- 首頁主視覺圖片與歡迎詞署名（#81）。主視覺是美編組每年重做的大圖（圖裡已經有主題經文），每個年度最多四張：
-- 手機版 4:5、電腦版 3:1，各有中文、英文，都可有可無。總管理員在後台上傳、更換、刪除。

alter table public.conferences
  -- 檔案在存放空間 hero-images 裡的路徑：<年度大會編號>/<版本>-<語言>-<隨機編號>.<副檔名>。
  -- 每次上傳都是新的檔名，換圖之後瀏覽器與 CDN 不會拿到舊圖。
  add column hero_mobile_zh_path text,
  add column hero_mobile_en_path text,
  add column hero_desktop_zh_path text,
  add column hero_desktop_en_path text,
  -- 圖片說明：給看不到圖的人（螢幕閱讀器）聽的文字。有圖時中文必填。
  add column hero_alt_zh text not null default '',
  add column hero_alt_en text not null default '',
  -- 歡迎詞的署名，例如「2026台灣姐妹大會籌備委員會」，首頁顯示在歡迎詞最後一行靠右。
  add column welcome_signature_zh text not null default '',
  add column welcome_signature_en text not null default '',
  add constraint conferences_hero_alt_required check (
    hero_alt_zh ~ '[^[:space:]]'
    or num_nonnulls(hero_mobile_zh_path, hero_mobile_en_path, hero_desktop_zh_path, hero_desktop_en_path) = 0
  ),
  -- 路徑只能指到這個年度自己的資料夾、對的位置，不能指到別的年度或別人的檔案。
  add constraint conferences_hero_paths_valid check (
    (hero_mobile_zh_path is null or hero_mobile_zh_path ~ ('^' || id::text || '/mobile-zh-[0-9a-f-]{36}\.(jpg|png|webp)$'))
    and (hero_mobile_en_path is null or hero_mobile_en_path ~ ('^' || id::text || '/mobile-en-[0-9a-f-]{36}\.(jpg|png|webp)$'))
    and (hero_desktop_zh_path is null or hero_desktop_zh_path ~ ('^' || id::text || '/desktop-zh-[0-9a-f-]{36}\.(jpg|png|webp)$'))
    and (hero_desktop_en_path is null or hero_desktop_en_path ~ ('^' || id::text || '/desktop-en-[0-9a-f-]{36}\.(jpg|png|webp)$'))
  );

-- 總管理員在後台修改這些欄位（20261027000000_content_editing.sql 的欄位權限）。
grant update (
  hero_mobile_zh_path, hero_mobile_en_path, hero_desktop_zh_path, hero_desktop_en_path,
  hero_alt_zh, hero_alt_en, welcome_signature_zh, welcome_signature_en
) on public.conferences to authenticated;

/*
 * 存放主視覺的空間：任何人都能用公開網址讀（首頁要顯示），只有總管理員能上傳、刪除（ADR 0004）。
 * 只收 JPG、PNG、WebP，單張上限 5 MB，由存放空間本身擋下；後台在上傳前也先檢查，好說明原因。
 * 圖片由瀏覽器直接上傳到這裡（不經過網站伺服器，Vercel 的伺服器收不了這麼大的檔案），所以權限一定要在這裡擋。
 */
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hero-images', 'hero-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']);

-- 公開的空間用公開網址讀不需要權限規則；刪除、覆寫時存放空間要先讀得到那個檔案，所以總管理員要能讀。
create policy "Admins can read hero images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'hero-images' and public.is_staff_admin());

create policy "Admins can upload hero images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'hero-images' and public.is_staff_admin());

create policy "Admins can replace hero images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'hero-images' and public.is_staff_admin())
  with check (bucket_id = 'hero-images' and public.is_staff_admin());

create policy "Admins can delete hero images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'hero-images' and public.is_staff_admin());

/*
 * 複製建立新年度時一起複製歡迎詞署名（和歡迎詞一樣，改一改就好）；主視覺圖片與圖片說明每年不同，不複製。
 * 其餘和 20261115000000_agenda.sql 相同。
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
