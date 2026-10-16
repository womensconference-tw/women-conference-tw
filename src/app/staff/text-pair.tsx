import { missingEnglish } from "@/lib/content";
import { inputClass } from "./ui";

/**
 * 內容欄位的中英兩欄並排（手機上上下排）。英文沒填時前台顯示中文；
 * 已存的中文有填、英文空白時，英文欄下方顯示缺漏警示，提醒總管理員翻譯。
 */
export function TextPair({
  name,
  label,
  zh = "",
  en = "",
  required = false,
  multiline = false,
}: {
  name: string;
  label: string;
  zh?: string;
  en?: string;
  required?: boolean;
  multiline?: boolean;
}) {
  const Input = multiline ? "textarea" : "input";
  const missing = missingEnglish(zh, en);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">
          {label}（中文）{required && <span className="text-destructive">＊</span>}
        </span>
        <Input name={`${name}Zh`} defaultValue={zh} required={required} rows={multiline ? 4 : undefined} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{label}（英文）</span>
        <Input
          name={`${name}En`}
          defaultValue={en}
          rows={multiline ? 4 : undefined}
          className={inputClass}
        />
        {missing && (
          <span className="text-sm font-semibold text-destructive">
            ⚠ 英文還沒填，英文版會顯示中文。
          </span>
        )}
      </label>
    </div>
  );
}
