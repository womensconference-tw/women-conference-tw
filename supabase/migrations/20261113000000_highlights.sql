-- 大會特色（#82）：首頁「大會有什麼」的每一張卡片，例如即席唱詩班、公益服務。屬於年度大會，可排序。
-- 介紹內容用 Markdown（和籌備委員會文字頁同一套，#75），在網站裡的介紹頁 /highlights/<編號> 顯示。
-- 只有總管理員能寫入，由下面的權限規則強制（ADR 0004）。課程的分類（#83）會接到這張表。
create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  -- 卡片上的一句話，可空。
  summary_zh text not null default '',
  summary_en text not null default '',
  -- 介紹頁的內容（Markdown）。空的時候卡片不能點。
  description_zh text not null default '',
  description_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint highlights_name_not_blank check (name_zh ~ '[^[:space:]]')
);

create index highlights_conference_id on public.highlights (conference_id, position);

alter table public.highlights enable row level security;

-- 前台訪客只能讀到目前年度的；公告上線前首頁與介紹頁不顯示，由頁面判斷（和常見問題、自訂區塊一樣）。
create policy "Anyone can read highlights of the current conference"
  on public.highlights for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Admins can manage highlights"
  on public.highlights for all
  to authenticated
  using (public.is_staff_admin())
  with check (public.is_staff_admin());

-- 修改時不能換年度。前台訪客只能讀。
revoke insert, update, delete on public.highlights from anon;
revoke update on public.highlights from authenticated;
grant update (
  position, name_zh, name_en, summary_zh, summary_en, description_zh, description_en, updated_at
) on public.highlights to authenticated;

/*
 * 新增、修改、刪除、排序的函式加上大會特色。其餘和 20261028000000_content_editing_current_year.sql 相同：
 * 只能動目前年度的，檢查和寫入在同一個交易裡；以呼叫者的權限執行，權限規則照樣只讓總管理員寫入。
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
      array['name_zh', 'name_en', 'summary_zh', 'summary_en', 'description_zh', 'description_en']
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

create or replace function public.delete_home_item(p_table text, p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_conference_id uuid;
  v_deleted uuid;
begin
  if p_table is null or p_table not in ('faqs', 'custom_blocks', 'highlights') then
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
  if p_table is null or p_table not in ('faqs', 'custom_blocks', 'highlights') then
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

/*
 * 複製建立新年度時一起複製大會特色（每年大多相同，改一改就好）。和場地、課程一樣用固定的規則產生新編號，
 * 課程的分類（#83）就能對到新年度複製出來的那一項。其餘和 20261110000001_copy_committee_texts_markdown.sql 相同。
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
