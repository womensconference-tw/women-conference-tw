"use client";

import "@milkdown/kit/prose/view/style/prosemirror.css";
import type { Editor } from "@milkdown/kit/core";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import type { Command, EditorState } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useEffect, useId, useRef, useState } from "react";
import { afterLoading, LoadingOverlay } from "@/components/loading-overlay";
import { buttonVariants } from "@/components/ui/button";
import {
  checkHighlightImage,
  HIGHLIGHT_IMAGE_BUCKET,
  highlightImagePath,
  type HighlightImageError,
} from "@/lib/highlight-images";
import { plainTextToMarkdown } from "@/lib/rich-text";
import { SAFE_URL } from "@/lib/safe-url";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  currentAlignment,
  currentLink,
  currentList,
  deleteTableColumn,
  deleteTableRow,
  insertImageBlock,
  insertTable,
  selectedImage,
  setAlignment,
  setImageSize,
  setLink,
  toggleHeading,
  toggleList,
} from "./rich-text-commands";
import { createRichTextEditor, editorMarkdown, normalizeMarkdown, replaceMarkdown } from "./rich-text-setup";
import { alertClass, inputClass, noticeClass } from "./ui";

type Tool = { label: string; command: (state: EditorState) => Command; pressed?: (state: EditorState) => boolean };

const TOOLS: Tool[] = [
  {
    label: "標題",
    command: () => toggleHeading,
    pressed: (state) => state.selection.$from.parent.type.name === "heading",
  },
  {
    label: "粗體",
    command: (state) => toggleMark(state.schema.marks.strong),
    pressed: (state) => {
      const { strong } = state.schema.marks;
      const { from, to, empty, $from } = state.selection;
      return empty ? Boolean(strong.isInSet(state.storedMarks ?? $from.marks())) : state.doc.rangeHasMark(from, to, strong);
    },
  },
  {
    label: "編號清單",
    command: (state) => toggleList(state.schema.nodes.ordered_list),
    pressed: (state) => currentList(state)?.node.type.name === "ordered_list",
  },
  {
    label: "項目清單",
    command: (state) => toggleList(state.schema.nodes.bullet_list),
    pressed: (state) => currentList(state)?.node.type.name === "bullet_list",
  },
  { label: "往內縮一層", command: (state) => sinkListItem(state.schema.nodes.list_item) },
  { label: "往外移一層", command: (state) => liftListItem(state.schema.nodes.list_item) },
  { label: "表格", command: () => insertTable },
  // 對齊（#102）：選到的段落與標題；圖片跟著它那一段。清單、表格裡的不能對齊。
  { label: "靠左", command: () => setAlignment(""), pressed: (state) => currentAlignment(state) === "" },
  { label: "置中", command: () => setAlignment("center"), pressed: (state) => currentAlignment(state) === "center" },
  { label: "靠右", command: () => setAlignment("right"), pressed: (state) => currentAlignment(state) === "right" },
];

/** 點一下圖片後出現（#102）：內容寬度的 1/3、1/2、2/3、全部。 */
const IMAGE_TOOLS: Tool[] = (
  [
    ["小圖", "small"],
    ["中圖", "medium"],
    ["大圖", "large"],
    ["滿版", ""],
  ] as const
).map(([label, size]) => ({
  label,
  command: () => setImageSize(size),
  pressed: (state) => (selectedImage(state)?.attrs.title ?? "") === size,
}));

const TABLE_TOOLS: Tool[] = [
  { label: "新增一列", command: () => addRowAfter },
  { label: "新增一欄", command: () => addColumnAfter },
  { label: "刪除這一列", command: () => deleteTableRow },
  { label: "刪除這一欄", command: () => deleteTableColumn },
];

/** 選圖片時就能說明的錯誤。 */
const IMAGE_ERRORS: Record<HighlightImageError, string> = {
  file_type: "只收 JPG、PNG、WebP 格式的圖片。",
  file_too_large: "圖片超過 5 MB，請另存小一點的檔案（例如存成 JPG）。",
};

const toolClass = cn(buttonVariants({ variant: "outline" }), "h-auto min-h-10 px-3 py-1 text-base aria-pressed:bg-primary/15");

