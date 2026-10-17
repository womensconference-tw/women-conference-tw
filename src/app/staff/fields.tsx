import type { ReactNode } from "react";
import { toTaipeiDateTimeInput } from "@/lib/content";
import { inputClass } from "./ui";

/** 後台表單的一個欄位：標題（必填的加紅色＊）、輸入框、下面的說明。 */
export function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-semibold">
        {label}
        {required && <span className="text-destructive">＊</span>}
      </span>
      {children}
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** 必填的台灣時間（日期加時間）欄位。`value` 是資料庫的時間，沒有時是空白。 */
export function DateTimeField({ name, label, value, hint }: { name: string; label: string; value: string | null; hint: string }) {
  return (
    <Field label={label} hint={hint} required>
      <input
        name={name}
        type="datetime-local"
        defaultValue={toTaipeiDateTimeInput(value)}
        required
        className={inputClass}
      />
    </Field>
  );
}
