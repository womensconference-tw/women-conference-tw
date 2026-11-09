import { trimBlank } from "./registration";

/** 後台的中英兩欄：中文有填、英文沒填（前台英文版會顯示中文）時，要警示。 */
export function missingEnglish(zh: string, en: string): boolean {
  return trimBlank(zh) !== "" && trimBlank(en) === "";
}
