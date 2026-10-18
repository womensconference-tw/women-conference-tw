-- 午后動態改成場次（#65）：午后動態就是課程的一種。每個場地現有的午后動態，變成該場地最後一個場次
-- 「午后動態」／"Afternoon activity" 裡的課程，名額、說明、排序、停止報名照舊，課程沿用原本的 id。
-- 已選了午后動態的報名改成選了那門課（已取消的報名也一樣，和課程一樣保留紀錄），沒選的就是這個場次「不選課」。
-- 轉換後移除午后動態的資料表與欄位；只為它存在的函式在下一個 migration 移除。

-- 先擋下報名的寫入（送出、修改、取消）與午后動態的修改，直到轉換完成：不然下面複製選擇之後、
-- 刪掉欄位之前才寫入的報名，她選的午后動態會遺失。讀取照常。鎖到整個 migration 結束才放開。
-- 報名的寫入第一步都先鎖住目前年度（for key share），之後才碰午后動態與報名，兩者的先後還不一樣；
-- 所以先鎖年度大會：正在寫的做完、新的卡在第一步，再鎖午后動態與報名就不會和它們互相等待。
-- migration 整個檔案是一個隱含的交易，最外層不能直接 lock table，所以放在 do 區塊裡。
do $$
begin
  lock table public.conferences, public.afternoon_activities, public.registrations in exclusive mode;
end
$$;

-- 報名期間場次與課程不能新增（sessions_locked_after_opening），這次轉換是例外，暫時關掉。
-- 新場次排在場地最後，不會夾在成對課程的兩個場次中間，所以成對課程的檢查也不必跑。
alter table public.sessions disable trigger sessions_locked_after_opening;
alter table public.sessions disable trigger course_pairs_valid_after_session_change;
alter table public.courses disable trigger courses_locked_after_opening;

-- 場次 id 由場地 id 算出，下面的課程與選課紀錄才找得到它。
insert into public.sessions (id, conference_id, venue_id, position, name_zh, name_en)
select extensions.uuid_generate_v5(v.id, 'afternoon_activity'), v.conference_id, v.id,
  coalesce((select max(s.position) from public.sessions s where s.venue_id = v.id), 0) + 1,
  '午后動態', 'Afternoon activity'
from public.venues v
where exists (select 1 from public.afternoon_activities a where a.venue_id = v.id);

insert into public.courses (
  id, conference_id, session_id, position, title_zh, title_en, description_zh, description_en, capacity,
  registration_stopped, created_at, updated_at
)
select a.id, a.conference_id, extensions.uuid_generate_v5(a.venue_id, 'afternoon_activity'), a.position,
  a.title_zh, a.title_en, a.description_zh, a.description_en, a.capacity, a.registration_stopped,
  a.created_at, a.updated_at
from public.afternoon_activities a;

-- 午后動態一定在報名的場地（registrations_afternoon_activity_in_venue），所以場次也在報名的場地。
insert into public.registration_courses (registration_id, venue_id, session_id, course_id, created_at)
select r.id, r.venue_id, extensions.uuid_generate_v5(r.venue_id, 'afternoon_activity'), r.afternoon_activity_id,
  r.updated_at
from public.registrations r
where r.afternoon_activity_id is not null;

alter table public.sessions enable trigger sessions_locked_after_opening;
alter table public.sessions enable trigger course_pairs_valid_after_session_change;
alter table public.courses enable trigger courses_locked_after_opening;

alter table public.registrations drop column afternoon_activity_id;
drop table public.afternoon_activities;
