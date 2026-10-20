import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";
import { UUID_PATTERN } from "./registration";

export type Venue = { name: string; address: string; features: string };

export type CustomBlock = {
  title: string;
  body: string;
  button: { label: string; url: string } | null;
};

/** 首頁「大會有什麼」的一張卡片。有介紹內容才連到介紹頁。 */
export type HighlightCard = {
  id: string;
  name: string;
  /** 卡片上的一句話；沒填是空字串。 */
  summary: string;
  hasDescription: boolean;
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
  highlights: HighlightCard[];
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
      custom_blocks(title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url),
      highlights(id, name_zh, name_en, summary_zh, summary_en, description_zh)`,
    )
    .eq("is_current", true)
    // 排序相同時再依 id，讓順序每次都一樣。
    .order("position", { referencedTable: "faqs" })
    .order("id", { referencedTable: "faqs" })
    .order("position", { referencedTable: "venues" })
    .order("id", { referencedTable: "venues" })
    .order("position", { referencedTable: "custom_blocks" })
    .order("id", { referencedTable: "custom_blocks" })
    .order("position", { referencedTable: "highlights" })
    .order("id", { referencedTable: "highlights" })
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
    highlights: data.highlights.map((highlight) => ({
      id: highlight.id,
      name: localized(highlight, "name", locale),
      summary: localized(highlight, "summary", locale),
      // 英文沒填時顯示中文，所以只看中文有沒有寫。
      hasDescription: highlight.description_zh.trim() !== "",
    })),
  };
}

/** 介紹頁要顯示的一項大會特色，已依語言挑好（英文缺漏時是中文）。 */
export type Highlight = { name: string; description: string };

/**
 * 讀取目前年度的一項大會特色。不是目前年度的、找不到的、沒寫介紹內容的都回傳 null（介紹頁顯示「找不到」）。
 * 公告上線前要不要顯示，由頁面判斷。
 */
export async function getHighlight(supabase: SupabaseClient, id: string, locale: Locale): Promise<Highlight | null> {
  // 網址被改過、不是編號的，不必交給資料庫。
  if (!UUID_PATTERN.test(id)) return null;
  const { data, error } = await supabase
    .from("highlights")
    .select("name_zh, name_en, description_zh, description_en, conferences!inner(is_current)")
    .eq("id", id)
    .eq("conferences.is_current", true)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.description_zh.trim() === "") return null;
  return { name: localized(data, "name", locale), description: localized(data, "description", locale) };
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
