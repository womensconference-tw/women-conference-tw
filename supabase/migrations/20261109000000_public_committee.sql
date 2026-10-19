-- 籌備委員會公開頁面（#74）：工作團隊與籌備委員大多沒有後台帳號，不用登入也要看得到籌備委員會的資訊。
-- 任何人都能讀目前與過去年度的籌備委員會資料；還沒到的年度（複製好、準備中的下一屆）只有工作人員看得到。
-- 寫入仍然只有總管理員（原本的權限規則不變）。

/*
 * 這個年度的籌備委員會資訊是否公開：目前年度，或比目前年度早的年度。沒有目前年度時都不公開。
 * 前台訪客只讀得到目前年度的年度大會，所以以擁有者的權限執行。年度大會本身沒有個資。
 */
create function public.is_public_committee_year(p_conference_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conferences c
    where c.id = p_conference_id
      and c.year <= (select year from public.conferences where is_current)
  );
$$;

revoke all on function public.is_public_committee_year from public;
grant execute on function public.is_public_committee_year to anon, authenticated;

/* 公開頁面的年度選單：籌備委員會資訊公開的年度，新的在前。 */
create function public.list_public_committee_years()
returns table (id uuid, year integer, is_current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.year, c.is_current
  from public.conferences c
  where public.is_public_committee_year(c.id)
  order by c.year desc;
$$;

revoke all on function public.list_public_committee_years from public;
grant execute on function public.list_public_committee_years to anon, authenticated;

-- 原本只開放給工作人員讀取；工作人員那幾條照舊（還沒到的年度也看得到），這裡多開放公開的年度。
grant select on public.committee_texts, public.committee_meetings, public.committee_links,
  public.committee_team_members, public.committee_members to anon;

create policy "Anyone can read public committee texts"
  on public.committee_texts for select
  to anon, authenticated
  using (public.is_public_committee_year(conference_id));

create policy "Anyone can read public committee meetings"
  on public.committee_meetings for select
  to anon, authenticated
  using (public.is_public_committee_year(conference_id));

create policy "Anyone can read public committee links"
  on public.committee_links for select
  to anon, authenticated
  using (public.is_public_committee_year(conference_id));

create policy "Anyone can read public committee team members"
  on public.committee_team_members for select
  to anon, authenticated
  using (public.is_public_committee_year(conference_id));

create policy "Anyone can read public committee members"
  on public.committee_members for select
  to anon, authenticated
  using (public.is_public_committee_year(conference_id));

/*
 * 一個年度的兩份名單用到的支聯會：名稱、區與排序。名單上的支聯會可能已經停用，名稱與區域照樣要顯示，
 * 但前台訪客只讀得到啟用中的支聯會。不放寬支聯會表的權限規則（報名表等其他地方照舊只讀得到啟用中的），
 * 改由這個函式以擁有者的權限讀，自己確認呼叫者看得到這個年度的名單：公開的年度，或是工作人員。
 */
create function public.committee_stakes(p_conference_id uuid)
returns table (id uuid, name_zh text, region text, "position" integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.name_zh, s.region, s.position
  from public.stakes s
  where (
      public.is_public_committee_year(p_conference_id)
      or exists (select 1 from public.staff_members where user_id = (select auth.uid()))
    )
    and (
      exists (select 1 from public.committee_team_members t where t.conference_id = p_conference_id and t.stake_id = s.id)
      or exists (select 1 from public.committee_members m where m.conference_id = p_conference_id and m.stake_id = s.id)
    );
$$;

revoke all on function public.committee_stakes from public;
grant execute on function public.committee_stakes to anon, authenticated;
