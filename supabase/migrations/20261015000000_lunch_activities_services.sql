-- 午餐、午后動態、服務意願與紙本手冊。限量的午餐與午后動態和課程用同一套名額檢查（ADR 0006）。

-- 午餐選項：每個場地各自一份，A 場地的午餐不影響 B 場地。
create table public.lunch_options (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null,
  venue_id uuid not null,
  position integer not null default 0,
  name_zh text not null,
  name_en text not null default '',
  -- 例如「含一杯飲料」。
  description_zh text not null default '',
  description_en text not null default '',
  -- 數量上限；空值表示不限。和課程一樣，是報名者送出時的檢查，不是資料庫的硬限制。
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lunch_options_venue_in_conference
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete cascade,
  constraint lunch_options_name_not_blank check (name_zh ~ '[^[:space:]]'),
  constraint lunch_options_capacity_positive check (capacity > 0),
  -- 讓報名用（午餐, 場地）一起參照，保證午餐在報名的場地。
  constraint lunch_options_id_venue_id unique (id, venue_id)
);

create index lunch_options_venue_id on public.lunch_options (venue_id, position);

-- 午后動態：只有設定了它的場地才有（例如金華教堂），不屬於任何場次。
create table public.afternoon_activities (
  id uuid primary key default gen_random_uuid(),
  conference_id uuid not null,
  venue_id uuid not null,
  position integer not null default 0,
  title_zh text not null,
  title_en text not null default '',
  description_zh text not null default '',
  description_en text not null default '',
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint afternoon_activities_venue_in_conference
    foreign key (venue_id, conference_id) references public.venues (id, conference_id) on delete cascade,
  constraint afternoon_activities_title_not_blank check (title_zh ~ '[^[:space:]]'),
  constraint afternoon_activities_capacity_positive check (capacity > 0),
  constraint afternoon_activities_id_venue_id unique (id, venue_id)
);

create index afternoon_activities_venue_id on public.afternoon_activities (venue_id, position);

-- 報名的午餐、午后動態都是單選，空值表示「不需要」「不參加」。
-- 必須在報名的場地；有人選過（包括已取消的報名）的選項不能直接刪除，後台刪除時要先處理。
alter table public.registrations
  add column lunch_option_id uuid,
  add column afternoon_activity_id uuid,
  -- 即席唱詩班的聲部；空值表示不參加唱詩班。
  add column choir_part text,
  -- 其他服務意願，依報名表的順序存、不重複。
  add column services text[] not null default '{}',
  add column printed_handbook boolean not null default false,
  add constraint registrations_lunch_in_venue
    foreign key (lunch_option_id, venue_id) references public.lunch_options (id, venue_id),
  add constraint registrations_afternoon_activity_in_venue
    foreign key (afternoon_activity_id, venue_id) references public.afternoon_activities (id, venue_id),
  -- 和報名服務（src/lib/registration.ts 的 CHOIR_PARTS、SERVICES）用同一組代碼。
  add constraint registrations_choir_part_valid check (choir_part in ('soprano', 'alto')),
  add constraint registrations_services_valid check (
    services <@ array['setup', 'translation', 'reception', 'cleanup']
  );

create index registrations_lunch_option_id on public.registrations (lunch_option_id);
create index registrations_afternoon_activity_id on public.registrations (afternoon_activity_id);

alter table public.lunch_options enable row level security;
alter table public.afternoon_activities enable row level security;

-- 前台訪客只能讀到目前年度的午餐與午后動態。
create policy "Anyone can read lunch options of the current conference"
  on public.lunch_options for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

create policy "Anyone can read afternoon activities of the current conference"
  on public.afternoon_activities for select
  to anon, authenticated
  using (exists (select 1 from public.conferences c where c.id = conference_id and c.is_current));

