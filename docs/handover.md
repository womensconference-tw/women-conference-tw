# 交接手冊

維護者換人時照這份做。依 [ADR 0007](adr/0007-handover-through-official-accounts.md)，所有服務都掛在官方帳號下，交接時只換官方 Gmail 與官方 GitHub 帳號。

> **帳號、密碼、備用碼、資料庫密碼等機密，全部記在官方 Gmail（`womensconferencetw@gmail.com`）雲端硬碟裡的 Google Sheet「帳號與機密」。**
> 這個 repo 是公開的，**絕對不要**把任何機密寫進這份文件或 commit 到 repo。

## 服務一覽

| 服務 | 用途 | 登入方式 | 機密記在 |
| --- | --- | --- | --- |
| 官方 Gmail | 所有服務的根帳號 | 帳密＋驗證器 | Google Sheet |
| GitHub `womensconferencetw` | 組織 `womensconference-tw` 的永久 Owner | 以官方 Gmail 註冊 | Google Sheet |
| Vercel | 部署網站 | 以官方 GitHub 帳號登入 | 不需要（環境變數在 Vercel 後台；`SUPABASE_SECRET_KEY` 可以從 Supabase 後台再查） |
| Supabase | 正式資料庫 | 以官方 GitHub 帳號登入 | 資料庫密碼在 Google Sheet |
| GitHub Actions secrets | 防暫停 workflow 用的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` | repo Settings → Secrets | 不需要（兩個值都可以從 Supabase 後台再查） |
| Cloudflare | 網域 `taiwanwomensconference.org` 的註冊與 DNS | 以官方 GitHub 帳號登入 | Google Sheet（網域到期日、續約負責人、付款經費也記在這裡） |
| Resend | 寄報名確認信，也替 Supabase 寄後台登入信，寄件人都是 `noreply@taiwanwomensconference.org` | 以官方 GitHub 帳號登入 | 兩組 API key 都在 Google Sheet：網站用的 `RESEND_API_KEY`（Vercel 環境變數 `RESEND_API_KEY`、`EMAIL_FROM`），以及 Supabase 寄登入信用的 `supabase-login`（Supabase → Authentication → Emails → SMTP Settings 的 Password） |

正式網址是 `https://www.taiwanwomensconference.org`，沒有 www 的網址會自動轉過去。舊網址 `women-conference-tw.vercel.app` 仍然可以用。

Cloudflare 的 DNS 紀錄（Vercel 與 Resend 驗證用的）全部保持 **DNS only**（灰色雲朵），不要開 proxy（橘色雲朵），否則網站憑證或寄信驗證可能會出問題。

## 換屆步驟

### 1. 移交官方 Gmail

- [ ] 前任把 Google Sheet 的位置告訴下一任
- [ ] 下一任用備用碼登入官方 Gmail
- [ ] 重設驗證器、救援電話、救援 Email，改成下一任自己的
- [ ] 產生新的備用碼，更新到 Google Sheet

### 2. 移交 GitHub 組織

- [ ] 用官方 GitHub 帳號邀請下一任的個人帳號成為組織 Owner
- [ ] 下一任接受邀請
- [ ] 前任退出組織

### 3. 移交 Cloudflare 與 Resend

兩個都以官方 GitHub 帳號登入，移交了官方 GitHub 帳號就跟著換手，只要確認：

- [ ] 用官方 GitHub 帳號登入 Cloudflare，確認網域還在、開著自動續約；看 Google Sheet 上的到期日，確認續約的付款方式還有效、續約負責人和付款經費改成這一屆的
- [ ] 用官方 GitHub 帳號登入 Resend，確認網域還是 Verified

### 4. 確認服務都還正常

- [ ] 用官方 GitHub 帳號登入 Vercel，確認專案與環境變數都在
- [ ] 用官方 GitHub 帳號登入 Supabase，確認正式專案沒有暫停
- [ ] 用官方 Gmail 到 `/staff/login` 收信登入後台，確認還是總管理員（她是最後一道保險：其他總管理員都聯絡不上時，靠她重新新增帳號）
- [ ] 到 repo 的 Actions 分頁，確認「Keep Supabase awake」最近幾次都成功、而且沒有被停用
- [ ] 下一任在 repo 頁面右上角點「Watch」→「All Activity」（或至少勾選 Issues），才收得到防暫停失敗時自動開的 issue

## 每年開新年度

都在後台的「年度管理」做，只有總管理員看得到，不用碰資料庫。「場地與課程」「首頁內容」只能編輯目前年度，所以新年度要先設為目前年度才能準備內容；公告上線時間填晚一點，之前首頁只顯示「即將公布」，這段時間慢慢準備。

### 平常：複製去年

