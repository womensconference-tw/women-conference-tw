-- 查詢報名時用來比對的姓名：去掉前後空白、中間連續的空白當成一個、不分英文大小寫。
create function public.lookup_name_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(public.trim_blank(value), '[\t\n\v\f\r \u0085   -     　﻿]+', ' ', 'g'))
$$;

-- 查詢猜錯的紀錄，用來擋下一直猜報名編號（只有 6 碼）的人。
-- 只存姓名的雜湊、不存姓名本身，也不屬於任何年度；一小時後就沒有用，查詢時順手刪掉。
create table public.lookup_failures (
  name_hash text not null,
  attempted_at timestamptz not null default now()
);

create index lookup_failures_name_hash on public.lookup_failures (name_hash, attempted_at);
create index lookup_failures_attempted_at on public.lookup_failures (attempted_at);

alter table public.lookup_failures enable row level security;
revoke all on public.lookup_failures from anon, authenticated;

/*
 * 報名服務的查詢：前台唯一能讀取報名的地方（ADR 0002）。
 * 姓名與電話（或沒有電話者的報名編號）兩項都符合才回傳，只找目前年度，
 * 不提供模糊搜尋或清單，所以不能拿來列舉報名。
 * 同一支電話報了好幾位時，依姓名找到正確的那位。
 * 電話由報名服務整理成存檔的格式再傳進來。
 * 同一個姓名一小時內猜錯 10 次，就丟出 too_many_attempts 暫停查詢，資料正確也一樣，
 * 免得知道姓名的人把 90 萬組報名編號一組一組試出來。
 * 支聯會與支會的名稱一起回傳：報名後它們可能被停用，前台就讀不到了，但查詢仍要顯示。
 * 同一組姓名與電話有好幾筆時（例如取消後重新報名）全部回傳，新的在前。
 */
create function public.lookup_registration(
  p_name text,
  p_phone text,
  p_registration_number text
)
returns table (
  id uuid,
  name text,
  phone text,
  registration_number text,
  email text,
  line_id text,
  stake_id uuid,
  ward_id uuid,
  venue_id uuid,
  course_ids uuid[],
  lunch_option_id uuid,
  afternoon_activity_id uuid,
  choir_part text,
  services text[],
  printed_handbook boolean,
  status text,
  stake_name_zh text,
  stake_name_en text,
  ward_name_zh text,
  ward_name_en text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := public.lookup_name_key(p_name);
  v_hash text := md5(coalesce(public.lookup_name_key(p_name), ''));
begin
  if coalesce(v_key, '') = '' or (p_phone is null and p_registration_number is null) then
    return;
  end if;

  delete from public.lookup_failures f where f.attempted_at < now() - interval '1 hour';
  if (select count(*) from public.lookup_failures f where f.name_hash = v_hash) >= 10 then
    raise exception 'too_many_attempts';
  end if;

  return query
    select
      r.id, r.name, r.phone, r.registration_number, r.email, r.line_id,
      r.stake_id, r.ward_id, r.venue_id,
      array(
        select rc.course_id from public.registration_courses rc where rc.registration_id = r.id
      ),
      r.lunch_option_id, r.afternoon_activity_id, r.choir_part, r.services, r.printed_handbook,
      r.status,
      s.name_zh, s.name_en, w.name_zh, w.name_en
    from public.registrations r
    join public.conferences c on c.id = r.conference_id and c.is_current
    join public.stakes s on s.id = r.stake_id
    join public.wards w on w.id = r.ward_id
    where (r.phone = p_phone or r.registration_number = p_registration_number)
      and public.lookup_name_key(r.name) = v_key
    order by r.created_at desc, r.id;

  if not found then
    insert into public.lookup_failures (name_hash) values (v_hash);
  end if;
end;
$$;

revoke all on function public.lookup_registration from public;
grant execute on function public.lookup_registration to anon, authenticated;
