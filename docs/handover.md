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

報名系統的正式網址是 `https://register.taiwanwomensconference.org`，舊網址 `women-conference-tw.vercel.app` 仍然可以用。`https://www.taiwanwomensconference.org`（和沒有 www 的網址）是大會網站，用 Google Sites 做、由其他人負責，**不是這個 repo**（ADR 0012）。

Vercel 的 Production 環境變數 `SITE_URL` 要設成正式網址（`https://register.taiwanwomensconference.org`），報名確認信裡「查詢我的報名」的連結用它。

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

都在後台的「年度管理」做，只有總管理員看得到，不用碰資料庫。「場地與課程」「報名時間」只能編輯目前年度，所以新年度要先設為目前年度才能準備內容；公告上線時間填晚一點，之前報名首頁只顯示「即將公布」，這段時間慢慢準備。大會介紹、大會程序、籌備委員會都在大會網站（www，Google Sites），由其他人負責，這裡不用準備。

### 平常：複製去年

- [ ] 「複製去年建立新年度」選要複製的年度（通常是去年），填新年度與大會日期，按「複製建立新年度」。場地、場次、課程（含講師與教室）、成對的課程、午餐、大會開始與結束時間會帶過來；報名不會。以前首頁、大會特色、大會程序、籌備委員會的內容不會帶過來（這些已經移到大會網站），舊年度的資料照樣留在資料庫裡
- [ ] 在「所有年度」找到新年度，按「設為目前年度…」，填公告上線、報名開放、報名截止三個時間，按確定。去年變成舊年度，資料都保留，報名名單可以選年度查看
- [ ] 公告上線前，到「場地與課程」把場地、場次、課程、午餐改成新年度的；到「報名時間」確認大會日期與開始、結束時間（顯示在報名首頁），以及公告上線、報名開放、報名截止三個時間。場地與課程要在報名開放前準備好，之後不能新增或刪除
- [ ] 準備好之後，按「報名時間」或「場地與課程」頁面上的「預覽報名首頁」「預覽報名表」，看看訪客會看到的樣子（只有登入的工作人員看得到，預覽報名表不能送出）。報名首頁的順序是大會名稱、日期與時間 → 報名狀態 → 我要報名、幫家人或朋友報名、查詢或修改報名 → 大會網站連結（ADR 0012）；用手機看一次，確認報名狀態與「我要報名」不用往下捲就看得到

### 第一次：還沒有任何年度時

網站剛建好、或資料庫重新開始，「年度管理」裡一個年度都沒有時，複製的表單會換成「建立第一個年度」：

- [ ] 填年度（西元年，例如 2027）與大會日期，按「建立第一個年度」。建出來的是空白年度：沒有場地、課程
- [ ] 在「所有年度」找到它，按「設為目前年度…」，填公告上線、報名開放、報名截止三個時間，按確定。空白年度什麼都還沒有，報名開放要留足準備時間：時間一到就不能再新增或刪除場地、場次、課程（之後在「報名時間」可以改時間）
- [ ] 公告上線前，到「場地與課程」新增場地、場次、課程、午餐，到「報名時間」填大會開始與結束時間，再用「預覽報名首頁」「預覽報名表」看看訪客會看到的樣子
- [ ] 隔年開始就照上面「平常：複製去年」做

## 大會前：名牌與名單 CSV

後台「報名名單」最上面有下載 CSV 的按鈕，下載的是上面選的那一年、自己範圍內的資料，用 Excel 直接打開中文不會亂碼：

- 名牌 CSV（總管理員、課務組）：給廠商印名牌。正面姓名、身分類別；背面場地、每個場次的名稱、課程與教室、午餐、手冊。只有有效報名，依場地、支聯會、支會排序。教室是下載當下最新的，換過教室要重新下載再給廠商
- 範圍內名單 CSV（課務組、報報組）：自己看得到的報名，已取消的也列出，「狀態」欄標示
- 完整名單 CSV、支聯會簡表 CSV（只有總管理員）：完整名單另有 Email、LINE ID、報名語言、服務意願；簡表是每個支會在各場地的有效報名人數，加上小計與總計

這些 CSV 和大會結束後的年度 Excel 不同：不記下載紀錄，報名期間隨時可以下載。

## 大會結束後：下載 Excel 名單、清除個資

大會日期翌日台北時間 00:00 之後才能做，只有總管理員看得到。什麼時候做由總管理員決定，系統不會自動清除（[ADR 0008](adr/0008-export-excel-then-clear-personal-data-after-conference.md)）。清除後不能還原。

