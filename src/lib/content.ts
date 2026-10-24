import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { HERO_SLOTS, heroImageUrl, heroPathsOf, type HeroSlot } from "./hero";
import { highlightImageUrl, isHighlightImagePath } from "./highlight-images";
import { hasHighlightPage, PAGE_TEMPLATES, type PageTemplate } from "./home-content";
import { trimBlank, UUID_PATTERN } from "./registration";

/*
 * 後台編輯目前年度的內容（日期、時間、主題經文、歡迎詞、管理員 LINE）、時程時間點、常見問題與自訂區塊（#21）、
 * 大會特色（#82）。
 * 只有總管理員能寫入，由資料庫的權限規則強制（ADR 0004）；這裡先確認一次，好在畫面上說明。
 * 時程的先後順序、報名開放後不能改開放時間，都由資料庫擋下，這裡把錯誤轉成代碼。
 * 首頁每次都向資料庫讀內容，存檔後立即反映。
 */

export type ContentError =
  | "not_admin"
  | "date_invalid"
  | "time_invalid"
  | "line_id_invalid"
  | "schedule_invalid"
  | "schedule_incomplete"
  | "schedule_order"
  | "opens_at_locked"
  | "title_required"
  | "body_required"
  | "button_label_required"
  | "button_url_invalid"
  | "person_name_required"
  | "not_found"
  | "unavailable";

export type ContentResult = { ok: true } | { ok: false; error: ContentError };

/** 中文有填、英文沒填（前台英文版會顯示中文）時，後台要警示。 */
export function missingEnglish(zh: string, en: string): boolean {
  return trimBlank(zh) !== "" && trimBlank(en) === "";
}

// 台灣沒有日光節約時間，一律 +08:00。
const TAIPEI_OFFSET = "+08:00";
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 表單上的台灣時間（datetime-local，例如 2027-03-01T09:00）換成資料庫的時間。空白是 null，看不懂的是 undefined。 */
export function parseTaipeiDateTime(raw: string): string | null | undefined {
  const value = trimBlank(raw);
  if (value === "") return null;
  // 瀏覽器通常只送到分鐘，有些會帶秒數。
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:[0-5]\d)?$/.exec(value);
  if (!match || !validDate(match[1]) || !validTime(match[2])) return undefined;
  return new Date(`${match[1]}T${match[2]}${match[3] ?? ":00"}${TAIPEI_OFFSET}`).toISOString();
}

/** 資料庫的時間換成表單上的台灣時間（到分鐘）。 */
export function toTaipeiDateTimeInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 16);
}

/** YYYY-MM-DD，而且是真的有的日子（沒有 2 月 30 日）。 */
export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// HH:MM，00:00–23:59。
function validTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * 自訂區塊按鈕的網址，和資料庫 custom_blocks_button_url_safe 一致：有網域的 http(s) 網址或站內路徑，
 * 站內路徑的第二個字不能是 / 或 \，整個網址不能有空白或控制字元（瀏覽器會當成連到別的網站）。
 * 不能有的字元明確列出，和資料庫一字不差：U+0001–0020、U+007F–00A0、以及其他 Unicode 空白（含 U+FEFF）。
 */
