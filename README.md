# 台灣姐妹大會

耶穌基督後期聖徒教會「台灣姐妹大會」的官方網站與報名系統。用詞以 [`GLOSSARY.md`](GLOSSARY.md) 為準，架構決定見 [`docs/adr/`](docs/adr/)。

技術：Next.js（App Router）＋ Supabase ＋ Vercel。

## 需要先安裝

- **Node.js 22**：repo 有 `.nvmrc`，用 nvm 的話執行 `nvm use`（第一次是 `nvm install`）。
- **Docker Desktop**：本機 Supabase 跑在 Docker 裡，啟動前先打開 Docker Desktop。

然後安裝套件：

```bash
npm install
```

## 啟動本機環境

```bash
npm run db:start
```

這個指令會啟動本機 Supabase，套用 `supabase/migrations/` 裡的所有 migration，並載入 `supabase/seed.sql` 的假資料（一個 2027 年的目前年度）。第一次執行要下載 Docker 映像檔，會比較久。

啟動後執行 `npx supabase status`，把 `API_URL`、`PUBLISHABLE_KEY` 與 `SECRET_KEY` 填進 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
SUPABASE_SECRET_KEY=<SECRET_KEY>
```

`SUPABASE_SECRET_KEY` 只在網站伺服器上用來查詢、修改、取消報名（[ADR 0009](docs/adr/0009-lookup-change-cancel-through-server-only.md)），名稱不能加 `NEXT_PUBLIC_`。

接著啟動網站：

```bash
npm run dev
```

打開 <http://localhost:3000>。

本機 Supabase 用 553xx 埠號（API 55321、資料庫 55322、Studio <http://127.0.0.1:55323>），避免跟其他本機 Supabase 專案的預設埠號衝突。

### 看首頁的不同狀態

首頁依目前年度的三個時程時間點（公告上線、報名開放、報名截止）自動切換：公告上線前／報名前／報名中／已截止。要看其他狀態，改 `supabase/seed.sql` 裡的時間點，再執行：

```bash
npm run db:reset
```

`db:reset` 會清空本機資料庫，重新套用 migration 與 seed。

### 後台登入（`/staff`）

後台在 <http://localhost:3000/staff/login>，用 Email 收登入連結，不設密碼（[ADR 0004](docs/adr/0004-staff-roles-scoped-by-venue-and-stake.md)）。本機不會真的寄信，信件在 Mailpit：<http://127.0.0.1:55324>。

本機也要先照下面「建立第一位總管理員」做一次（在 Studio <http://127.0.0.1:55323> 操作）。`db:reset` 和跑測試會清掉帳號，之後要再建一次。

## 建立第一位總管理員

自行註冊是關閉的，工作人員帳號只能由總管理員在後台「工作人員帳號」新增。第一位總管理員要直接在 Supabase 後台建立。正式環境的第一位總管理員是官方 Gmail `womensconferencetw@gmail.com`（2026-10-15 建立），換屆時跟著官方 Gmail 交接；萬一其他總管理員都聯絡不上，用官方 Gmail 登入後台就能重新新增帳號。

1. Supabase 後台 → **Authentication** → **Users** → **Add user** → **Create new user**：填她的 Email，勾選 **Auto confirm user?**。
   **User Password** 一定要填：亂打一串至少 30 個字的密碼，填完就丟掉，不用記也不用存。後台一律用 Email 收登入連結，用不到這個密碼；沒人知道它，就沒人能用它登入。
2. **SQL Editor** 執行（把 Email 換成剛剛那個）：

   ```sql
   insert into public.staff_members (user_id, role)
   select id, 'admin' from auth.users where email = 'her-email@example.com';
   ```

3. 她到 `/staff/login` 填 Email，收信點連結就能登入。之後的工作人員（包括其他總管理員）都在後台新增。

系統至少會留一位總管理員，最後一位不能被移除或改成其他角色。

### 正式 Supabase 的登入設定

本機的設定在 `supabase/config.toml`，正式環境要在 Supabase 後台 **Authentication** 設一樣的：

- **Sign In / Providers**：關閉 **Allow new users to sign up**（Email provider 本身保持開啟，否則連登入都不行）。
- **URL Configuration**：**Site URL** 填正式網站網址（例如 `https://women-conference-tw.vercel.app`），登入信的連結用這個網址。
- **Emails** → **SMTP Settings**：開啟 **Enable custom SMTP**，用官方 Gmail 寄信（Host `smtp.gmail.com`、Port `587`、Sender email 與 Username 都是官方 Gmail、Sender name「台灣姐妹大會」，Password 是官方 Gmail 的「應用程式密碼」，記在 Google Sheet）。一定要設：Supabase 內建的寄信只寄給 Supabase 組織成員，其他工作人員收不到登入信，也不能改信件內容。
- **Emails** → **Templates** → **Magic link or OTP**：主旨填「台灣姐妹大會後台登入連結」，內容（Source）貼上 [`supabase/templates/magic_link.html`](supabase/templates/magic_link.html)。連結帶 `token_hash` 到 `/staff/auth/confirm`，在電腦上要求、手機上點連結也能登入。

### 新增 migration

```bash
npx supabase migration new <名稱>
```

寫好後執行 `npm run db:reset` 套用。

### 停止

```bash
npm run db:stop
```

## 測試

```bash
npm test          # 跑一次
npm run test:watch
```

測試對真實的本機 Supabase 執行，不 mock 資料庫，所以要先 `npm run db:start`。測試會自動從 `supabase status` 讀取網址與金鑰，不需要另外設定環境變數。

**注意：每次跑測試前（包括 `test:watch` 每次重跑前）會自動執行 `supabase db reset`**，讓測試一定從 migration＋seed 的乾淨狀態開始，上次中斷留下的資料也會清掉。所以你在本機資料庫手動加的資料，跑測試後會不見；重設大約要 30 秒。

測試只透過公開的介面（例如 `src/lib/conference.ts` 的 `getCurrentConference`）檢查外部行為，並以前台訪客的身分（publishable key，受 RLS 限制）呼叫；測試資料用 secret key 準備，跑完會還原。

## 部署與交接

正式環境部署在 Vercel，資料庫是正式 Supabase 專案，環境變數只放在 Vercel／Supabase 後台。第一次設定（或重建）正式環境時跑引導腳本：

```bash
bash scripts/setup-production.sh
```

`.github/workflows/keep-supabase-awake.yml` 每 6 小時查詢一次正式資料庫，避免免費專案因活動不足被暫停；查詢失敗會自動開 issue。換屆步驟見 [`docs/handover.md`](docs/handover.md)。
