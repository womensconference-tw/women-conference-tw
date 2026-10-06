# 所有服務掛在官方 Gmail 與官方 GitHub 帳號下，交接時只換這兩個帳號

維護者會換人，所以每個第三方服務都用官方 Gmail（`womensconferencetw@gmail.com`）註冊，或用「以 Google／GitHub 登入」連到官方 Gmail 或官方 GitHub 帳號 `womensconferencetw`。Vercel 與 Supabase 一律用官方 GitHub 帳號登入，不用維護者個人帳號。交接時只要把官方 Gmail 交給下一任，下面的服務就跟著移轉。

## Consequences

- 帳號清單、備用碼等機密記在官方 Gmail 裡的 Google Sheet，絕不放進公開的 repo。repo 裡的 `docs/handover.md` 只寫每年換屆的操作步驟，並指向那份 Sheet。
- 交接 Gmail 時，下一任用備用碼登入後，要重設驗證器、救援電話、救援 Email。
- GitHub 組織的永久 Owner 是官方帳號；交接時邀請下一任的個人帳號成為 Owner，前任再退出。
