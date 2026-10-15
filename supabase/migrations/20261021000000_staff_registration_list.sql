-- 後台報名名單（ADR 0004）：工作人員直接讀 registrations，範圍由下面的權限規則決定，不靠畫面隱藏。
-- 總管理員讀全部；教堂承辦讀自己場地的報名；支聯會承辦讀自己支聯會的報名（不論在哪個場地）。
-- 只開放讀取：新增、修改、取消仍不開放直接寫入，後台修改報名另外透過資料庫函式，由函式檢查範圍（#17）。
-- 支聯會承辦因此改不了任何資料。
grant select on public.registrations to authenticated;

-- 教堂承辦的 stake_id、支聯會承辦的 venue_id 都是空值，比較結果不成立，不會多讀到別的範圍。
-- 用 (select ...) 包起來，每次查詢只算一次，不必每筆報名重算。
create policy "Staff can read registrations in their scope"
  on public.registrations for select
  to authenticated
  using (
    (select public.is_staff_admin())
    or venue_id = (select venue_id from public.staff_members where user_id = (select auth.uid()))
    or stake_id = (select stake_id from public.staff_members where user_id = (select auth.uid()))
  );

-- 名單要顯示報名當下的支聯會與支會；停用了也要看得到名稱。名稱不是個資，工作人員都能讀。
-- 前台報名表因此要自己篩啟用中的（src/lib/registration-options.ts），工作人員登入著打開時才不會列出停用的。
-- 原本總管理員讀全部、支聯會承辦讀自己的這兩條，都包含在下面這條裡。
drop policy "Admins can read all stakes" on public.stakes;
drop policy "Stake staff can read their own stake" on public.stakes;

create policy "Staff can read all stakes"
  on public.stakes for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));

create policy "Staff can read all wards"
  on public.wards for select
  to authenticated
  using (exists (select 1 from public.staff_members where user_id = (select auth.uid())));
