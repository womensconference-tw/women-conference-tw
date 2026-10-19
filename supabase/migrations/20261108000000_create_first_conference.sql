-- 建立第一個年度（#70）：還沒有任何年度時，後台不必碰資料庫就能開始。只有總管理員能建立（ADR 0004）。

/*
 * 還沒有任何年度大會時，建立一個空白的年度：只有年份與大會日期，沒有場地、課程、首頁內容。
 * 和複製出來的新年度一樣，三個時程時間點空著、不是目前年度，設為目前年度時再填（set_current_conference）。
 * 已經有年度時不能用（conferences_exist），照舊複製去年：停在舊頁面、或兩位總管理員同時送出時，不會多出空白年度。
 * 鎖住年度大會表再檢查，同時送出的後到者等先到的做完，看得到它建的年度。
 * 新增年度大會沒有權限規則，所以以擁有者的權限執行，自己確認是總管理員。
 */
create function public.create_first_conference(p_year integer, p_conference_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_staff_admin() then
    raise exception 'not_admin';
  end if;

  lock table public.conferences in share row exclusive mode;
  if exists (select 1 from public.conferences) then
    raise exception 'conferences_exist';
  end if;

  insert into public.conferences (year, conference_date)
  values (p_year, p_conference_date)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_first_conference from public, anon;
grant execute on function public.create_first_conference to authenticated;
