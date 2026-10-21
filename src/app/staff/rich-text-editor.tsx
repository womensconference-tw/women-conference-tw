"use client";

import "@milkdown/kit/prose/view/style/prosemirror.css";
import type { Editor } from "@milkdown/kit/core";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { liftListItem, sinkListItem } from "@milkdown/kit/prose/schema-list";
import type { Command, EditorState } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { useEffect, useId, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { plainTextToMarkdown } from "@/lib/rich-text";
import { SAFE_URL } from "@/lib/safe-url";
import { cn } from "@/lib/utils";
import {
  currentLink,
  currentList,
  deleteTableColumn,
  deleteTableRow,
  insertTable,
  setLink,
  toggleHeading,
  toggleList,
} from "./rich-text-commands";
import { createRichTextEditor, editorMarkdown, normalizeMarkdown, replaceMarkdown } from "./rich-text-setup";
import { inputClass, noticeClass } from "./ui";

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
];

const TABLE_TOOLS: Tool[] = [
  { label: "新增一列", command: () => addRowAfter },
  { label: "新增一欄", command: () => addColumnAfter },
  { label: "刪除這一列", command: () => deleteTableRow },
  { label: "刪除這一欄", command: () => deleteTableColumn },
];

const toolClass = cn(buttonVariants({ variant: "outline" }), "h-auto min-h-10 px-3 py-1 text-base aria-pressed:bg-primary/15");

/**
 * 籌備委員會文字頁與大會特色介紹內容（#82）的所見即所得編輯器（#88）。看到的就是排好的樣子，存檔仍是 Markdown，
 * 公開頁面照舊用 Markdown 元件顯示。表單送出時把編輯器的內容放進 name 欄位。
 *
 * 同一頁重新畫出來、內容換了（存草稿、捨棄草稿、別人發布或存了草稿，#76）：沒動過的編輯器換成新的內容；
 * 正在編輯、還沒存的留著她打的字，提醒她這一頁剛被更新，不會無聲無息蓋掉（Codex 審查）。
 * 她自己捨棄草稿時帶一個新的 resetToken，就算正在編輯也換回已發布的內容。
 */
export function RichTextEditor({
  name,
  label,
  hint,
  defaultValue,
  plainText = false,
  saveLabel,
  resetToken,
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
}) {
  const labelId = useId();
  const hintId = useId();
  const urlId = useId();
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
        const current = editorMarkdown(editor);
        if (inputRef.current) inputRef.current.value = current;
        // 提醒出現後，她把內容改成和更新的一樣，就沒有會被蓋掉的修改。
        if (current === shown.current) setUpdatedElsewhere(false);
      },
    );
    created.then((editor) => {
      if (cancelled) {
        editor.destroy();
        return;
      }
      editorRef.current = editor;
      // 建立期間內容換了：換成新的內容。
      if (loaded.current !== initial) replaceMarkdown(editor, loaded.current);
      shown.current = editorMarkdown(editor);
      syncInput();
    });
    return () => {
      cancelled = true;
      editorRef.current?.destroy();
      editorRef.current = null;
      viewRef.current = null;
    };
  }, [labelId, hintId]);

  useEffect(() => {
    const editor = editorRef.current;
    // 代號拿掉（之後做了別的事）或是處理過的，不算捨棄。
    const reset = resetToken !== undefined && !usedResetTokens.current.has(resetToken);
    if (reset) usedResetTokens.current.add(resetToken);
    if (!reset && loaded.current === markdown) return;
    loaded.current = markdown;
    // 編輯器還沒建好：建好時會載入新的內容。
    if (!editor || shown.current === null) return;
    const current = editorMarkdown(editor);
    const next = normalizeMarkdown(editor, markdown);
    const untouched = reset || current === shown.current || current === next;
    shown.current = next;
    if (untouched && current !== next) replaceMarkdown(editor, markdown);
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

  const inTable = state ? isInTable(state) : false;
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
        {inTable && TABLE_TOOLS.map(toolButton)}
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