-- 某個午餐、午后動態已被有效報名（未取消）佔用的數量。報名、修改、取消、後台都用這裡算。
create function public.lunch_seats_taken(p_lunch_option_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.registrations
  where lunch_option_id = p_lunch_option_id and status = 'registered'
$$;

create function public.afternoon_activity_seats_taken(p_afternoon_activity_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.registrations
  where afternoon_activity_id = p_afternoon_activity_id and status = 'registered'
$$;

revoke all on function public.lunch_seats_taken from public;
revoke all on function public.afternoon_activity_seats_taken from public;

-- 目前年度已額滿的午餐與午后動態，給報名表標示「已額滿」。只透露是否額滿，不透露報名資料。
create function public.full_lunch_options()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.id
  from public.lunch_options l
  join public.conferences cf on cf.id = l.conference_id and cf.is_current
  where l.capacity is not null and public.lunch_seats_taken(l.id) >= l.capacity
$$;

create function public.full_afternoon_activities()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.afternoon_activities a
  join public.conferences cf on cf.id = a.conference_id and cf.is_current
  where a.capacity is not null and public.afternoon_activity_seats_taken(a.id) >= a.capacity
$$;

revoke all on function public.full_lunch_options from public;
revoke all on function public.full_afternoon_activities from public;
grant execute on function public.full_lunch_options to anon, authenticated;
grant execute on function public.full_afternoon_activities to anon, authenticated;

-- 送出報名多了午餐等參數，參數不同就是另一個函式，所以先刪掉舊的。
-- 新參數放最後並有預設值，正式環境先推資料庫、網站還沒更新的那段時間，舊網站照樣能報名。
drop function public.submit_registration(uuid, uuid, uuid, text, text, text, text, boolean, uuid[]);

/*
 * 報名服務的送出：前台唯一能寫入報名的地方。
 * 欄位格式由報名服務先檢查、資料表的限制再擋一次；這裡檢查要看資料庫當下狀態的規則：
 * 目前年度是否報名中、場地是否屬於目前年度、支會在報名當下是否隸屬於該支聯會且都啟用中、
 * 所選課程是否在該場地且每個場次最多一門、午餐與午后動態是否在該場地，以及這些選項的名額。
 * 不符合時丟出代碼（例如 registration_not_open），由報名服務轉成欄位旁的錯誤訊息。
 *
 * 名額（ADR 0006）：先鎖住所選的課程、午餐、午后動態，再數已佔用的名額，整個函式在同一個交易裡。
 * 兩人同時搶最後一個名額時，後到的會等先到的寫完，才數到已滿。
 * 任何一項額滿就整筆都不寫入，detail 是所有額滿選項的 id（以逗號分隔）。
 * 有課程額滿時丟出 course_full（和之前一樣，舊網站才認得），只有午餐、午后動態額滿時丟出 choice_full。
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
  p_course_ids uuid[] default '{}',
  p_lunch_option_id uuid default null,
  p_afternoon_activity_id uuid default null,
  p_choir_part text default null,
  p_services text[] default '{}',
  p_printed_handbook boolean default false
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

  -- 先鎖住所選的選項再數名額；同時送出的人依序數，不會超收。
  -- 固定先課程（依 id 順序）、再午餐、再午后動態，不會互相卡住。
  -- 報名期間場次與課程不能增刪或換時段（見 sessions_locked_after_opening），所以不必防範這些變動。
  perform 1 from public.courses where id = any(v_course_ids) order by id for update;
  perform 1 from public.lunch_options where id = p_lunch_option_id for update;
  perform 1 from public.afternoon_activities where id = p_afternoon_activity_id for update;

  -- 每門課都要在所選場地，同一場次只能一門（重複的同一門也算）。
  -- 沒選課的場次就是「不選課」，所以不檢查每個場次都有選；漏選由報名表在選課步驟提醒。
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
  then
    raise exception 'courses_invalid';
  end if;

  if p_lunch_option_id is not null and not exists (
    select 1 from public.lunch_options where id = p_lunch_option_id and venue_id = p_venue_id
  ) then
    raise exception 'lunch_invalid';
  end if;

  if p_afternoon_activity_id is not null and not exists (
    select 1 from public.afternoon_activities where id = p_afternoon_activity_id and venue_id = p_venue_id
  ) then
    raise exception 'afternoon_activity_invalid';
  end if;

  select array_agg(id) into v_full
  from (
    select id from public.courses
    where id = any(v_course_ids) and capacity is not null and public.course_seats_taken(id) >= capacity
    union all
    select id from public.lunch_options
    where id = p_lunch_option_id and capacity is not null and public.lunch_seats_taken(id) >= capacity
    union all
    select id from public.afternoon_activities
    where id = p_afternoon_activity_id and capacity is not null
      and public.afternoon_activity_seats_taken(id) >= capacity
  ) as full_choices;
  if v_full is not null then
    if exists (select 1 from public.courses where id = any(v_full)) then
      raise exception 'course_full' using detail = array_to_string(v_full, ',');
    end if;
    raise exception 'choice_full' using detail = array_to_string(v_full, ',');
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
        portrait_consented_at, lunch_option_id, afternoon_activity_id, choir_part, services, printed_handbook
      ) values (
        v_conference.id, p_venue_id, p_stake_id, p_ward_id, public.trim_blank(p_name), p_phone, v_number,
        nullif(public.trim_blank(p_email), ''), nullif(public.trim_blank(p_line_id), ''), now(),
        p_lunch_option_id, p_afternoon_activity_id, p_choir_part,
        -- 依報名表的順序（SERVICES）、去掉重複；不認得的代碼排在最後留著，交給資料表的限制擋下。
        array(
          select s from unnest(coalesce(p_services, '{}')) as s
          group by s
          order by array_position(array['setup', 'translation', 'reception', 'cleanup'], s), s
        ),
        coalesce(p_printed_handbook, false)
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