- [ ] 後台「年度管理」→ 在那一年的卡片按「大會已結束：下載 Excel 與清除個資」
- [ ] 按「下載年度 Excel」。工作表「名單」一列一位有效報名的姐妹，「場次對照」是各場地各場次的名稱與時間
- [ ] 把 Excel 存到只有籌備委員會能打開的雲端資料夾（不能放進 GitHub repo），打開確認姓名、課程都在
- [ ] 回到同一頁，在剛才那一筆下載紀錄勾「這份 Excel 已存好、打得開」，核對「Excel 內的有效報名」「將清除個資的報名（含已取消）」兩個筆數，按「清除 ○○ 年的個資」
- [ ] 下載之後有人新增、修改或取消報名，那一筆會標成不能用來清除，請重新下載、用新的那一份確認

清除後名單只顯示「（個資已清除）」，統計照樣可以看；需要姓名的工作只能靠那份 Excel。

## 第一次部署怎麼做的

正式環境（Vercel、正式 Supabase、repo 改 public）是用 [`scripts/setup-production.sh`](../scripts/setup-production.sh) 這個引導腳本設定的。萬一要重建正式環境，可以再跑一次：

```bash
bash scripts/setup-production.sh
```

## 換網站網域時

例如 2026 年 11 月從 `www.taiwanwomensconference.org` 換成 `register.taiwanwomensconference.org`（www 交給大會網站，#124）：

- [ ] 在 Vercel 專案的 Settings → Domains 按 Add Domain 加上新網域，Environment 選 Production、不要設轉址。Vercel 會給一筆 CNAME 紀錄
- [ ] Cloudflare → DNS → Records 照 Vercel 給的值加 CNAME（Name 填子網域，例如 `register`），Proxy status 選 **DNS only**。回 Vercel 按 Refresh，等它變成 Valid Configuration，再打開新網址的 `/register`、`/lookup`、`/staff/login`，確認都有 HTTPS
- [ ] Supabase 後台 → Authentication → URL Configuration，把 **Site URL** 改成新網域（例如 `https://register.taiwanwomensconference.org`，最後不加 `/`），按 Save changes。後台登入信的連結用這個網址，沒改的話工作人員點信裡的連結會回到舊網址。Redirect URLs 如果列了舊網址，也加上新網域
- [ ] 用新網域到 `/staff/login` 寄一次登入信，確認信裡的連結是新網域、點了能登入
- [ ] Vercel → Settings → Environment Variables，把 `SITE_URL` 改成新網域（只勾 Production），再到 Deployments 把最新的 Production 部署 Redeploy，環境變數才會生效
- [ ] 有場地與課程之後，後台重寄一封確認信給自己的報名，確認「查詢我的報名」的連結是新網域
- [ ] 舊網域要交給別人的，等對方準備好再從 Vercel 的 Domains 移除；在那之前不要動 Cloudflare 上舊網域的紀錄。Cloudflare 上 `send`、`rsend`、`_dmarc`、`resend._domainkey` 是寄信用的，換網站網域時都不要動
- [ ] 後台首頁「分享報名網站到 LINE 群組」複製新網址，通知工作人員和支會群組

登入信範本裡寫的是 `{{ .SiteURL }}`，不用改；程式也不用改。

## 出問題時

- **工作人員收不到後台登入信**：先看垃圾郵件匣。再到 Resend 後台 Logs 看有沒有這封信、寄送結果是什麼；完全沒有紀錄的話，到 Supabase → Authentication → Emails → SMTP Settings 確認還開著自訂 SMTP，並到 Resend 後台 API Keys 確認 `supabase-login` 這組 key 還在（被刪掉或換過的話，產生一組新的、只能寄信的 key，貼到 SMTP Settings 的 Password，並更新 Google Sheet）。Supabase 後台 Logs → Auth 可以看到寄信失敗的原因。

- **查詢報名一直顯示「系統暫時出了問題」**：看 Vercel 的環境變數 `SUPABASE_SECRET_KEY` 還在不在、是不是 Supabase 後台現在的 Secret key（換過 key 要一起更新，再重新部署）。
- **報名者收不到確認信**：先請她看垃圾郵件匣。Supabase 後台 Table Editor → `email_logs` 看那一筆的寄送結果（`status`、`error`）；錯誤是 `RESEND_API_KEY or EMAIL_FROM not set` 就是 Vercel 少了這兩個環境變數。Resend 後台 Logs 也看得到每封信的狀態。
- **確認信裡「查詢我的報名」的連結是錯的網域**：看 Vercel 的 Production 環境變數 `SITE_URL` 是不是報名系統的正式網址，改了要 Redeploy。
- **報名首頁打不開或顯示錯誤**：先看 Supabase 專案是不是被暫停了（後台會有 Restore 按鈕），再看 Vercel 最近一次部署有沒有失敗。
- **出現「正式資料庫查詢失敗：Supabase 專案可能已暫停」的 issue**：防暫停 workflow 查詢失敗時會自動開這張 issue。到 Supabase 後台恢復專案，再到 Actions 分頁手動重跑「Keep Supabase awake」，成功後關閉 issue。
  不靠 GitHub 的失敗通知信，因為那只會寄給建立 workflow、最後修改 cron 排程，或最後重新啟用 workflow 的人，換屆後不一定是現任維護者。

