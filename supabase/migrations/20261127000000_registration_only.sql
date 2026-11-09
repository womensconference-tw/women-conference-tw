-- 這個網站只做報名（#123、#126、ADR 0012）：首頁、大會特色、大會程序、籌備委員會網站移到大會網站，程式刪掉。
-- 資料表與已經填的資料都先留著，只改兩個函式：
--
-- 1. 複製新年度不再複製只給舊首頁、籌備委員會網站用的內容：主題經文、歡迎詞、管理員 LINE、常見問題、自訂區塊、
--    大會特色（含教堂分頁、團隊、人物）、大會程序、籌備委員會的文字與連結。課程不帶分類（大會特色不複製了）。
--    場地的地址與場地特色照舊複製（同一張表，留著不影響報名）。
-- 2. save_course 多一個不帶分類的版本：後台不再編輯課程的分類，存課程時原本的分類不動、新增的課程沒有分類。
--    舊版本（有 p_highlight_id）先留著，讓先推 migration 到合併之間的舊程式照常運作；之後清資料表時一起拿掉。

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
      insert into public.conferences (id, year, conference_date, start_time, end_time)
      select v_id, p_year, p_conference_date, start_time, end_time
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
        speaker_zh, speaker_en
      )
      select extensions.uuid_generate_v5(v_id, id::text), v_id, extensions.uuid_generate_v5(v_id, session_id::text),
        row_number() over (partition by session_id order by position, id), title_zh, title_en, description_zh, description_en, capacity,
        speaker_zh, speaker_en
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
    )
  -- 上面的寫入不管有沒有被讀到都會執行。
  select (select count(*) from public.course_pairs where conference_id = p_source_id) - count(*)
  into v_skipped
  from kept_pairs;

  return query select v_id, v_skipped;
end;
$$;

/*
 * 存課程（不含分類）：和 20261114000000_course_speaker_category.sql 的 save_course 相同，只是不碰 highlight_id。
 */
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
  p_speaker_en text
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
      speaker_zh, speaker_en
    ) values (
      p_conference_id, p_session_id, p_position, p_title_zh, p_title_en, p_description_zh, p_description_en, p_capacity,
      p_speaker_zh, p_speaker_en
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

revoke all on function public.save_course(uuid, uuid, uuid, integer, text, text, text, text, integer, text, text, text)
  from public, anon;
grant execute on function public.save_course(uuid, uuid, uuid, integer, text, text, text, text, integer, text, text, text)
  to authenticated;
