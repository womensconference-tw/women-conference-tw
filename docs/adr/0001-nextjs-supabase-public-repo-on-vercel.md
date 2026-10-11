# Next.js + Supabase + Resend，repo 公開並部署在 Vercel

本專案由一位義工開發，之後要交接，經費只夠網域和一個月的 Resend，所以選了免費方案最完整、交接最好懂的組合：Next.js、Supabase、Resend、Vercel。Vercel Hobby 不能部署組織名下的私人 repo，因此 `womensconference-tw/women-conference-tw` 改為 public。程式碼裡本來就不放任何秘密，公開的風險可以接受。

## Considered Options

- 改用 Cloudflare Workers + OpenNext：可以保持私人 repo，但部署方式較冷門，交接成本高。
- 付費 Vercel Pro：超出公費範圍。

## Consequences

- 所有秘密只能放在 Vercel／Supabase 的環境變數，絕不能 commit。
- Supabase 免費專案過去一週資料庫活動不足就會暫停（官方說法是通常每天幾次請求就夠），淡季時首頁會壞。用 GitHub Actions 每 6 小時查詢一次資料庫，讓專案保持啟用；查詢失敗時自動開 issue。
- Resend 免費方案每天上限 100 封，公費的那一個月付費方案要排在報名開放的月份。
