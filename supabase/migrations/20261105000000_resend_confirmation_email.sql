-- 重寄確認信與寄信紀錄檢視（#18）。

/*
 * 重寄：總管理員在後台報名詳細頁按「重寄確認信」，寄出目前內容的確認信，記成新的一種寄信紀錄。
 * 寄信仍由網站伺服器透過 begin_confirmation_email、finish_email_log 進行（只開放給 service_role），
 * 伺服器先用總管理員的登入身分確認她是總管理員、讀得到這筆報名（見 src/lib/email-logs.ts）。
 * 重寄沒有送出編號，可以寄好幾次；已取消的報名不重寄（begin_confirmation_email 只讓取消信寄給已取消的報名）。
 */
alter table public.email_logs
  drop constraint email_logs_kind_valid,
  add constraint email_logs_kind_valid check (kind in ('registered', 'updated', 'cancelled', 'resent'));

/*
 * 後台檢視：只有總管理員讀得到。報名詳細頁只開放給總管理員，課務組、報報組不需要看寄信紀錄；
 * 收件地址與錯誤回應可能含個資，所以不放寬。寫入仍只能透過上面的函式。
 */
grant select on public.email_logs to authenticated;

create policy "Admins can read email logs"
  on public.email_logs for select
  to authenticated
  using ((select public.is_staff_admin()));
