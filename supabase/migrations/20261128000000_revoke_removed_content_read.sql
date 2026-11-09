-- 首頁、大會特色、大會程序、籌備委員會網站移到大會網站（#126），資料先留著（#128）。
-- 原本為了公開頁面讓訪客讀得到的資料，頁面拿掉後沒有地方用，訪客卻還能用網站公開的 publishable key 讀出來
-- （包括大會特色人物、籌備委員的姓名、照片、支聯會與支會）。這裡拿掉公開的讀取權限，資料不刪。
-- 「任何人都能讀」的權限規則同時給訪客與登入的人，拿掉之後不是總管理員的工作人員也讀不到大會特色、大會程序、
-- 常見問題、自訂區塊（後台已經沒有頁面用到）；總管理員的權限規則、工作人員讀籌備委員會資料的權限規則照舊。

-- 1. 資料表：拿掉「任何人都能讀」的權限規則（訪客與登入的人共用的那條），再收回訪客的授權。
drop policy "Anyone can read highlights of the current conference" on public.highlights;
drop policy "Anyone can read highlight venues of the current conference" on public.highlight_venues;
drop policy "Anyone can read highlight venue team of the current conference" on public.highlight_venue_team;
drop policy "Anyone can read highlight people of the current conference" on public.highlight_people;
drop policy "Anyone can read agenda items of the current conference" on public.agenda_items;
drop policy "Anyone can read agenda item parts of the current conference" on public.agenda_item_parts;
drop policy "Anyone can read agenda item venues of the current conference" on public.agenda_item_venues;
drop policy "Anyone can read FAQs of the current conference" on public.faqs;
drop policy "Anyone can read custom blocks of the current conference" on public.custom_blocks;
drop policy "Anyone can read public committee texts" on public.committee_texts;
drop policy "Anyone can read public committee meetings" on public.committee_meetings;
drop policy "Anyone can read public committee links" on public.committee_links;
drop policy "Anyone can read public committee team members" on public.committee_team_members;
drop policy "Anyone can read public committee members" on public.committee_members;

revoke all on table
  public.highlights,
  public.highlight_venues,
  public.highlight_venue_team,
  public.highlight_people,
  public.agenda_items,
  public.agenda_item_parts,
  public.agenda_item_venues,
  public.faqs,
  public.custom_blocks,
  public.committee_texts,
  public.committee_meetings,
  public.committee_links,
  public.committee_team_members,
  public.committee_members,
  public.committee_text_drafts
from anon;

-- 2. 年度：訪客只讀得到報名系統用的欄位。主題經文、歡迎詞、管理員 LINE、主視覺只給舊首頁用。
--    訪客原本是整張表的讀取授權，要先整張收回，再一欄一欄給。
--    之後幫 conferences 加欄位、而且前台要讀的話，要記得在新 migration 裡 grant select (新欄位) ... to anon。
revoke select on table public.conferences from anon;
grant select (
  id, year, conference_date, start_time, end_time, is_current,
  announce_at, registration_opens_at, registration_closes_at, personal_data_cleared_at,
  created_at, updated_at
) on table public.conferences to anon;

-- 3. 函式：這幾個只給公開的籌備委員會網站、大會特色頁用，會繞過權限規則回傳資料，程式已經沒有呼叫，直接拿掉。
drop function public.list_public_committee_years();
drop function public.committee_stakes(uuid);
drop function public.highlight_people_units(uuid);
drop function public.is_public_committee_year(uuid);

-- 課程的分類（大會特色）訪客也不必再讀到。
revoke select (highlight_id) on table public.courses from anon;

-- 4. 存放空間：主視覺、大會特色圖片、籌備委員照片改成不公開，公開網址打不開。
--    總管理員讀、傳、換、刪的權限規則照舊。之前發出去的公開網址（例如大會特色文字裡的圖片）從此打不開；
--    大會網站要用這些圖片的話，請負責人另外下載保存。
update storage.buckets set public = false where id in ('hero-images', 'highlight-images', 'committee-photos');

-- 5. 舊版 save_course（有 p_highlight_id）：20261127000000_registration_only.sql 為了合併前的舊程式先留著，
--    新程式已經上線，不再用到。
drop function public.save_course(
  uuid, uuid, uuid, integer, text, text, text, text, integer, text, text, text, uuid
);
