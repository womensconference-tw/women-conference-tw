import type { CommitteeError } from "@/lib/committee";

/** 籌備委員會頁與文字頁草稿的預覽頁（/preview/committee）做完動作後顯示的訊息。 */
export const COMMITTEE_DONE: Record<string, string> = {
  saved: "已儲存。",
  moved: "已調整順序。",
  deleted: "已刪除。",
  draft_saved: "已存成草稿，大家還看不到。請按「預覽並發布」確認排版後再發布。",
  published: "已發布，大家現在看到的是新版本。",
  discarded: "已捨棄草稿，回到已發布的版本。",
};

export const COMMITTEE_ERRORS: Record<CommitteeError, string> = {
  not_admin: "只有總管理員能編輯籌備委員會資訊。",
  title_required: "請填標題。",
  name_required: "請填姓名。",
  date_invalid: "請選會議日期。",
  url_invalid: "連結要是 https:// 或 http:// 開頭的完整網址，不能有空白。",
  team_invalid: "請選組別。",
  role_invalid: "請選職務。",
  region_invalid: "請選北區、中區、南區或全區。",
  stake_required: "請選支聯會。",
  not_found: "找不到這一項，可能已經被刪除。請重新整理頁面再試一次。",
  no_draft: "沒有尚未發布的修改，可能已經被發布或捨棄了。",
  draft_changed: "你預覽之後，草稿又被修改過（可能是另一位總管理員），所以還沒發布。請看過現在的內容，確認後再按「發布」。",
  unavailable: "系統暫時出了問題，請稍後再試。",
};
