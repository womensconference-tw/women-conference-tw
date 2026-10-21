# 後台文字頁用 Milkdown 所見即所得編輯，存檔仍是 Markdown

籌備委員會的三個文字頁（大會簡介、主席的話、備忘錄）與大會特色介紹內容，後台改用 Milkdown 的所見即所得編輯器：看到的是排好的樣子，工具列有標題、粗體、編號清單、項目清單、往內縮／往外移一層、表格（含新增與刪除列、欄）、連結。存檔格式維持 Markdown，公開頁面（`src/components/markdown.tsx`）、安全規則與 `committee_texts.markdown` 都不用動（2026-10-21 決定，#88）。

#75 的做法是在一般文字框上方放按鈕，按了插入 Markdown 符號。後台使用者多是不熟電腦的姐妹，看到 `**`、縮排四格的 `1.` 容易困惑；按鈕還要自己處理各種 Markdown 寫法，Codex 審查四輪仍不斷找到少見的情況（PR #79）。所見即所得編輯器從根本解決這兩點。

選 Milkdown，是因為它讀寫 Markdown 用的是 remark，和公開頁面同一套解析器（含 remark-gfm），編輯器怎麼理解一段 Markdown，公開頁面就怎麼顯示。表格、多層清單、粗體、連結存檔後再打開格式不變，有測試（`src/app/staff/rich-text-setup.test.ts`）。

## Considered Options

- **Tiptap（加 @tiptap/markdown）**：社群最大、文件最完整，同樣以 ProseMirror 為核心，表格與手機編輯的能力和 Milkdown 相當。但 Markdown 擴充用的是 marked，和公開頁面的 remark 是不同的解析器，少見寫法兩邊理解不同時，編輯器看到的和公開頁面會不一樣。
- **Lexical**：Meta 維護、更新頻繁。Markdown 轉換器內建的不含表格，要自己寫表格與多層清單的轉換，正是這次想避開的工作。
- **存 HTML 或編輯器的 JSON**：格式最不會跑掉，但安全檢查（只接受 http(s) 連結、不能夾帶 HTML）要整個重做，舊內容也要轉換，先不考慮。

三個套件都支援 React 19，近一個月內都有新版本。

## Consequences

- 編輯器只載入支援的格式。從 Word、Google 文件、LINE 貼上時，瀏覽器給的 HTML 只留下這些格式；貼上 Markdown 文字或載入存檔內容時，`remarkRichText`（`src/lib/rich-text.ts`）把引言、程式碼、斜體、刪除線、圖片、HTML 等改成文字。非 http(s) 的連結在任何時候進到編輯器都會拿掉，只留文字。存檔內容不會有 HTML。
- 不載入 Milkdown 的「保留空行」外掛（它會把空白段落存成 `<br />`），也不載入依清單項目改回編號清單的外掛（它會讓「項目清單」按鈕無效）。升級 Milkdown 時要再跑一次編輯器的測試。
- 換行存成標準的 `\` 加換行；公開頁面每個換行都保留（remark-breaks），舊內容的單一換行載入後照樣換行。清單一律存成緊密清單，項目之間不空行。
- 改版前存的純文字（`markdown = false`）載入時先轉成照樣顯示的 Markdown：空一行分段、換行保留、`*`、`#` 跳脫成文字，存檔後在公開頁面看起來一樣。
- 編輯器約 140 KB（gzip），只在後台的籌備委員會與首頁內容頁面載入，不影響前台。
- 原本的 Markdown 樣式按鈕（`markdown-format.ts`、`markdown-editor.tsx`）移除。會議記錄的備註維持純文字。
