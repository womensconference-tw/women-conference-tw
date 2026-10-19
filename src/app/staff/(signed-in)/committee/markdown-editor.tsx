"use client";

import { useId, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { applyEdit, formatMarkdown, type MarkdownFormat } from "@/lib/markdown-format";
import { cn } from "@/lib/utils";
import { inputClass } from "../../ui";

const FORMATS: { format: MarkdownFormat; label: string }[] = [
  { format: "heading", label: "標題" },
  { format: "bold", label: "粗體" },
  { format: "orderedList", label: "編號清單" },
  { format: "bulletList", label: "項目清單" },
  { format: "indent", label: "往內縮一層" },
  { format: "outdent", label: "往外移一層" },
  { format: "table", label: "表格" },
  { format: "link", label: "連結" },
];

/**
 * 籌備委員會文字頁的編輯框（#75）。上方的樣式按鈕在游標位置插入（或包住選取的文字）對應的 Markdown，
 * 不會 Markdown 的人也能排版。編輯框不受 React 控制，表單照舊用 name 送出。
 */
export function MarkdownEditor({
  name,
  label,
  hint,
  defaultValue,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(format: MarkdownFormat) {
    const textarea = ref.current;
    if (!textarea) return;
    const { value, selectionStart, selectionEnd } = textarea;
    const edit = formatMarkdown(format, value, selectionStart, selectionEnd);
    const result = applyEdit(value, edit);
    textarea.focus();
    // 用瀏覽器的插入文字，按 Ctrl+Z 可以復原；瀏覽器不支援時直接換掉全文。
    textarea.setSelectionRange(edit.from, edit.to);
    const inserted = document.execCommand?.("insertText", false, edit.insert);
    if (!inserted || textarea.value !== result.value) textarea.value = result.value;
    textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <div role="toolbar" aria-label={`${label}的樣式`} className="flex flex-wrap gap-2">
        {FORMATS.map(({ format, label: buttonLabel }) => (
          <button
            key={format}
            type="button"
            onClick={() => apply(format)}
            className={cn(buttonVariants({ variant: "outline" }), "h-auto min-h-10 px-3 py-1 text-base")}
          >
            {buttonLabel}
          </button>
        ))}
      </div>
      <textarea ref={ref} id={id} name={name} defaultValue={defaultValue} rows={12} className={cn(inputClass, "font-mono")} />
      <span className="text-sm text-muted-foreground">{hint}</span>
    </div>
  );
}
