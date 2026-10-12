-- 場次與課程，以及報名所選的課程。名額在送出時由資料庫一次檢查並佔用（ADR 0006）。

-- 場次：同一場地中的一個上課時段。每個場次選一門課程。
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  venue_id uuid not null,
  -- 顯示順序，小的在前。
  position integer not null default 0,
  -- 例如「第一場 10:00–10:50」。
  name_zh text not null,
  name_en text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sessions_venue_in_conference
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete cascade,
  constraint sessions_name_not_blank check (name_zh ~ '[^[:space:]]'),
  -- 讓課程用（場次, 年度大會）、報名所選課程用（場次, 場地）一起參照。
  constraint sessions_id_conference_id unique (id, conference_id),
  constraint sessions_id_venue_id unique (id, venue_id)
);

create index sessions_venue_id on public.sessions (venue_id, position);

-- 課程：在某場地某場次開設的一堂課。
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null references public.conferences (id) on delete cascade,
  session_id uuid not null,
  position integer not null default 0,
  title_zh text not null,
  title_en text not null default '',
  -- 講師、教室等補充說明。
  description_zh text not null default '',
  description_en text not null default '',
  -- 容量上限；空值表示不限人數。容量不是資料庫的硬限制，是報名者送出時的檢查（後台之後可確認後超收）。
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint courses_session_in_conference
    foreign key (session_id, conference_id) references public.sessions (id, conference_id) on delete cascade,
  constraint courses_title_not_blank check (title_zh ~ '[^[:space:]]'),
  constraint courses_capacity_positive check (capacity > 0),
  constraint courses_id_session_id unique (id, session_id)
);

create index courses_session_id on public.courses (session_id, position);

-- 讓報名所選課程用（報名, 場地）一起參照，保證課程在報名的場地。
alter table public.registrations add constraint registrations_id_venue_id unique (id, venue_id);

-- 報名所選的課程：每個場次一門。
-- 場次必須在報名的場地，所以要換場地就得先清掉原本的課程。
-- 有人選過（包括已取消的報名）的場次與課程不能直接刪除，免得報名紀錄默默少了課程；後台刪除時要先處理。
create table public.registration_courses (
  registration_id uuid not null,
  venue_id uuid not null,
  session_id uuid not null,
  course_id uuid not null,
  created_at timestamptz not null default now(),

  primary key (registration_id, session_id),
  constraint registration_courses_registration
    foreign key (registration_id, venue_id) references public.registrations (id, venue_id) on delete cascade,
  constraint registration_courses_session_in_venue
    foreign key (session_id, venue_id) references public.sessions (id, venue_id),
  constraint registration_courses_course_in_session
    foreign key (course_id, session_id) references public.courses (id, session_id)
);

create index registration_courses_course_id on public.registration_courses (course_id);

alter table public.sessions enable row level security;
alter table public.courses enable row level security;
alter table public.registration_courses enable row level security;

-- 前台訪客只能讀到目前年度的場次與課程。
create policy "Anyone can read sessions of the current conference"
  on public.sessions for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read courses of the current conference"
  on public.courses for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

-- 和報名一樣，不開放前台直接讀寫。
revoke all on public.registration_courses from anon, authenticated;

