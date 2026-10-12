import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";

export type Venue = { name: string; address: string; features: string };

export type CustomBlock = {
  title: string;
  body: string;
  button: { label: string; url: string } | null;
};

/** 首頁每年會變的內容，已依語言挑好（英文缺漏時是中文）。 */
export type HomeContent = {
  /** 大會當天的時間（台灣時間，HH:MM）；沒填開始時間時是 null。 */
  time: { start: string; end: string | null } | null;
  /** 主題經文；沒填時兩個都是空字串。 */
  themeScripture: { text: string; reference: string };
  welcome: string;
  faqs: { question: string; answer: string }[];
  venues: Venue[];
  /** 「需要幫忙」顯示的管理員 LINE 與加好友連結；沒填時是 null。 */
  adminLine: { id: string; url: string } | null;
  customBlocks: CustomBlock[];
};

/** 讀取目前年度的首頁內容。沒有目前年度時回傳 null。 */
export async function getHomeContent(
  supabase: SupabaseClient,
  locale: Locale,
): Promise<HomeContent | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select(
      `start_time, end_time, admin_line_id,
      theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
      welcome_zh, welcome_en,
      faqs(question_zh, question_en, answer_zh, answer_en),
      venues(name_zh, name_en, address_zh, address_en, features_zh, features_en),
      custom_blocks(title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url)`,
    )
    .eq("is_current", true)
    // 排序相同時再依 id，讓順序每次都一樣。
    .order("position", { referencedTable: "faqs" })
    .order("id", { referencedTable: "faqs" })
    .order("position", { referencedTable: "venues" })
    .order("id", { referencedTable: "venues" })
    .order("position", { referencedTable: "custom_blocks" })
    .order("id", { referencedTable: "custom_blocks" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const adminLineId = data.admin_line_id?.trim();

  return {
    time: data.start_time
      ? { start: hoursMinutes(data.start_time), end: data.end_time && hoursMinutes(data.end_time) }
      : null,
    themeScripture: {
      text: localized(data, "theme_scripture", locale),
      reference: localized(data, "theme_scripture_reference", locale),
    },
    welcome: localized(data, "welcome", locale),
    faqs: data.faqs.map((faq) => ({
      question: localized(faq, "question", locale),
      answer: localized(faq, "answer", locale),
    })),
    venues: data.venues.map((venue) => ({
      name: localized(venue, "name", locale),
      address: localized(venue, "address", locale),
      features: localized(venue, "features", locale),
    })),
    adminLine: adminLineId ? { id: adminLineId, url: lineAddFriendUrl(adminLineId) } : null,
    customBlocks: data.custom_blocks.map((block) => ({
      title: localized(block, "title", locale),
      body: localized(block, "body", locale),
      button: block.button_url
        ? { label: localized(block, "button_label", locale), url: block.button_url }
        : null,
    })),
  };
}

// 資料庫的 time 欄位讀出來是 "09:00:00"。
function hoursMinutes(time: string): string {
  return time.slice(0, 5);
}

// 官方帳號的 ID 以 @ 開頭，加好友連結的格式和個人 ID 不同。
function lineAddFriendUrl(id: string): string {
  return id.startsWith("@")
    ? `https://line.me/R/ti/p/${encodeURIComponent(id)}`
    : `https://line.me/ti/p/~${encodeURIComponent(id)}`;
}
