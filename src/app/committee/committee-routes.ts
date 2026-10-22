/*
 * 籌備委員會公開頁面的各頁（不含「大會網站」），依選單的順序。選單（瀏覽器端）與預覽頁、各頁內容（伺服器端）都要讀，
 * 所以不放在選單的檔案裡：伺服器讀 "use client" 檔案匯出的陣列時拿不到內容。
 */
export const COMMITTEE_PAGES = [
  { key: "introduction", href: "/committee", label: "大會簡介" },
  { key: "chairMessage", href: "/committee/chair-message", label: "主席的話" },
  { key: "meetings", href: "/committee/meetings", label: "會議記錄" },
  { key: "team", href: "/committee/team", label: "工作團隊" },
  { key: "members", href: "/committee/members", label: "籌備委員" },
  { key: "plan", href: "/committee/plan", label: "執行計畫" },
] as const;
export type CommitteePageKey = (typeof COMMITTEE_PAGES)[number]["key"];