-- 某門課已被有效報名（未取消）佔用的名額。報名、修改、取消、後台都用這裡算。
create function public.course_seats_taken(p_course_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.registration_courses rc
  join public.registrations r on r.id = rc.registration_id
  where rc.course_id = p_course_id and r.status = 'registered'
$$;

revoke all on function public.course_seats_taken from public;

-- 目前年度已額滿的課程，給選課畫面標示「已額滿」。只透露是否額滿，不透露報名資料。
create function public.full_courses()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.courses c
  join public.conferences cf on cf.id = c.conference_id and cf.is_current
  where c.capacity is not null and public.course_seats_taken(c.id) >= c.capacity
$$;

revoke all on function public.full_courses from public;
grant execute on function public.full_courses to anon, authenticated;

-- 送出報名多了所選課程，參數不同就是另一個函式，所以先刪掉舊的。
-- 新參數放最後並預設為空，正式環境先推資料庫、網站還沒更新的那段時間，舊網站照樣能報名（那時還沒有課程）。
drop function public.submit_registration(uuid, uuid, uuid, text, text, text, text, boolean);

/*
 * 報名服務的送出：前台唯一能寫入報名的地方。
 * 欄位格式由報名服務先檢查、資料表的限制再擋一次；這裡檢查要看資料庫當下狀態的規則：
 * 目前年度是否報名中、場地是否屬於目前年度、支會在報名當下是否隸屬於該支聯會且都啟用中、
 * 所選課程是否在該場地且每個場次剛好一門，以及課程名額。
 * 不符合時丟出代碼（例如 registration_not_open），由報名服務轉成欄位旁的錯誤訊息。
 *
 * 名額（ADR 0006）：先鎖住所選的課程，再數已佔用的名額，整個函式在同一個交易裡。
 * 兩人同時搶最後一個名額時，後到的會等先到的寫完，才數到已滿。
 * 任何一門額滿就丟出 course_full，detail 是額滿課程的 id（以逗號分隔），整筆都不寫入。
 */
create function public.submit_registration(
  p_venue_id uuid,
  p_stake_id uuid,
  p_ward_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_line_id text,
  p_portrait_consent boolean,
  p_course_ids uuid[] default '{}'
)
returns public.registrations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conference public.conferences;
  v_course_ids uuid[] := coalesce(p_course_ids, '{}');
  v_full uuid[];
  v_number text;
  v_registration public.registrations;
begin
  select * into v_conference from public.conferences where is_current;
  if v_conference.id is null
    -- 時間點沒填時比較結果是 null，也當成不在報名期間。
    or not coalesce(
      now() >= v_conference.registration_opens_at and now() < v_conference.registration_closes_at,
      false
    )
  then
    raise exception 'registration_not_open';
  end if;

  if p_portrait_consent is not true then
    raise exception 'portrait_consent_required';
  end if;

  if not exists (
    select 1 from public.venues where id = p_venue_id and conference_id = v_conference.id
  ) then
    raise exception 'venue_invalid';
  end if;

  if not exists (select 1 from public.stakes where id = p_stake_id and is_active) then
    raise exception 'stake_invalid';
  end if;

  if not exists (
    select 1 from public.wards where id = p_ward_id and stake_id = p_stake_id and is_active
  ) then
    raise exception 'ward_not_in_stake';
  end if;

  -- 每門課都要在所選場地，同一場次只能一門（重複的同一門也算），有開課的場次都要選。
  if exists (
      select 1 from unnest(v_course_ids) as selected(id)
      where not exists (
        select 1
        from public.courses c
        join public.sessions s on s.id = c.session_id
        where c.id = selected.id and s.venue_id = p_venue_id
      )
    )
    or cardinality(v_course_ids) <> (
      select count(distinct session_id) from public.courses where id = any(v_course_ids)
    )
    or exists (
      select 1
      from public.sessions s
      where s.venue_id = p_venue_id
        and exists (select 1 from public.courses c where c.session_id = s.id)
        and not exists (select 1 from public.courses c where c.session_id = s.id and c.id = any(v_course_ids))
    )
  then
    raise exception 'courses_invalid';
  end if;

  -- 依 id 順序上鎖，同時送出的人不會互相卡住。
  perform 1 from public.courses where id = any(v_course_ids) order by id for update;

  select array_agg(id order by id) into v_full
  from public.courses
  where id = any(v_course_ids)
    and capacity is not null
    and public.course_seats_taken(id) >= capacity;
  if v_full is not null then
    raise exception 'course_full' using detail = array_to_string(v_full, ',');
  end if;

  -- 任何人都能直接呼叫這個函式，所以這裡也用 trim_blank 去掉頭尾空白，存下的資料才跟經過報名服務的一致。
  -- 沒有電話時發 100000–999999 的報名編號（不以 0 開頭，免得抄寫時漏掉）；
  -- 同時有人抽到同一組時，唯一索引會擋下，換一組再試。
  loop
    if p_phone is null then
      v_number := (100000 + ('x' || lpad(encode(extensions.gen_random_bytes(4), 'hex'), 16, '0'))::bit(64)::bigint % 900000)::text;
    end if;
    begin
      insert into public.registrations (
        conference_id, venue_id, stake_id, ward_id, name, phone, registration_number, email, line_id,
        portrait_consented_at
      ) values (
        v_conference.id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now()
      )
      returning * into v_registration;
      exit;
    exception when unique_violation then
      if p_phone is not null then
        raise;
      end if;
    end;
  end loop;

  insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
  select v_registration.id, p_venue_id, session_id, id
  from public.courses
  where id = any(v_course_ids);

  return v_registration;
end;
$$;

revoke all on function public.submit_registration from public;
grant execute on function public.submit_registration to anon, authenticated;
