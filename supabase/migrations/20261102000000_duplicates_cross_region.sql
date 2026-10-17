-- 疑似重複與跨區（#24）：後台名單上的兩個標記，只做標記，前台報名不阻擋。
-- 都寫成報名的計算欄位，名單可以直接選出、篩選（PostgREST 的 computed field）。
-- 以呼叫者身分執行（預設 security invoker），只比對呼叫者讀得到的報名，不會透露範圍外的資料。

/*
 * 跨區：所選場地的區與所屬支聯會的區不同。每一區每年只在一間教堂舉辦，所以不另外記支聯會的預設場地：
 * 原本 #23 加的預設場地拿掉，跨區直接比區。
 */
alter table public.stakes drop column default_site_key;

create function public.is_cross_region(public.registrations)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select st.region <> v.region
    from public.stakes st, public.venues v
    where st.id = $1.stake_id and v.id = $1.venue_id
  ), false);
$$;

/*
 * 支聯會可以改區（例如隔年重新劃分）。報報組依支聯會的區看名單，改了之後這個支聯會的報名（包括舊年度的）
 * 都算新的區；舊年度的個人資料匯出後就刪除，後台不看過往的名單，所以不必保留報名當下的區。
 * 支會仍然不能改隸屬的支聯會（wards_stake_fixed）。
 */
drop trigger stakes_region_fixed on public.stakes;
drop function public.stake_region_fixed();

/*
 * 疑似重複：同一年度、同一支會，另有一筆姓名相同的有效報名。已取消的報名不算，也不讓別筆變成疑似重複。
 * 姓名去掉所有空白（和 trim_blank 同一組空白字元，包括全形空白與 U+FEFF）、英文不分大小寫再比，
 * 「王 小美」和「王小美」視為相同。
 */
create function public.registration_name_key(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(name, '[\t\n\v\f\r \u0085   -     　﻿]', '', 'g'));
$$;

/*
 * 比對用的姓名存成資料庫自動算的欄位。直接比欄位（text 的 = 是 leakproof），權限規則之下也能用索引；
 * 比函式算出來的值時，權限規則要先逐筆檢查，報名多時「只看疑似重複」會慢好幾秒。
 * 匿名化清掉姓名時，這個欄位跟著變成空值，不再比對。
 */
alter table public.registrations
  add column name_key text generated always as (public.registration_name_key(name)) stored;

create index registrations_duplicate_key on public.registrations (conference_id, ward_id, name_key);

create function public.is_suspected_duplicate(public.registrations)
returns boolean
language sql
stable
set search_path = ''
as $$
  select $1.status = 'registered' and exists (
    select 1
    from public.registrations other
    where other.conference_id = $1.conference_id
      and other.ward_id = $1.ward_id
      and other.name_key = $1.name_key
      and other.id <> $1.id
      and other.status = 'registered'
  );
$$;

revoke all on function public.is_cross_region(public.registrations) from public, anon;
revoke all on function public.is_suspected_duplicate(public.registrations) from public, anon;
grant execute on function public.is_cross_region(public.registrations) to authenticated;
grant execute on function public.is_suspected_duplicate(public.registrations) to authenticated;