/**
 * 籌備委員會文字頁與大會特色介紹內容（#82）的所見即所得編輯器（#88）。看到的就是排好的樣子，存檔仍是 Markdown，
 * 公開頁面照舊用 Markdown 元件顯示。表單送出時把編輯器的內容放進 name 欄位。
 *
 * 同一頁重新畫出來、內容換了（存草稿、捨棄草稿、別人發布或存了草稿，#76）：沒動過的編輯器換成新的內容；
 * 正在編輯、還沒存的留著她打的字，提醒她這一頁剛被更新，不會無聲無息蓋掉（Codex 審查）。
 * 她自己捨棄草稿時帶一個新的 resetToken，就算正在編輯也換回已發布的內容。
 *
 * 有 imageFolder 時（大會特色，#102）工具列多一個「圖片」：選圖、寫圖片說明，由瀏覽器直接上傳到存放空間，
 * 自己一段插在游標的位置；點一下圖片可以改大小。上傳完還要按表單的儲存，圖片才會出現在介紹頁。
 */
export function RichTextEditor({
  name,
  label,
  hint,
  defaultValue,
  plainText = false,
  saveLabel,
  resetToken,
  imageFolder,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
  /** defaultValue 是改版前存的純文字（committee_texts.markdown = false），照樣載入，換行保留。 */
  plainText?: boolean;
  /** 存檔按鈕上的字，用在「這一頁剛被更新」的提醒裡。 */
  saveLabel: string;
  /** 換成新的值時，不管有沒有動過都換成 defaultValue。 */
  resetToken?: string;
  /** 可以插入圖片，上傳到存放空間的這個資料夾（年度大會編號）。 */
  imageFolder?: string;
}) {
  const labelId = useId();
  const hintId = useId();
  const urlId = useId();
  const imageId = useId();
  const imageInput = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const markdown = plainText ? plainTextToMarkdown(defaultValue) : defaultValue;
  // 編輯器目前依據的內容（載入後再存回來的樣子），用來判斷她有沒有動過。
  const shown = useRef<string | null>(null);
  const loaded = useRef(markdown);
  // 處理過的重設代號。按上一頁回到舊的捨棄網址時，同一個代號不再換回（Codex 審查）。
  const usedResetTokens = useRef(new Set(resetToken === undefined ? [] : [resetToken]));
  const [updatedElsewhere, setUpdatedElsewhere] = useState(false);
  const [state, setState] = useState<EditorState | null>(null);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkError, setLinkError] = useState("");
  const [imageOpen, setImageOpen] = useState(false);
  const [imageAlt, setImageAlt] = useState("");
  const [imageError, setImageError] = useState("");
  const [uploading, setUploading] = useState(false);
  const images = imageFolder !== undefined;

  /** 比對有沒有改用的內容：存出來再讀回來的樣子，兩邊寫法不同（例如空段落）也不會誤判。 */
  function contentOf(editor: Editor) {
    return normalizeMarkdown(editor, editorMarkdown(editor));
  }

  /** 表單送出的是藏起來的欄位，放進編輯器目前的內容。編輯器還沒建好時是原本的內容，不會送出空白。 */
  function syncInput() {
    const editor = editorRef.current;
    if (editor && inputRef.current) inputRef.current.value = editorMarkdown(editor);
  }

  // 建立編輯器。之後內容換了由下一個 effect 處理，不重建。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    const initial = loaded.current;
    const created = createRichTextEditor(
      root,
      initial,
      {
        "aria-labelledby": labelId,
        "aria-describedby": hintId,
        "aria-multiline": "true",
        class: "rich-text min-h-60 px-3 py-2 outline-none",
      },
      (view) => {
        viewRef.current = view;
        setState(view.state);
        const editor = editorRef.current;
        if (!editor) return;
        if (inputRef.current) inputRef.current.value = editorMarkdown(editor);
        // 提醒出現後，她把內容改成和更新的一樣，就沒有會被蓋掉的修改。
        if (contentOf(editor) === shown.current) setUpdatedElsewhere(false);
      },
      { images },
    );
    created.then((editor) => {
      if (cancelled) {
        editor.destroy();
        return;
      }
      editorRef.current = editor;
      // 建立期間內容換了：換成新的內容。
      if (loaded.current !== initial) replaceMarkdown(editor, loaded.current);
      shown.current = contentOf(editor);
      syncInput();
    });
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
      viewRef.current = null;
    };
  }, [labelId, hintId, images]);

  useEffect(() => {
    const editor = editorRef.current;
    // 代號拿掉（之後做了別的事）或是處理過的，不算捨棄。
    const reset = resetToken !== undefined && !usedResetTokens.current.has(resetToken);
    if (reset) usedResetTokens.current.add(resetToken);
    if (!reset && loaded.current === markdown) return;
    loaded.current = markdown;
    // 編輯器還沒建好：建好時會載入新的內容。
    if (!editor || shown.current === null) return;
    const current = contentOf(editor);
    const next = normalizeMarkdown(editor, markdown);
    const untouched = reset || current === shown.current || current === next;
    shown.current = next;
    // 捨棄草稿時就算內容剛好一樣也整份換掉，復原紀錄才會清掉，按 Ctrl+Z 不會回到捨棄的草稿。
    if (reset || (untouched && current !== next)) replaceMarkdown(editor, markdown);
    setUpdatedElsewhere(!untouched);
  }, [markdown, resetToken]);

  // 伺服器動作做完，React 會重設表單，藏起來的欄位會變回原本的值。reset 事件在欄位重設之前發出，等重設完再放回編輯器的內容。
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(syncInput);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  function run(command: Command) {
    const view = viewRef.current;
    if (!view) return;
    command(view.state, view.dispatch);
    view.focus();
  }

  function openLink() {
    if (!state) return;
    setLinkError("");
    setLinkUrl(currentLink(state) || "https://");
  }

  function applyLink() {
    const view = viewRef.current;
    if (!view || linkUrl === null) return;
    const href = linkUrl.trim();
    if (href && href !== "https://" && !SAFE_URL.test(href)) {
      setLinkError("網址要以 https:// 或 http:// 開頭。");
      return;
    }
    setLink(view, href === "https://" ? "" : href);
    setLinkUrl(null);
    view.focus();
  }

  function closeLink() {
    setLinkUrl(null);
    viewRef.current?.focus();
  }

  function openImage() {
    setImageAlt("");
    setImageError("");
    setImageOpen(true);
  }

  function closeImage() {
    setImageOpen(false);
    viewRef.current?.focus();
  }

  async function insertImage() {
    const file = imageInput.current?.files?.[0];
    if (!imageFolder || !file || file.size === 0) return setImageError("請先選一張圖片。");
    const error = checkHighlightImage(file.type, file.size);
    if (error) return setImageError(IMAGE_ERRORS[error]);
    const alt = imageAlt.trim();
    if (!alt) return setImageError("請寫圖片說明。");

    setUploading(true);
    const path = highlightImagePath(imageFolder, file.type);
    const storage = createClient().storage.from(HIGHLIGHT_IMAGE_BUCKET);
    // 每次都是新檔名，可以讓瀏覽器與 CDN 一直快取。
    const uploaded = await storage
      .upload(path, file, { contentType: file.type, cacheControl: "31536000" })
      .catch((error: unknown) => ({ error }));
    setUploading(false);
    if (uploaded.error) {
      console.error("上傳大會特色圖片失敗", uploaded.error);
      return setImageError("圖片沒有上傳成功，請檢查網路後再試一次。");
    }
    const view = viewRef.current;
    if (!view) return;
    const src = storage.getPublicUrl(path).data.publicUrl;
    insertImageBlock(view.state.schema.nodes.image.create({ src, alt }))(view.state, view.dispatch);
    setImageOpen(false);
    afterLoading(() => view.focus());
  }

  const inTable = state ? isInTable(state) : false;
  const imageSelected = state ? selectedImage(state) !== null : false;
  const toolButton = ({ label: toolLabel, command, pressed }: Tool) => (
    <button
      key={toolLabel}
      type="button"
      disabled={!state || !command(state)(state)}
      aria-pressed={pressed && state ? pressed(state) : undefined}
      // 按按鈕時編輯器不失去游標位置。
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => state && run(command(state))}
      className={toolClass}
    >
      {toolLabel}
    </button>
  );

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="font-semibold">
        {label}
      </span>
      <div role="toolbar" aria-label={`${label}的樣式`} className="flex flex-wrap gap-2">
        {TOOLS.map(toolButton)}
        <button
          type="button"
          disabled={!state}
          aria-expanded={linkUrl !== null}
          onMouseDown={(event) => event.preventDefault()}
          onClick={openLink}
          className={toolClass}
        >
          連結
        </button>
        {images && (
          <button
            type="button"
            disabled={!state}
            aria-expanded={imageOpen}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openImage}
            className={toolClass}
          >
            圖片
          </button>
        )}
        {inTable && TABLE_TOOLS.map(toolButton)}
        {imageSelected && IMAGE_TOOLS.map(toolButton)}
      </div>
      {linkUrl !== null && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border-2 border-input p-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <label htmlFor={urlId} className="font-semibold">
              連結網址（清空後按「確定」會拿掉連結）
            </label>
            <input
              id={urlId}
              type="url"
              value={linkUrl}
              autoFocus
              aria-invalid={linkError ? true : undefined}
              aria-describedby={linkError ? `${urlId}-error` : undefined}
              onChange={(event) => setLinkUrl(event.target.value)}
              onKeyDown={(event) => {
                // Enter 套用連結，不送出整張表單。
                if (event.key === "Enter") {
                  event.preventDefault();
                  applyLink();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeLink();
                }
              }}
              className={inputClass}
            />
          </div>
          <button type="button" onClick={applyLink} className={toolClass}>
            確定
          </button>
          <button type="button" onClick={closeLink} className={toolClass}>
            取消
          </button>
          {linkError && (
            <p id={`${urlId}-error`} role="alert" className="w-full font-semibold text-destructive">
              {linkError}
            </p>
          )}
        </div>
      )}
      {imageOpen && (
        <div className="flex flex-col gap-2 rounded-lg border-2 border-input p-2">
          <label htmlFor={imageId} className="font-semibold">
            選一張圖片（JPG、PNG、WebP，5 MB 以內），會插在游標的位置
          </label>
          {/* 沒有 name：檔案不跟著表單送出，由這裡上傳。 */}
          <input
            ref={imageInput}
            id={imageId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            autoFocus
            onChange={() => setImageError("")}
            className={inputClass}
          />
          <label htmlFor={`${imageId}-alt`} className="font-semibold">
            圖片說明（給看不到圖的人聽的文字，例如「詩歌練唱的場地照片」）
          </label>
          <input
            id={`${imageId}-alt`}
            value={imageAlt}
            onChange={(event) => setImageAlt(event.target.value)}
            onKeyDown={(event) => {
              // Enter 插入圖片，不送出整張表單。
              if (event.key === "Enter") {
                event.preventDefault();
                insertImage();
              } else if (event.key === "Escape") {
                event.preventDefault();
                closeImage();
              }
            }}
            className={inputClass}
          />
          {imageError && (
            <p role="alert" className={alertClass}>
              {imageError}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={insertImage} className={toolClass}>
              插入圖片
            </button>
            <button type="button" onClick={closeImage} className={toolClass}>
              取消
            </button>
          </div>
          <LoadingOverlay show={uploading} label="上傳圖片中…" />
        </div>
      )}
      {updatedElsewhere && (
        <p role="alert" className={noticeClass}>
          這一頁剛被更新（可能是另一位總管理員）。編輯框裡留著你還沒存的修改，按「{saveLabel}」會蓋掉更新的內容。
        </p>
      )}
      {/* 表單送出的內容。不用 <input type="hidden">：React 重畫時會把它的值改回 defaultValue。 */}
      <textarea ref={inputRef} name={name} defaultValue={markdown} hidden readOnly />
      <div ref={rootRef} className={cn(inputClass, "p-0 focus-within:ring-3 focus-within:ring-ring/50")} />
      <span id={hintId} className="text-sm text-muted-foreground">
        {hint}
      </span>
    </div>
  );
}
