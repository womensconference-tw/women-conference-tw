-- 本機開發用的假資料。改下面三個時間點再執行 `npm run db:reset`，就能看到首頁切換狀態。
-- 預設讓首頁顯示「報名中」。
insert into public.conferences (
  year,
  conference_date,
  announce_at,
  registration_opens_at,
  registration_closes_at,
  is_current
) values (
  2027,
  '2027-05-15',
  '2026-09-01 09:00+08',  -- 公告上線
  '2026-10-01 09:00+08',  -- 報名開放
  '2027-04-30 23:59+08',  -- 報名截止
  true
);
