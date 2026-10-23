# 姊妹大會活動頁：4 個範本（取代 14 頁各自設計）

來源：姐妹大會程序表（各頁必要區塊）＋舊網站截圖。
設計檔（Design 畫布格式，版面在 `<x-dc>`，樣本資料在 `renderVals()`；實作時改寫成 Next.js 元件，不要沿用這個格式）：
- `template-a-cards.dc.html`：範本 A
- `template-b-feature.dc.html`：範本 B
- `template-c-venue-team.dc.html`：範本 C
- `template-d-person.dc.html`：範本 D

視覺規格與全站表頭／頁尾以 `homepage-handoff.md` 為準；不放時間、地點、報名按鈕。已定案的規則見 `../decisions-2026-10-06.md`。

## 頁面 → 範本

| 範本 | 用在哪些頁 | 區塊（由上到下） |
|---|---|---|
| A 介紹頁・人物卡片型 | 角落、靈性、向貴賓致敬、傳教士、靜態展示 的介紹頁 | 麵包屑 → 標題 → 前言（文字編輯區）→ 選教堂按鈕（全部／金華／大雅／鳥松）→ 依教堂分組的人物卡片（照片、支聯會、支會、姓名；角落與靜態展示另顯示課程／作品名稱） |
| B 介紹頁・圖文型 | 即席唱詩班、迷妳音樂會 的介紹頁 | 麵包屑 → 標題 → 各教堂大按鈕（連到範本 C）→ 圖片 → 介紹（文字編輯區） |
| C 各教堂頁・團隊型 | 即席唱詩班、迷妳音樂會 的各教堂頁 | 麵包屑 → 教堂名＋切換其他教堂 → 海報（選填）→ 製作靈感（選填）→ 成員卡（照片、事工、姓名、人物介紹）→ 回到活動 |
| D 個人介紹頁 | A 的卡片點進去的頁 | 麵包屑 → 人物卡（沿用 A 的資料）＋所屬教堂 → 標題（課程／作品名稱，沒有就用姓名）→ 依活動決定的文字區塊 → 回到活動 |

範本 D 的文字區塊：
- 角落、靈性：講師介紹、課程簡介、課程大綱
- 傳教士：講師介紹、課程大綱
- 向貴賓致敬：貴賓介紹
- 靜態展示：講師介紹

## 照片

- 設計稿用姓氏字當占位。正式版用後台上傳的原始長方形照片，`border-radius: 50%` + `object-fit: cover` 顯示成圓形。
- 每張照片有「對焦點」欄位（對應 `object-position`），讓管理員調整頭部位置。`alt` 用姓名。

## 資料結構建議（掛在年度底下）

- `activities`：slug、kind（`cards`｜`feature`）、title、subtitle、intro（多段）、image、people_heading、link_label、show_course（bool）、detail_sections（例：`["bio","summary","outline"]`）、中英各一份。
- `activity_people`：activity_id、venue_id、sort_order、stake、ward、name、photo_url、photo_focus、course_title、bio、summary、outline（陣列）。
- `activity_venue_pages`（範本 C）：activity_id、venue_id、show_title、poster_url、inspiration（多段）。
- `activity_team`（範本 C）：venue_page_id、sort_order、role、name、photo_url、bio。
- 課程名稱與教堂，能從 `courses` 帶的就帶，不要重複輸入（廠商檔為準）。
- 文字與人物都要能從後台修改；英文版完整對應中文版。

## 待確認

- 貴賓、傳教士、靜態展示、靈性課程的教堂分組是依支聯會所在地推測。
- 樣本人名與單位部分從截圖辨識，正式資料以後台輸入為準。
- 「大會場地」「致謝」兩頁尚未設計。
