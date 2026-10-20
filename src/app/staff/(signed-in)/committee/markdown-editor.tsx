"use client";

import { useEffect, useId, useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { applyEdit, formatMarkdown, type MarkdownFormat } from "@/lib/markdown-format";
import { cn } from "@/lib/utils";
import { inputClass, noticeClass } from "../../ui";

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
 *
 * 同一頁重新畫出來、內容換了（存草稿、捨棄草稿、別人發布或存了草稿，#76）：沒動過的編輯框換成新的內容；
 * 正在編輯、還沒存的留著她打的字，提醒她這一頁剛被更新，不會無聲無息蓋掉（Codex 審查）。
 * 她自己捨棄草稿時帶一個新的 resetToken，就算正在編輯也換回已發布的內容。
 */
export function MarkdownEditor({
  name,
  label,
  hint,
  defaultValue,
  resetToken,
}: {
  name: string;
  label: string;
  hint: string;
  defaultValue: string;
  /** 換成新的值時，不管有沒有動過都換成 defaultValue。 */
  resetToken?: string;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  // 編輯框目前依據的內容，用來判斷她有沒有動過。
  const shown = useRef(defaultValue);
  const lastResetToken = useRef(resetToken);
  const [updatedElsewhere, setUpdatedElsewhere] = useState(false);

  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    // 代號拿掉（之後做了別的事）不算捨棄。
    const reset = resetToken !== undefined && resetToken !== lastResetToken.current;
    lastResetToken.current = resetToken;
    if (!reset && shown.current === defaultValue) return;
    const untouched = reset || textarea.value === shown.current || textarea.value === defaultValue;
    shown.current = defaultValue;
    if (untouched) textarea.value = defaultValue;
    setUpdatedElsewhere(!untouched);
  }, [defaultValue, resetToken]);

  // 提醒出現後，她把內容改成和更新的一樣，或存了草稿、表單重設了，就沒有會被蓋掉的修改。
  function checkUpdated() {
    if (ref.current?.value === shown.current) setUpdatedElsewhere(false);
  }

  // 伺服器動作做完，React 會重設表單，不會觸發 input。reset 事件在欄位重設之前發出，等重設完再看。
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setTimeout(checkUpdated);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

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
      {updatedElsewhere && (
        <p role="alert" className={noticeClass}>
          這一頁剛被更新（可能是另一位總管理員）。編輯框裡留著你還沒存的修改，按「儲存草稿」會蓋掉更新的內容。
        </p>
      )}
      <textarea
        ref={ref}
        id={id}
        name={name}
        defaultValue={defaultValue}
        onInput={checkUpdated}
        rows={12}
        className={cn(inputClass, "font-mono")}
      />
      <span className="text-sm text-muted-foreground">{hint}</span>
    </div>
  );
}
