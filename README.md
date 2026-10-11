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

啟動後執行 `npx supabase status`，把 `API_URL` 與 `PUBLISHABLE_KEY` 填進 `.env.local`：

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
```

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