export function isSafeButtonUrl(url: string): boolean {
  return (
    /^(https?:\/\/[^/\\?#]+|\/([^/\\]|$))/i.test(url) &&
    !/[\u0000-\u0020\u007f-\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/.test(url)
  );
}

// LINE ID 只有英數字與 . - _，官方帳號以 @ 開頭。
const LINE_ID_PATTERN = /^@?[A-Za-z0-9._-]{1,40}$/;

export type ConferenceDetailsInput = {
  conferenceId: string;
  /** 大會當天，YYYY-MM-DD。 */
  conferenceDate: string;
  /** 開始與結束時間（台灣時間，HH:MM）；空白表示不顯示。 */
  startTime: string;
  endTime: string;
  themeScriptureZh: string;
  themeScriptureEn: string;
  themeScriptureReferenceZh: string;
  themeScriptureReferenceEn: string;
  welcomeZh: string;
  welcomeEn: string;
  /** 歡迎詞的署名，例如「2026台灣姐妹大會籌備委員會」。 */
  welcomeSignatureZh: string;
  welcomeSignatureEn: string;
  /** 空白表示首頁「需要幫忙」不顯示 LINE。 */
  adminLineId: string;
};

/** 儲存年度大會的日期、時間、主題經文、歡迎詞與管理員 LINE。 */
export async function saveConferenceDetails(
  supabase: SupabaseClient,
  input: ConferenceDetailsInput,
): Promise<ContentResult> {
  const text = (value: string) => trimBlank(value);

  const conferenceDate = text(input.conferenceDate);
  if (!validDate(conferenceDate)) return { ok: false, error: "date_invalid" };
  const startTime = text(input.startTime);
  const endTime = text(input.endTime);
  if (
    (startTime && !validTime(startTime)) ||
    (endTime && !validTime(endTime)) ||
    (endTime && (!startTime || endTime <= startTime))
  ) {
    return { ok: false, error: "time_invalid" };
  }
  const adminLineId = text(input.adminLineId);
  if (adminLineId && !LINE_ID_PATTERN.test(adminLineId)) return { ok: false, error: "line_id_invalid" };

  return updateConference(supabase, input.conferenceId, {
    conference_date: conferenceDate,
    start_time: startTime || null,
    end_time: endTime || null,
    theme_scripture_zh: text(input.themeScriptureZh),
    theme_scripture_en: text(input.themeScriptureEn),
    theme_scripture_reference_zh: text(input.themeScriptureReferenceZh),
    theme_scripture_reference_en: text(input.themeScriptureReferenceEn),
    welcome_zh: text(input.welcomeZh),
    welcome_en: text(input.welcomeEn),
    welcome_signature_zh: text(input.welcomeSignatureZh),
    welcome_signature_en: text(input.welcomeSignatureEn),
    admin_line_id: adminLineId || null,
  });
}

export type ScheduleInput = {
  conferenceId: string;
  /** 表單上的台灣時間（datetime-local）。 */
  announceAt: string;
  /** 報名開放後不能再改，表單不送這一欄，這裡也不改。 */
  registrationOpensAt?: string;
  registrationClosesAt: string;
};

/** 儲存公告上線、報名開放、報名截止三個時間點。首頁的狀態依這三個時間切換。 */
export async function saveSchedule(supabase: SupabaseClient, input: ScheduleInput): Promise<ContentResult> {
  const announceAt = parseTaipeiDateTime(input.announceAt);
  const closesAt = parseTaipeiDateTime(input.registrationClosesAt);
  const opensAt = input.registrationOpensAt === undefined ? undefined : parseTaipeiDateTime(input.registrationOpensAt);
  if (announceAt === undefined || closesAt === undefined || (input.registrationOpensAt !== undefined && opensAt === undefined)) {
    return { ok: false, error: "schedule_invalid" };
  }

  const current = await checkCurrentConference(supabase, input.conferenceId);
  if (!current.ok) return current;

  const values: Record<string, unknown> = { announce_at: announceAt, registration_closes_at: closesAt };
  // 表單只到分鐘。開放時間沒改時不寫回去，免得秒數不同被當成修改，報名開放後就存不了。
  if (
    opensAt !== undefined &&
    !(opensAt && toTaipeiDateTimeInput(current.registrationOpensAt) === toTaipeiDateTimeInput(opensAt))
  ) {
    values.registration_opens_at = opensAt;
  }
  return updateConference(supabase, input.conferenceId, values, true);
}

async function updateConference(
  supabase: SupabaseClient,
  conferenceId: string,
  values: Record<string, unknown>,
  checked = false,
): Promise<ContentResult> {
  if (!checked) {
    const current = await checkCurrentConference(supabase, conferenceId);
    if (!current.ok) return current;
  }

  const { data, error } = await supabase
    .from("conferences")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", conferenceId)
    .eq("is_current", true)
    .select("id");
  if (error) return failure(error);
  return data.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/**
 * 確認是總管理員、表單上的年度還是目前年度。頁面開著時目前年度換了，送出的就是舊年度；
 * 不擋的話會改到前台看不到的年度，畫面卻說首頁已經更新。
 */
async function checkCurrentConference(
  supabase: SupabaseClient,
  conferenceId: string,
): Promise<{ ok: true; registrationOpensAt: string | null } | { ok: false; error: ContentError }> {
  if (!validIds(conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { data, error } = await supabase
    .from("conferences")
    .select("registration_opens_at")
    .eq("id", conferenceId)
    .eq("is_current", true)
    .maybeSingle();
  if (error) return failure(error);
  return data ? { ok: true, registrationOpensAt: data.registration_opens_at } : { ok: false, error: "not_found" };
}

/** 可以新增、修改、排序、刪除的首頁項目：常見問題、自訂區塊、大會特色。 */
export const HOME_ITEM_KINDS = ["faq", "block", "highlight"] as const;
export type HomeItemKind = (typeof HOME_ITEM_KINDS)[number];

/**
 * 每種項目存在哪張表、標題與內文欄位叫什麼。常見問題的標題是問題、內文是答案；
 * 大會特色的標題是名稱、內文是介紹頁的內容（Markdown）。
 */
const HOME_ITEMS: Record<HomeItemKind, { table: string; title: string; body: string }> = {
  faq: { table: "faqs", title: "question", body: "answer" },
  block: { table: "custom_blocks", title: "title", body: "body" },
  highlight: { table: "highlights", title: "name", body: "description" },
};

/**
 * 新增或修改一個常見問題、自訂區塊或大會特色時填的欄位，都是表單上的原始文字。
 * 按鈕只有自訂區塊有，卡片上的一句話只有大會特色有。
 */
export type HomeItemInput = {
  kind: HomeItemKind;
  /** 有就是修改，沒有就是新增（排在最後）。 */
  id?: string | null;
  conferenceId: string;
  titleZh: string;
  titleEn?: string;
  bodyZh?: string;
  bodyEn?: string;
  buttonLabelZh?: string;
  buttonLabelEn?: string;
  /** 空白表示沒有按鈕。 */
  buttonUrl?: string;
  summaryZh?: string;
  summaryEn?: string;
  /** 大會特色介紹頁的人物版型；空白是一般的介紹頁。 */
  pageTemplate?: string;
  subtitleZh?: string;
  subtitleEn?: string;
  leadQuoteZh?: string;
  leadQuoteEn?: string;
  leadQuoteSourceZh?: string;
  leadQuoteSourceEn?: string;
  /** 圖文型的活動圖片（highlight-images 裡的路徑；空白是沒有圖）、圖片說明與結語。 */
  imagePath?: string;
  imageAltZh?: string;
  imageAltEn?: string;
  closingZh?: string;
  closingEn?: string;
};

/** 新增或修改一個常見問題、自訂區塊或大會特色。 */
export async function saveHomeItem(
  supabase: SupabaseClient,
  input: HomeItemInput,
): Promise<{ ok: true; id: string } | { ok: false; error: ContentError }> {
  const item = HOME_ITEMS[input.kind];
  const text = (value: string | undefined) => trimBlank(value ?? "");

  const titleZh = text(input.titleZh);
  if (!titleZh) return { ok: false, error: "title_required" };
  const bodyZh = text(input.bodyZh);
  if (input.kind === "faq" && !bodyZh) return { ok: false, error: "body_required" };

  const values: Record<string, unknown> = {
    [`${item.title}_zh`]: titleZh,
    [`${item.title}_en`]: text(input.titleEn),
    [`${item.body}_zh`]: bodyZh,
    [`${item.body}_en`]: text(input.bodyEn),
  };
  if (input.kind === "block") {
    const buttonUrl = text(input.buttonUrl);
    const buttonLabelZh = text(input.buttonLabelZh);
    if (buttonUrl && !isSafeButtonUrl(buttonUrl)) return { ok: false, error: "button_url_invalid" };
    if (buttonUrl && !buttonLabelZh) return { ok: false, error: "button_label_required" };
    Object.assign(values, {
      button_url: buttonUrl || null,
      button_label_zh: buttonLabelZh,
      button_label_en: text(input.buttonLabelEn),
    });
  }
  if (input.kind === "highlight") {
    const pageTemplate = text(input.pageTemplate);
    // 表單送來不認得的版型、不對的圖片路徑（後台上傳後自動填的），只可能是有人改了網頁。
    if (pageTemplate && !(PAGE_TEMPLATES as readonly string[]).includes(pageTemplate)) return { ok: false, error: "not_found" };
    const imagePath = text(input.imagePath);
    if (imagePath && !isHighlightImagePath(imagePath)) return { ok: false, error: "not_found" };
    Object.assign(values, {
      summary_zh: text(input.summaryZh),
      summary_en: text(input.summaryEn),
      page_template: pageTemplate || null,
      subtitle_zh: text(input.subtitleZh),
      subtitle_en: text(input.subtitleEn),
      lead_quote_zh: text(input.leadQuoteZh),
      lead_quote_en: text(input.leadQuoteEn),
      lead_quote_source_zh: text(input.leadQuoteSourceZh),
      lead_quote_source_en: text(input.leadQuoteSourceEn),
      image_path: imagePath || null,
      image_alt_zh: text(input.imageAltZh),
      image_alt_en: text(input.imageAltEn),
      closing_zh: text(input.closingZh),
      closing_en: text(input.closingEn),
    });
  }

  if (!validIds(input.id, input.conferenceId)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 確認是目前年度與寫入在同一個交易裡（save_home_item），中間年度不會被換掉。新的排在最後。
  const { data, error } = await supabase.rpc("save_home_item", {
    p_table: item.table,
    p_id: input.id || null,
    p_conference_id: input.conferenceId,
    p_values: values,
  });
  return error ? failure(error) : { ok: true, id: data as string };
}

/** 刪除一個常見問題、自訂區塊或大會特色。只能刪目前年度的。 */
export async function deleteHomeItem(supabase: SupabaseClient, kind: HomeItemKind, id: string): Promise<ContentResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  // 只刪目前年度的（delete_home_item）。
  const { error } = await supabase.rpc("delete_home_item", { p_table: HOME_ITEMS[kind].table, p_id: id });
  return error ? failure(error) : { ok: true };
}

/** 把一個常見問題、自訂區塊或大會特色往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。 */
export async function moveHomeItem(
  supabase: SupabaseClient,
  kind: HomeItemKind,
  id: string,
  direction: "up" | "down",
): Promise<ContentResult> {
  if (!validIds(id)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_home_item", {
    p_table: HOME_ITEMS[kind].table,
    p_id: id,
    p_up: direction === "up",
  });
  return error ? failure(error) : { ok: true };
}

export type HighlightVenueInput = {
  highlightId: string;
  venueId: string;
  /** 教堂說明（#100）；圖文型是製作靈感。 */
  bodyZh: string;
  bodyEn: string;
  /** 以下只有圖文型的各教堂頁有，一般介紹頁的表單不送（保留原值）。 */
  showTitleZh?: string;
  showTitleEn?: string;
  /** highlight-images 裡的路徑；空白是沒有海報。 */
  posterPath?: string;
  posterAltZh?: string;
  posterAltEn?: string;
};

/**
 * 存一項大會特色在一間教堂的說明（#100），圖文型另有節目名稱與海報（範本 C）。
 * 說明、節目名稱、海報都沒有時拿掉這間教堂的頁面（團隊成員另外存）。只能改目前年度的。
 */
export async function saveHighlightVenue(supabase: SupabaseClient, input: HighlightVenueInput): Promise<ContentResult> {
  if (!validIds(input.highlightId, input.venueId) || !input.highlightId || !input.venueId) {
    return { ok: false, error: "not_found" };
  }
  const posterPath = trimBlank(input.posterPath ?? "");
  // 海報是後台上傳後自動填的，格式不對只可能是有人改了網頁。
  if (posterPath && !isHighlightImagePath(posterPath)) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const values: Record<string, unknown> = { body_zh: trimBlank(input.bodyZh), body_en: trimBlank(input.bodyEn) };
  if (input.showTitleZh !== undefined) {
    Object.assign(values, {
      show_title_zh: trimBlank(input.showTitleZh),
      show_title_en: trimBlank(input.showTitleEn ?? ""),
      poster_path: posterPath || null,
      poster_alt_zh: trimBlank(input.posterAltZh ?? ""),
      poster_alt_en: trimBlank(input.posterAltEn ?? ""),
    });
  }
  const { error } = await supabase.rpc("save_highlight_venue_page", {
    p_highlight_id: input.highlightId,
    p_venue_id: input.venueId,
    p_values: values,
  });
  return error ? failure(error) : { ok: true };
}

/** 新增或修改各教堂頁的一位團隊成員時填的欄位，都是表單上的原始文字。 */
export type TeamMemberInput = {
  highlightId: string;
  venueId: string;
  /** 有就是修改，沒有就是新增（排在這間教堂的最後）。 */
  id?: string | null;
  roleZh: string;
  roleEn: string;
  nameZh: string;
  nameEn: string;
  photoPath: string;
  photoFocus: string;
  /** 人物介紹，一行一段。 */
  bioZh: string;
  bioEn: string;
};

/** 新增或修改各教堂頁（範本 C）的一位團隊成員。只能改目前年度的。 */
export async function saveTeamMember(supabase: SupabaseClient, input: TeamMemberInput): Promise<ContentResult> {
  const text = (value: string) => trimBlank(value);
  const nameZh = text(input.nameZh);
  if (!nameZh) return { ok: false, error: "person_name_required" };
  const photoPath = text(input.photoPath);
  if (photoPath && !isHighlightImagePath(photoPath)) return { ok: false, error: "not_found" };
  const focus = Number(input.photoFocus);
  if (!validIds(input.highlightId, input.venueId, input.id) || !input.highlightId || !input.venueId) {
    return { ok: false, error: "not_found" };
  }
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("save_highlight_team_member", {
    p_highlight_id: input.highlightId,
    p_venue_id: input.venueId,
    p_id: input.id || null,
    p_values: {
      role_zh: text(input.roleZh),
      role_en: text(input.roleEn),
      name_zh: nameZh,
      name_en: text(input.nameEn),
      photo_path: photoPath || null,
      photo_focus: Number.isInteger(focus) && focus >= 0 && focus <= 100 ? focus : 50,
      bio_zh: text(input.bioZh),
      bio_en: text(input.bioEn),
    },
  });
  return error ? failure(error) : { ok: true };
}

/** 刪除一位團隊成員。照片檔案不刪（複製的新年度可能也在用）。只能刪目前年度的。 */
export async function deleteTeamMember(supabase: SupabaseClient, id: string): Promise<ContentResult> {
  if (!validIds(id) || !id) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("delete_highlight_team_member", { p_id: id });
  return error ? failure(error) : { ok: true };
}

/** 把一位團隊成員往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。 */
export async function moveTeamMember(supabase: SupabaseClient, id: string, direction: "up" | "down"): Promise<ContentResult> {
  if (!validIds(id) || !id) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_highlight_team_member", { p_id: id, p_up: direction === "up" });
  return error ? failure(error) : { ok: true };
}

/** 新增或修改介紹頁的一位人物時填的欄位，都是表單上的原始文字。 */
export type HighlightPersonInput = {
  highlightId: string;
  /** 有就是修改，沒有就是新增（排在最後）。 */
  id?: string | null;
  /** 支聯會名單的編號；空白是不寫支聯會。 */
  stakeId: string;
  /** 支會名單的編號；空白是只寫支聯會。選了支會時支聯會以支會所屬的為準。 */
  wardId: string;
  /** 傳教士的服務地區；其他版型不用。 */
  serviceAreaZh: string;
  serviceAreaEn: string;
  nameZh: string;
  nameEn: string;
  /** highlight-images 裡的路徑；空白是沒有照片。 */
  photoPath: string;
  /** 0–100；看不懂的當成中間。 */
  photoFocus: string;
  /** 教堂（場地）的編號；空白是不選。選了課程時以課程的教堂為準。 */
  venueId: string;
  /** 對應課程的編號；空白是沒有對應，課程名稱自己打。 */
  courseId: string;
  /** 沒有對應課程時的課程名稱；靜態展示是作品名稱。 */
  courseTitleZh: string;
  courseTitleEn: string;
  /** 個人介紹頁的文字：講師介紹、課程簡介（一行一段）、課程大綱（一行一點）。 */
  bioZh: string;
  bioEn: string;
  summaryZh: string;
  summaryEn: string;
  outlineZh: string;
  outlineEn: string;
};

/** 新增或修改大會特色介紹頁的一位人物。只能改目前年度的。 */
export async function saveHighlightPerson(supabase: SupabaseClient, input: HighlightPersonInput): Promise<ContentResult> {
  const text = (value: string) => trimBlank(value);
  const nameZh = text(input.nameZh);
  if (!nameZh) return { ok: false, error: "person_name_required" };
  const photoPath = text(input.photoPath);
  // 照片是後台上傳後自動填的，格式不對只可能是有人改了網頁。
  if (photoPath && !isHighlightImagePath(photoPath)) return { ok: false, error: "not_found" };
  const focus = Number(input.photoFocus);

  const stakeId = text(input.stakeId);
  const wardId = text(input.wardId);
  const venueId = text(input.venueId);
  const courseId = text(input.courseId);

  if (!validIds(input.highlightId, input.id, stakeId, wardId, venueId, courseId) || !input.highlightId) {
    return { ok: false, error: "not_found" };
  }
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("save_highlight_person", {
    p_highlight_id: input.highlightId,
    p_id: input.id || null,
    p_values: {
      stake_id: stakeId || null,
      ward_id: wardId || null,
      service_area_zh: text(input.serviceAreaZh),
      service_area_en: text(input.serviceAreaEn),
      name_zh: nameZh,
      name_en: text(input.nameEn),
      photo_path: photoPath || null,
      photo_focus: Number.isInteger(focus) && focus >= 0 && focus <= 100 ? focus : 50,
      venue_id: venueId || null,
      course_id: courseId || null,
      // 對應到課程時課名從課程帶，自己打的不留（免得課程拿掉對應後跑出舊的名稱）。
      course_title_zh: courseId ? "" : text(input.courseTitleZh),
      course_title_en: courseId ? "" : text(input.courseTitleEn),
      bio_zh: text(input.bioZh),
      bio_en: text(input.bioEn),
      summary_zh: text(input.summaryZh),
      summary_en: text(input.summaryEn),
      outline_zh: text(input.outlineZh),
      outline_en: text(input.outlineEn),
    },
  });
  return error ? failure(error) : { ok: true };
}

/** 刪除介紹頁的一位人物。照片檔案不刪（複製的新年度可能也在用）。只能刪目前年度的。 */
export async function deleteHighlightPerson(supabase: SupabaseClient, id: string): Promise<ContentResult> {
  if (!validIds(id) || !id) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("delete_highlight_person", { p_id: id });
  return error ? failure(error) : { ok: true };
}

/** 把一位人物往前或往後移一格；已經在最前或最後時不動。只能移目前年度的。 */
export async function moveHighlightPerson(
  supabase: SupabaseClient,
  id: string,
  direction: "up" | "down",
): Promise<ContentResult> {
  if (!validIds(id) || !id) return { ok: false, error: "not_found" };
  const admin = await ensureAdmin(supabase);
  if (admin) return admin;

  const { error } = await supabase.rpc("move_highlight_person", { p_id: id, p_up: direction === "up" });
  return error ? failure(error) : { ok: true };
}

// 表單送來的編號格式不對（網頁被改過、或是很舊的頁面），當成找不到，不必交給資料庫。空的不算。
function validIds(...ids: (string | null | undefined)[]): boolean {
  return ids.every((id) => !id || UUID_PATTERN.test(id));
}

// 課務組、報報組與訪客的修改反正會被資料庫擋下（修改、刪除時只是找不到資料），先擋下才能說明原因。
async function ensureAdmin(supabase: SupabaseClient): Promise<{ ok: false; error: ContentError } | null> {
  const { data, error } = await supabase.rpc("is_staff_admin");
  // 前台訪客不能呼叫這個函式，也當成不是總管理員。
  if (error && error.code !== "42501") return failure(error);
  return data === true ? null : { ok: false, error: "not_admin" };
}

// 資料庫丟出的代碼轉成結果；其他錯誤記下來，畫面上顯示系統暫時出了問題。
function failure(error: PostgrestError): { ok: false; error: ContentError } {
  const violates = (constraint: string) => error.code === "23514" && error.message.includes(constraint);
  switch (true) {
    case error.message === "registration_opens_at_locked":
      return { ok: false, error: "opens_at_locked" };
    case violates("conferences_current_schedule_complete"):
      return { ok: false, error: "schedule_incomplete" };
    case violates("conferences_announce_before_opens"):
    case violates("conferences_opens_before_closes"):
    case violates("conferences_announce_before_closes"):
      return { ok: false, error: "schedule_order" };
    case violates("custom_blocks_button_url_safe"):
      return { ok: false, error: "button_url_invalid" };
    case violates("highlight_people_name_not_blank"):
    case violates("highlight_venue_team_name_not_blank"):
      return { ok: false, error: "person_name_required" };
    case violates("custom_blocks_button_has_label"):
      return { ok: false, error: "button_label_required" };
    case violates("custom_blocks_title_not_blank"):
    case violates("highlights_name_not_blank"):
      return { ok: false, error: "title_required" };
    // 問題或答案只有空白：表單上兩個都標了必填，用同一句說明。
    case violates("faqs_not_blank"):
      return { ok: false, error: "body_required" };
    case violates("conferences_start_before_end"):
    case violates("conferences_end_needs_start"):
      return { ok: false, error: "time_invalid" };
    case error.message === "not_found":
    // 人物選的支聯會不存在（被刪了，或網頁被改過）。
    case error.code === "23503" && error.message.includes("highlight_people"):
    case error.code === "23503" && error.message.includes("highlight_venue"):
      return { ok: false, error: "not_found" };
    case error.message === "not_admin":
    case error.code === "42501":
      return { ok: false, error: "not_admin" };
  }
  console.error("編輯首頁內容失敗", error);
  return { ok: false, error: "unavailable" };
}

/**
 * 後台編輯用的一個常見問題、自訂區塊或大會特色，中英兩欄都在。
 * 只有自訂區塊有按鈕、只有大會特色有卡片上的一句話，其他的這些欄位是空的。
 */
export type HomeItem = {
  id: string;
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
  buttonLabelZh: string;
  buttonLabelEn: string;
  buttonUrl: string;
  summaryZh: string;
  summaryEn: string;
  /** 大會特色：分在這一類的課程數（#83），刪除前提醒。其他的是 0。 */
  courseCount: number;
};

export type ContentEditor = {
  conferenceId: string;
  year: number;
  conferenceDate: string;
  /** HH:MM；沒填是空字串。 */
  startTime: string;
  endTime: string;
  themeScriptureZh: string;
  themeScriptureEn: string;
  themeScriptureReferenceZh: string;
  themeScriptureReferenceEn: string;
  welcomeZh: string;
  welcomeEn: string;
  welcomeSignatureZh: string;
  welcomeSignatureEn: string;
  adminLineId: string;
  /** 主視覺四個位置的圖：路徑與公開網址；沒有圖時是 null。 */
  heroImages: Record<HeroSlot, { path: string; url: string } | null>;
  heroAltZh: string;
  heroAltEn: string;
  /** 三個時間點，資料庫的時間；沒填是 null。 */
  announceAt: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  /** 報名已開放：開放時間不能再改。 */
  registrationOpened: boolean;
  faqs: HomeItem[];
  customBlocks: HomeItem[];
  highlights: HighlightItem[];
  /** 目前年度的教堂（人物選教堂用），照場地的順序。 */
  venues: { id: string; name: string }[];
  /** 目前年度的每門課（人物對應課程用），照教堂、場次、課程的順序。 */
  courses: { id: string; label: string; highlightId: string | null }[];
};

/** 後台的一項大會特色：除了首頁項目的欄位，還有各教堂分頁（#100）、人物版型與介紹頁有沒有內容。 */
export type HighlightItem = HomeItem & {
  /** 介紹頁有內容（首頁卡片能點），見 hasHighlightPage。 */
  linkable: boolean;
  /** 人物版型；一般的介紹頁是 null。 */
  pageTemplate: PageTemplate | null;
  subtitleZh: string;
  subtitleEn: string;
  leadQuoteZh: string;
  leadQuoteEn: string;
  leadQuoteSourceZh: string;
  leadQuoteSourceEn: string;
  /** 介紹頁的人物，照排序。沒選版型時也留著（改回版型時還在），只是介紹頁不顯示。 */
  people: HighlightPersonItem[];
  /** 圖文型的活動圖片（路徑與公開網址；沒有是 null）、圖片說明與結語。 */
  image: { path: string; url: string } | null;
  imageAltZh: string;
  imageAltEn: string;
  closingZh: string;
  closingEn: string;
  /**
   * 目前年度的每個場地，照場地的順序：這間教堂的說明（圖文型是製作靈感）、這間教堂分在這一類的課程數（介紹頁自動列出），
   * 圖文型另有節目名稱、海報與團隊成員。
   */
  venues: {
    venueId: string;
    venueName: string;
    bodyZh: string;
    bodyEn: string;
    courseCount: number;
    showTitleZh: string;
    showTitleEn: string;
    poster: { path: string; url: string } | null;
    posterAltZh: string;
    posterAltEn: string;
    team: TeamMemberItem[];
  }[];
};

/** 後台的一位團隊成員，中英兩欄都在。 */
export type TeamMemberItem = {
  id: string;
  roleZh: string;
  roleEn: string;
  nameZh: string;
  nameEn: string;
  photo: { path: string; url: string } | null;
  photoFocus: number;
  bioZh: string;
  bioEn: string;
};

/** 後台的一位人物，中英兩欄都在。 */
export type HighlightPersonItem = {
  id: string;
  /** 沒選是空字串。 */
  stakeId: string;
  wardId: string;
  /** 所選支聯會、支會的中文名稱（後台列表顯示）；沒選是空字串。 */
  stakeName: string;
  wardName: string;
  serviceAreaZh: string;
  serviceAreaEn: string;
  nameZh: string;
  nameEn: string;
  /** 照片的路徑與公開網址；沒有照片是 null。 */
  photo: { path: string; url: string } | null;
  photoFocus: number;
  /** 沒選是空字串。 */
  venueId: string;
  courseId: string;
  courseTitleZh: string;
  courseTitleEn: string;
  bioZh: string;
  bioEn: string;
  summaryZh: string;
  summaryEn: string;
  outlineZh: string;
  outlineEn: string;
};

const noButton = { buttonLabelZh: "", buttonLabelEn: "", buttonUrl: "" };
const noSummary = { summaryZh: "", summaryEn: "", courseCount: 0 };

/** 目前年度的內容，含中英兩欄、時程、常見問題、自訂區塊與大會特色（依首頁的順序）。沒有目前年度時回傳 null。 */
export async function getContentEditor(supabase: SupabaseClient): Promise<ContentEditor | null> {
  const { data, error } = await supabase
    .from("conferences")
    .select(
      `id, year, conference_date, start_time, end_time, admin_line_id,
      announce_at, registration_opens_at, registration_closes_at,
      theme_scripture_zh, theme_scripture_en, theme_scripture_reference_zh, theme_scripture_reference_en,
      welcome_zh, welcome_en, welcome_signature_zh, welcome_signature_en, hero_alt_zh, hero_alt_en,
      hero_mobile_zh_path, hero_mobile_en_path, hero_desktop_zh_path, hero_desktop_en_path,
      faqs(id, question_zh, question_en, answer_zh, answer_en),
      custom_blocks(id, title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url),
      venues(id, name_zh, sessions(name_zh, courses(id, title_zh, highlight_id))),
      highlights(id, name_zh, name_en, summary_zh, summary_en, description_zh, description_en, page_template,
        subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en,
        image_path, image_alt_zh, image_alt_en, closing_zh, closing_en,
        courses(count),
        highlight_venues(venue_id, body_zh, body_en, show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en),
        highlight_venue_team(id, venue_id, role_zh, role_en, name_zh, name_en, photo_path, photo_focus, bio_zh, bio_en),
        highlight_people(id, stake_id, ward_id, service_area_zh, service_area_en, name_zh, name_en, photo_path,
          photo_focus, venue_id, course_id, course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en,
          outline_zh, outline_en, stakes(name_zh), wards(name_zh)))`,
    )
    .eq("is_current", true)
    .order("position", { referencedTable: "faqs" })
    .order("id", { referencedTable: "faqs" })
    .order("position", { referencedTable: "custom_blocks" })
    .order("id", { referencedTable: "custom_blocks" })
    .order("position", { referencedTable: "venues" })
    .order("id", { referencedTable: "venues" })
    .order("position", { referencedTable: "venues.sessions" })
    .order("id", { referencedTable: "venues.sessions" })
    .order("position", { referencedTable: "venues.sessions.courses" })
    .order("id", { referencedTable: "venues.sessions.courses" })
    .order("position", { referencedTable: "highlights" })
    .order("id", { referencedTable: "highlights" })
    .order("position", { referencedTable: "highlights.highlight_people" })
    .order("id", { referencedTable: "highlights.highlight_people" })
    .order("position", { referencedTable: "highlights.highlight_venue_team" })
    .order("id", { referencedTable: "highlights.highlight_venue_team" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const opensAt = data.registration_opens_at;
  return {
    conferenceId: data.id,
    year: data.year,
    conferenceDate: data.conference_date,
    // 資料庫的 time 欄位讀出來是 "09:00:00"。
    startTime: data.start_time?.slice(0, 5) ?? "",
    endTime: data.end_time?.slice(0, 5) ?? "",
    themeScriptureZh: data.theme_scripture_zh,
    themeScriptureEn: data.theme_scripture_en,
    themeScriptureReferenceZh: data.theme_scripture_reference_zh,
    themeScriptureReferenceEn: data.theme_scripture_reference_en,
    welcomeZh: data.welcome_zh,
    welcomeEn: data.welcome_en,
    welcomeSignatureZh: data.welcome_signature_zh,
    welcomeSignatureEn: data.welcome_signature_en,
    adminLineId: data.admin_line_id ?? "",
    heroImages: Object.fromEntries(
      HERO_SLOTS.map((slot) => {
        const path = heroPathsOf(data)[slot];
        return [slot, path ? { path, url: heroImageUrl(supabase, path) } : null];
      }),
    ) as ContentEditor["heroImages"],
    heroAltZh: data.hero_alt_zh,
    heroAltEn: data.hero_alt_en,
    announceAt: data.announce_at,
    registrationOpensAt: opensAt,
    registrationClosesAt: data.registration_closes_at,
    registrationOpened: opensAt !== null && new Date(opensAt) <= new Date(),
    faqs: data.faqs.map((faq) => ({
      id: faq.id,
      titleZh: faq.question_zh,
      titleEn: faq.question_en,
      bodyZh: faq.answer_zh,
      bodyEn: faq.answer_en,
      ...noButton,
      ...noSummary,
    })),
    customBlocks: data.custom_blocks.map((block) => ({
      id: block.id,
      titleZh: block.title_zh,
      titleEn: block.title_en,
      bodyZh: block.body_zh,
      bodyEn: block.body_en,
      buttonLabelZh: block.button_label_zh,
      buttonLabelEn: block.button_label_en,
      buttonUrl: block.button_url ?? "",
      ...noSummary,
    })),
    highlights: data.highlights.map((highlight) => ({
      id: highlight.id,
      titleZh: highlight.name_zh,
      titleEn: highlight.name_en,
      bodyZh: highlight.description_zh,
      bodyEn: highlight.description_en,
      ...noButton,
      summaryZh: highlight.summary_zh,
      summaryEn: highlight.summary_en,
      courseCount: highlight.courses[0]?.count ?? 0,
      linkable: hasHighlightPage(highlight, (highlight.courses[0]?.count ?? 0) > 0),
      image: highlight.image_path ? { path: highlight.image_path, url: highlightImageUrl(supabase, highlight.image_path) } : null,
      imageAltZh: highlight.image_alt_zh,
      imageAltEn: highlight.image_alt_en,
      closingZh: highlight.closing_zh,
      closingEn: highlight.closing_en,
      pageTemplate: highlight.page_template as PageTemplate | null,
      subtitleZh: highlight.subtitle_zh,
      subtitleEn: highlight.subtitle_en,
      leadQuoteZh: highlight.lead_quote_zh,
      leadQuoteEn: highlight.lead_quote_en,
      leadQuoteSourceZh: highlight.lead_quote_source_zh,
      leadQuoteSourceEn: highlight.lead_quote_source_en,
      people: highlight.highlight_people.map((person) => ({
        id: person.id,
        stakeId: person.stake_id ?? "",
        wardId: person.ward_id ?? "",
        // 一位人物只對到一個支聯會、一個支會，讀出來是物件不是陣列。
        stakeName: (person.stakes as unknown as { name_zh: string } | null)?.name_zh ?? "",
        wardName: (person.wards as unknown as { name_zh: string } | null)?.name_zh ?? "",
        serviceAreaZh: person.service_area_zh,
        serviceAreaEn: person.service_area_en,
        nameZh: person.name_zh,
        nameEn: person.name_en,
        photo: person.photo_path ? { path: person.photo_path, url: highlightImageUrl(supabase, person.photo_path) } : null,
        photoFocus: person.photo_focus,
        venueId: person.venue_id ?? "",
        courseId: person.course_id ?? "",
        courseTitleZh: person.course_title_zh,
        courseTitleEn: person.course_title_en,
        bioZh: person.bio_zh,
        bioEn: person.bio_en,
        summaryZh: person.summary_zh,
        summaryEn: person.summary_en,
        outlineZh: person.outline_zh,
        outlineEn: person.outline_en,
      })),
      venues: data.venues.map((venue) => {
        const text = highlight.highlight_venues.find((row) => row.venue_id === venue.id);
        return {
          venueId: venue.id,
          venueName: venue.name_zh,
          bodyZh: text?.body_zh ?? "",
          bodyEn: text?.body_en ?? "",
          courseCount: venue.sessions.flatMap((session) => session.courses).filter((c) => c.highlight_id === highlight.id)
            .length,
          showTitleZh: text?.show_title_zh ?? "",
          showTitleEn: text?.show_title_en ?? "",
          poster: text?.poster_path ? { path: text.poster_path, url: highlightImageUrl(supabase, text.poster_path) } : null,
          posterAltZh: text?.poster_alt_zh ?? "",
          posterAltEn: text?.poster_alt_en ?? "",
          team: highlight.highlight_venue_team
            .filter((member) => member.venue_id === venue.id)
            .map((member) => ({
              id: member.id,
              roleZh: member.role_zh,
              roleEn: member.role_en,
              nameZh: member.name_zh,
              nameEn: member.name_en,
              photo: member.photo_path ? { path: member.photo_path, url: highlightImageUrl(supabase, member.photo_path) } : null,
              photoFocus: member.photo_focus,
              bioZh: member.bio_zh,
              bioEn: member.bio_en,
            })),
        };
      }),
    })),
    venues: data.venues.map((venue) => ({ id: venue.id, name: venue.name_zh })),
    courses: data.venues.flatMap((venue) =>
      venue.sessions.flatMap((session) =>
        session.courses.map((course) => ({
          id: course.id,
          label: `${venue.name_zh}・${session.name_zh}・${course.title_zh}`,
          highlightId: course.highlight_id,
        })),
      ),
    ),
  };
}
