/** 前台支援的語言。中文是預設，也是英文缺漏時的退回語言。 */
export const locales = ["zh", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "zh";

/** 記住語言選擇的 cookie 名稱。 */
export const localeCookie = "lang";

/** 把 cookie 值轉成語言；沒設定或認不得的值一律當中文。 */
export function parseLocale(value: string | undefined): Locale {
  return locales.find((locale) => locale === value) ?? defaultLocale;
}

/** `<html lang>` 與日期格式用的語言標籤。 */
export const languageTags: Record<Locale, string> = {
  zh: "zh-Hant-TW",
  en: "en",
};
