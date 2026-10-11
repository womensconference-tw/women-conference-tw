import type { Locale } from "./locale";

/*
 * 固定介面文字（按鈕、欄位名、錯誤訊息）的中英對照檔。每年會換的內容放資料庫，不放這裡。
 * 中文是基準：英文少了鍵或多了鍵，型別檢查都會失敗。
 * 要帶入資料的文字寫成函式，參數已經格式化好。
 */
const zh = {
  site: {
    title: "台灣姐妹大會",
    description: "台灣姐妹大會官方網站與報名系統",
  },
  // 切換按鈕顯示「要切換過去的那個語言」，用該語言自己的寫法。
  languageSwitch: "English",
  home: {
    comingSoon: "大會資訊即將公布，請稍後再來看看。",
    conferenceDate: (year: number, date: string) => `${year} 年大會：${date}`,
    registrationOpensAt: (dateTime: string) => `報名將於 ${dateTime} 開放`,
    registrationOpensSoon: "報名開放時間即將公布",
    registrationOpenUntil: (dateTime: string) => `報名進行中，${dateTime} 截止`,
    registrationOpen: "報名進行中",
    registrationClosed: "報名已截止",
  },
};

export type Messages = typeof zh;

const en: Messages = {
  site: {
    title: "Taiwan Women's Conference",
    description: "Official website and registration for the Taiwan Women's Conference",
  },
  languageSwitch: "中文",
  home: {
    comingSoon: "Conference details are coming soon. Please check back later.",
    conferenceDate: (year: number, date: string) => `${year} Conference: ${date}`,
    registrationOpensAt: (dateTime: string) => `Registration opens ${dateTime} (Taiwan time)`,
    registrationOpensSoon: "The registration opening date will be announced soon",
    registrationOpenUntil: (dateTime: string) =>
      `Registration is open until ${dateTime} (Taiwan time)`,
    registrationOpen: "Registration is open",
    registrationClosed: "Registration has closed",
  },
};

export const messages: Record<Locale, Messages> = { zh, en };
