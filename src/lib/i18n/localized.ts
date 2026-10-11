import type { Locale } from "./locale";

/**
 * 資料庫內容欄位的中英兩份以 `<欄位>_zh`、`<欄位>_en` 命名，例如 `name_zh`、`name_en`。
 * 這裡依語言挑出要顯示的那一份；英文沒填（空值或只有空白）時退回中文，不留空白。
 */
export function localized<F extends string>(
  row: Record<`${F}_zh` | `${F}_en`, string | null>,
  field: F,
  locale: Locale,
): string {
  const values = row as Record<string, string | null>;
  const zh = values[`${field}_zh`] ?? "";
  if (locale === "zh") return zh;
  const en = values[`${field}_en`];
  return en?.trim() ? en : zh;
}