- [ ] 「複製去年建立新年度」選要複製的年度（通常是去年），填新年度與大會日期，按「複製建立新年度」。場地、場次、課程、午餐、首頁內容、常見問題、籌備委員會的文字與連結都會帶過來，報名不會
- [ ] 在「所有年度」找到新年度，按「設為目前年度…」，填公告上線、報名開放、報名截止三個時間，按確定。去年變成舊年度，資料都保留，報名名單可以選年度查看
- [ ] 公告上線前，到「場地與課程」「首頁內容」把內容改成新年度的。場地與課程要在報名開放前準備好，之後不能新增或刪除
- [ ] 準備好之後，按「首頁內容」或「場地與課程」頁面上的「預覽首頁」「預覽報名表」，看看訪客會看到的樣子（只有登入的工作人員看得到，預覽報名表不能送出）
- [ ] 到「籌備委員會」更新文字頁、重要連結，輸入新一屆的工作團隊與籌備委員名單。新年度設為目前年度後，公開頁面就看得到；按「複製網址」把公開網址傳給工作團隊與籌備委員（他們不用後台帳號）

### 第一次：還沒有任何年度時

網站剛建好、或資料庫重新開始，「年度管理」裡一個年度都沒有時，複製的表單會換成「建立第一個年度」：

- [ ] 填年度（西元年，例如 2027）與大會日期，按「建立第一個年度」。建出來的是空白年度：沒有場地、課程、首頁內容
- [ ] 在「所有年度」找到它，按「設為目前年度…」，填公告上線、報名開放、報名截止三個時間，按確定。空白年度什麼都還沒有，報名開放要留足準備時間：時間一到就不能再新增或刪除場地、場次、課程（之後在「首頁內容」可以改時間）
- [ ] 公告上線前，到「場地與課程」新增場地、場次、課程、午餐，到「首頁內容」填大會資訊與常見問題，再用「預覽首頁」「預覽報名表」看看訪客會看到的樣子
- [ ] 隔年開始就照上面「平常：複製去年」做

## 第一次部署怎麼做的

正式環境（Vercel、正式 Supabase、repo 改 public）是用 [`scripts/setup-production.sh`](../scripts/setup-production.sh) 這個引導腳本設定的。萬一要重建正式環境，可以再跑一次：

```bash
bash scripts/setup-production.sh
```

## 換網站網域時

例如 2026 年從 `women-conference-tw.vercel.app` 換成 `www.taiwanwomensconference.org`：

- [ ] 在 Vercel 專案的 Settings → Domains 加上新網域
- [ ] Supabase 後台 → Authentication → URL Configuration，把 **Site URL** 改成新網域（例如 `https://www.taiwanwomensconference.org`），按 Save changes。後台登入信的連結用這個網址，沒改的話工作人員點信裡的連結會回到舊網址。Redirect URLs 如果列了舊網址，也加上新網域
- [ ] 用新網域到 `/staff/login` 寄一次登入信，確認信裡的連結是新網域、點了能登入

登入信範本裡寫的是 `{{ .SiteURL }}`，不用改；程式也不用改。

## 出問題時

- **工作人員收不到後台登入信**：先看垃圾郵件匣。再到 Resend 後台 Logs 看有沒有這封信、寄送結果是什麼；完全沒有紀錄的話，到 Supabase → Authentication → Emails → SMTP Settings 確認還開著自訂 SMTP，並到 Resend 後台 API Keys 確認 `supabase-login` 這組 key 還在（被刪掉或換過的話，產生一組新的、只能寄信的 key，貼到 SMTP Settings 的 Password，並更新 Google Sheet）。Supabase 後台 Logs → Auth 可以看到寄信失敗的原因。

- **查詢報名一直顯示「系統暫時出了問題」**：看 Vercel 的環境變數 `SUPABASE_SECRET_KEY` 還在不在、是不是 Supabase 後台現在的 Secret key（換過 key 要一起更新，再重新部署）。
- **報名者收不到確認信**：先請她看垃圾郵件匣。Supabase 後台 Table Editor → `email_logs` 看那一筆的寄送結果（`status`、`error`）；錯誤是 `RESEND_API_KEY or EMAIL_FROM not set` 就是 Vercel 少了這兩個環境變數。Resend 後台 Logs 也看得到每封信的狀態。
- **首頁打不開或顯示錯誤**：先看 Supabase 專案是不是被暫停了（後台會有 Restore 按鈕），再看 Vercel 最近一次部署有沒有失敗。
- **出現「正式資料庫查詢失敗：Supabase 專案可能已暫停」的 issue**：防暫停 workflow 查詢失敗時會自動開這張 issue。到 Supabase 後台恢復專案，再到 Actions 分頁手動重跑「Keep Supabase awake」，成功後關閉 issue。
  不靠 GitHub 的失敗通知信，因為那只會寄給建立 workflow、最後修改 cron 排程，或最後重新啟用 workflow 的人，換屆後不一定是現任維護者。

<!-- TODO: 匯出與清除的實際操作畫面做好後，補上每年的步驟（ADR 0008）：大會結束後下載 Excel 名單、存到籌備委員會的雲端、確認打得開，再到後台清除個資 -->
