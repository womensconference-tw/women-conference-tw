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
| 官方 Gmail 應用程式密碼 | Supabase 用官方 Gmail 寄後台登入信（Authentication → Emails → SMTP Settings） | 在官方 Gmail 的 [應用程式密碼](https://myaccount.google.com/apppasswords) 頁面產生 | Google Sheet |
| GitHub Actions secrets | 防暫停 workflow 用的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` | repo Settings → Secrets | 不需要（兩個值都可以從 Supabase 後台再查） |

<!-- TODO: 之後加上 Resend、網域註冊商 -->

## 換屆步驟

### 1. 移交官方 Gmail

- [ ] 前任把 Google Sheet 的位置告訴下一任
- [ ] 下一任用備用碼登入官方 Gmail
- [ ] 重設驗證器、救援電話、救援 Email，改成下一任自己的
- [ ] 如果改了官方 Gmail 的密碼：應用程式密碼會一起失效，後台登入信就寄不出去。到 [應用程式密碼](https://myaccount.google.com/apppasswords) 刪掉舊的、產生新的，貼到 Supabase → Authentication → Emails → SMTP Settings 的 Password，並更新 Google Sheet
- [ ] 產生新的備用碼，更新到 Google Sheet

### 2. 移交 GitHub 組織

- [ ] 用官方 GitHub 帳號邀請下一任的個人帳號成為組織 Owner
- [ ] 下一任接受邀請
- [ ] 前任退出組織

### 3. 確認服務都還正常

- [ ] 用官方 GitHub 帳號登入 Vercel，確認專案與環境變數都在
- [ ] 用官方 GitHub 帳號登入 Supabase，確認正式專案沒有暫停
- [ ] 用官方 Gmail 到 `/staff/login` 收信登入後台，確認還是總管理員（她是最後一道保險：其他總管理員都聯絡不上時，靠她重新新增帳號）
- [ ] 到 repo 的 Actions 分頁，確認「Keep Supabase awake」最近幾次都成功、而且沒有被停用
- [ ] 下一任在 repo 頁面右上角點「Watch」→「All Activity」（或至少勾選 Issues），才收得到防暫停失敗時自動開的 issue

<!-- TODO: 補上每年開新年度要做的事（複製去年年度、填時程時間點等），等後台功能完成後再寫 -->

## 第一次部署怎麼做的

正式環境（Vercel、正式 Supabase、repo 改 public）是用 [`scripts/setup-production.sh`](../scripts/setup-production.sh) 這個引導腳本設定的。萬一要重建正式環境，可以再跑一次：

```bash
bash scripts/setup-production.sh
```

## 換網站網域時

例如從 `women-conference-tw.vercel.app` 換成正式網域：

- [ ] 在 Vercel 專案的 Settings → Domains 加上新網域
- [ ] Supabase 後台 → Authentication → URL Configuration，把 **Site URL** 改成新網域（例如 `https://womensconference.tw`），按 Save changes。後台登入信的連結用這個網址，沒改的話工作人員點信裡的連結會回到舊網址
- [ ] 用新網域到 `/staff/login` 寄一次登入信，確認信裡的連結是新網域、點了能登入

登入信範本裡寫的是 `{{ .SiteURL }}`，不用改；程式也不用改。

## 出問題時

- **工作人員收不到後台登入信**：先看垃圾郵件匣。再到 Supabase → Authentication → Emails → SMTP Settings 確認還開著自訂 SMTP；官方 Gmail 改過密碼的話，應用程式密碼已經失效，要重新產生一組貼上（見上面「移交官方 Gmail」）。Supabase 後台 Logs → Auth 可以看到寄信失敗的原因。

- **查詢報名一直顯示「系統暫時出了問題」**：看 Vercel 的環境變數 `SUPABASE_SECRET_KEY` 還在不在、是不是 Supabase 後台現在的 Secret key（換過 key 要一起更新，再重新部署）。
- **首頁打不開或顯示錯誤**：先看 Supabase 專案是不是被暫停了（後台會有 Restore 按鈕），再看 Vercel 最近一次部署有沒有失敗。
- **出現「正式資料庫查詢失敗：Supabase 專案可能已暫停」的 issue**：防暫停 workflow 查詢失敗時會自動開這張 issue。到 Supabase 後台恢復專案，再到 Actions 分頁手動重跑「Keep Supabase awake」，成功後關閉 issue。
  不靠 GitHub 的失敗通知信，因為那只會寄給建立 workflow、最後修改 cron 排程，或最後重新啟用 workflow 的人，換屆後不一定是現任維護者。

<!-- TODO: 匯出與清除的實際操作畫面做好後，補上每年的步驟（ADR 0008）：大會結束後下載 Excel 名單、存到籌備委員會的雲端、確認打得開，再到後台清除個資 -->
