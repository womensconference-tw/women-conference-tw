// 後台的輸入框、按鈕與訊息框樣式。
export const inputClass = "min-h-11 w-full rounded-lg border-2 border-input bg-background px-3 py-2";
export const buttonClass = "h-auto min-h-11 px-4 py-2 text-base";
export const alertClass = "rounded-lg border-2 border-destructive p-3 font-semibold text-destructive";
export const noticeClass = "rounded-lg border-2 border-primary p-3 font-semibold";

const TIME_FORMAT = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", dateStyle: "short", timeStyle: "short" });

/** 後台顯示的時間：台灣時間，例如「2026/10/16 上午9:30」。 */
export function formatTime(iso: string) {
  return TIME_FORMAT.format(new Date(iso));
}
