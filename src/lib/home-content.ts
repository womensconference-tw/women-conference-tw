import type { SupabaseClient } from "@supabase/supabase-js";
import type { Locale } from "./i18n/locale";
import { localized } from "./i18n/localized";
import { heroImageUrl, heroPathsOf, pickHeroPaths } from "./hero";
import { highlightImageUrl } from "./highlight-images";
import { UUID_PATTERN } from "./registration";

/** 首頁「大會程序」的一間教堂：名稱、地址、地圖連結與這間教堂的時間軸（#84）。 */
export type Venue = {
  id: string;
  name: string;
  /** 沒填是空字串。 */
  address: string;
  /** 用地址開 Google 地圖；沒填地址時是 null。 */
  mapUrl: string | null;
  agenda: AgendaRow[];
};

/** 時間軸的一列。時間、名稱、子項目各教堂相同，地點、補充說明、課程各教堂不同。 */
export type AgendaRow = {
  /** HH:MM，台灣時間。 */
  start: string;
  end: string;
  name: string;
  /** 沒填是空字串。 */
  place: string;
  note: string;
  /** 子項目；連到有介紹內容的大會特色時有 highlightId，否則是 null（只是文字）。 */
  parts: { name: string; highlightId: string | null }[];
  /** 這一列在這間教堂接的場次的課程，依分類分組；沒接場次或場次還沒有課程時是 null。 */
  courseGroups: CourseGroup[] | null;
};

/** 同一個分類的課程。沒有分類的課程放在最後一組，category 是 null。 */
export type CourseGroup = {
  /** 分類就是一項大會特色；有介紹內容才能點（highlightId 不是 null）。 */
  category: { name: string; highlightId: string | null } | null;
  courses: AgendaCourse[];
};

/** 首頁列出的一門課。教室不公開（GLOSSARY「教室」），所以沒有教室。 */
export type AgendaCourse = {
  title: string;
  /** 沒填是空字串。 */
  speaker: string;
  /** 連續兩堂的另一堂在哪個場次，以及這堂是不是後面那一堂；不是連續兩堂時是 null。 */
  pairedWith: { sessionName: string; isSecond: boolean } | null;
};

export type CustomBlock = {
  title: string;
  body: string;
  button: { label: string; url: string } | null;
};

/** 首頁「大會有什麼」的一張卡片。介紹頁有內容才連過去（見 hasHighlightPage）。 */
export type HighlightCard = {
  id: string;
  name: string;
  /** 卡片上的一句話；沒填是空字串。 */
  summary: string;
  linkable: boolean;
};

/** 首頁每年會變的內容，已依語言挑好（英文缺漏時是中文）。 */
export type HomeContent = {
  /** 大會當天的時間（台灣時間，HH:MM）；沒填開始時間時是 null。 */
  time: { start: string; end: string | null } | null;
  /** 主題經文；沒填時兩個都是空字串。 */
  themeScripture: { text: string; reference: string };
  welcome: string;
  /** 歡迎詞的署名；沒填是空字串。 */
  welcomeSignature: string;
  /**
   * 主視覺圖片的公開網址（已依語言與缺圖的規則挑好，見 pickHeroPaths）與圖片說明；沒有圖時是 null。
   * 只有電腦版的圖時 mobileUrl 是 null：手機不顯示圖，改用文字顯示主題經文。
   */
  hero: { mobileUrl: string | null; desktopUrl: string; alt: string } | null;
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
      welcome_zh, welcome_en, welcome_signature_zh, welcome_signature_en, hero_alt_zh, hero_alt_en,
      hero_mobile_zh_path, hero_mobile_en_path, hero_desktop_zh_path, hero_desktop_en_path,
      faqs(question_zh, question_en, answer_zh, answer_en),
      venues(id, name_zh, name_en, address_zh, address_en,
        sessions(id, name_zh, name_en, courses(id, title_zh, title_en, speaker_zh, speaker_en, highlight_id))),
      agenda_items(start_time, end_time, name_zh, name_en,
        agenda_item_parts(name_zh, name_en, highlight_id),
        agenda_item_venues(venue_id, place_zh, place_en, note_zh, note_en, session_id)),
      custom_blocks(title_zh, title_en, body_zh, body_en, button_label_zh, button_label_en, button_url),
      highlights(id, name_zh, name_en, summary_zh, summary_en, description_zh, page_template, image_path,
        highlight_venues(venue_id, body_zh, show_title_zh, poster_path), highlight_people(id), highlight_venue_team(venue_id))`,
    )
    .eq("is_current", true)
    // 排序相同時再依 id，讓順序每次都一樣。
    .order("position", { referencedTable: "faqs" })
    .order("id", { referencedTable: "faqs" })
    .order("position", { referencedTable: "venues" })
    .order("id", { referencedTable: "venues" })
    .order("position", { referencedTable: "venues.sessions" })
    .order("id", { referencedTable: "venues.sessions" })
    .order("position", { referencedTable: "venues.sessions.courses" })
    .order("id", { referencedTable: "venues.sessions.courses" })
    .order("position", { referencedTable: "agenda_items" })
    .order("id", { referencedTable: "agenda_items" })
    .order("position", { referencedTable: "agenda_items.agenda_item_parts" })
    .order("id", { referencedTable: "agenda_items.agenda_item_parts" })
    .order("position", { referencedTable: "custom_blocks" })
    .order("id", { referencedTable: "custom_blocks" })
    .order("position", { referencedTable: "highlights" })
    .order("id", { referencedTable: "highlights" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const adminLineId = data.admin_line_id?.trim();
  const hero = pickHeroPaths(heroPathsOf(data), locale);
  const pairs = await supabase.from("course_pairs").select("first_course_id, second_course_id");
  if (pairs.error) throw pairs.error;
  // 介紹頁有內容的大會特色才連過去。
  const categorized = new Set(
    data.venues.flatMap((venue) => venue.sessions.flatMap((session) => session.courses.map((course) => course.highlight_id))),
  );
  const linkable = new Set(
    data.highlights.filter((h) => hasHighlightPage(h, categorized.has(h.id))).map((h) => h.id),
  );
  const highlightLink = (id: string | null) => (id && linkable.has(id) ? id : null);

  return {
    time: data.start_time
      ? { start: hoursMinutes(data.start_time), end: data.end_time && hoursMinutes(data.end_time) }
      : null,
    themeScripture: {
      text: localized(data, "theme_scripture", locale),
      reference: localized(data, "theme_scripture_reference", locale),
    },
    welcome: localized(data, "welcome", locale),
    welcomeSignature: localized(data, "welcome_signature", locale),
    hero: hero && {
      mobileUrl: hero.mobile && heroImageUrl(supabase, hero.mobile),
      desktopUrl: heroImageUrl(supabase, hero.desktop),
      alt: localized(data, "hero_alt", locale),
    },
    faqs: data.faqs.map((faq) => ({
      question: localized(faq, "question", locale),
      answer: localized(faq, "answer", locale),
    })),
    venues: data.venues.map((venue) => {
      const address = localized(venue, "address", locale);
      return {
        id: venue.id,
        name: localized(venue, "name", locale),
        address,
        mapUrl: address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null,
        agenda: data.agenda_items.map((item) => {
          const setting = item.agenda_item_venues.find((row) => row.venue_id === venue.id);
          const session = setting?.session_id ? venue.sessions.find((s) => s.id === setting.session_id) : undefined;
          return {
            start: hoursMinutes(item.start_time),
            end: hoursMinutes(item.end_time),
            name: localized(item, "name", locale),
            place: setting ? localized(setting, "place", locale) : "",
            note: setting ? localized(setting, "note", locale) : "",
            parts: item.agenda_item_parts.map((part) => ({
              name: localized(part, "name", locale),
              highlightId: highlightLink(part.highlight_id),
            })),
            courseGroups:
              session && session.courses.length > 0
                ? groupCourses(session.courses, venue.sessions, data.highlights, pairs.data, highlightLink, locale)
                : null,
          };
        }),
      };
    }),
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
      linkable: linkable.has(highlight.id),
    })),
  };
}

/** 一項大會特色在一間教堂的頁面內容（highlight_venues 的一列），與那間教堂的團隊成員。 */
type VenuePageRow = { body_zh: string; show_title_zh?: string; poster_path?: string | null };

/** 範本 C 的各教堂頁有沒有東西可看：製作靈感、節目名稱、海報或團隊成員有一個就算（只看中文，和簡介一樣）。 */
export function hasVenuePage(row: VenuePageRow | undefined, teamCount: number): boolean {
  if (teamCount > 0) return true;
  if (!row) return false;
  return row.body_zh.trim() !== "" || (row.show_title_zh ?? "").trim() !== "" || !!row.poster_path;
}

/**
 * 介紹頁有沒有東西可看：簡介、任何一間教堂的說明、或有課程分在這一類（#100），有一個就算。
 * 人物卡片版型不分教堂，改看簡介或人物；圖文型看簡介、活動圖片或任何一間教堂頁。
 * 英文沒填時顯示中文，所以只看中文有沒有寫。首頁卡片、大會程序與課程分類的連結都依這個規則。
 */
export function hasHighlightPage(
  highlight: {
    description_zh: string;
    page_template: string | null;
    image_path?: string | null;
    highlight_venues: (VenuePageRow & { venue_id?: string })[];
    highlight_people: unknown[];
    highlight_venue_team?: { venue_id: string }[];
  },
  hasCourses: boolean,
): boolean {
  if (highlight.description_zh.trim() !== "") return true;
  if (isFeatureTemplate(highlight.page_template)) {
    return (
      !!highlight.image_path ||
      highlight.highlight_venues.some((row) => hasVenuePage(row, 0)) ||
      (highlight.highlight_venue_team ?? []).length > 0
    );
  }
  if (highlight.page_template) return highlight.highlight_people.length > 0;
  return highlight.highlight_venues.some((venue) => venue.body_zh.trim() !== "") || hasCourses;
}

/**
 * 介紹頁的人物卡片版型（範本 A，設計稿 docs/design/template-a-cards.dc.html）：五種共用一個版面，
 * 只差卡片上要不要顯示課程（作品）名稱、按鈕文字與個人介紹頁有哪幾段（PERSON_SECTIONS）。
 */
export const CARD_TEMPLATES = ["corner", "spiritual", "honor", "missionary", "exhibit"] as const;
export type CardTemplate = (typeof CARD_TEMPLATES)[number];

/**
 * 介紹頁的圖文型版型（範本 B，設計稿 docs/design/template-b-feature.dc.html）：即席唱詩班、迷妳音樂會，
 * 介紹頁有各教堂大按鈕，連到每間教堂的團隊頁（範本 C）。兩種只差文字。
 */
export const FEATURE_TEMPLATES = ["choir", "concert"] as const;
export type FeatureTemplate = (typeof FEATURE_TEMPLATES)[number];

/** 大會特色可選的介紹頁版型；沒選的是一般的介紹頁（簡介加教堂分頁）。 */
export const PAGE_TEMPLATES = [...CARD_TEMPLATES, ...FEATURE_TEMPLATES] as const;
export type PageTemplate = CardTemplate | FeatureTemplate;

export function isCardTemplate(template: string | null): template is CardTemplate {
  return (CARD_TEMPLATES as readonly (string | null)[]).includes(template);
}

export function isFeatureTemplate(template: string | null): template is FeatureTemplate {
  return (FEATURE_TEMPLATES as readonly (string | null)[]).includes(template);
}

/** 個人介紹頁（範本 D）的一段：講師（貴賓）介紹、課程簡介、課程大綱。 */
export type PersonSection = "bio" | "summary" | "outline";

/** 每種版型的個人介紹頁有哪幾段，依這個順序（設計交接說明）。 */
export const PERSON_SECTIONS: Record<CardTemplate, PersonSection[]> = {
  corner: ["bio", "summary", "outline"],
  spiritual: ["bio", "summary", "outline"],
  honor: ["bio"],
  missionary: ["bio", "outline"],
  exhibit: ["bio"],
};

/** 卡片上顯示課程（作品）名稱的版型：角落課程顯示課名、靜態展示顯示作品名稱。 */
export const CARD_SHOWS_COURSE: Record<CardTemplate, boolean> = {
  corner: true,
  spiritual: false,
  honor: false,
  missionary: false,
  exhibit: true,
};

/** 人物卡片介紹頁的一位人物，已依語言挑好（英文缺漏時是中文）。 */
export type HighlightPerson = {
  id: string;
  /** 從支聯會名單選的；沒選是空字串。 */
  stake: string;
  /** 支會（傳教士不選支會）；沒選是空字串。 */
  ward: string;
  /** 傳教士的服務地區（例如高雄傳道部）；沒填是空字串。 */
  serviceArea: string;
  /** 所在的教堂（對應到課程時是課程的教堂）；沒選是 null，只在「全部」最後出現。 */
  venueId: string | null;
  name: string;
  /** 照片的公開網址；沒有照片是 null。 */
  photoUrl: string | null;
  /** 照片裁成圓形時對準的高度，0 是最上面、100 是最下面。 */
  photoFocus: number;
  /** 課程名稱（對應到課程時是課程的名稱）或作品名稱；沒有是空字串。 */
  courseTitle: string;
  /** 個人介紹頁的文字：介紹與簡介一段一個，大綱一行一點；沒寫是空陣列。 */
  sections: Record<PersonSection, string[]>;
};

/** highlight_people_units 的一列：一位人物所選的支聯會、支會名稱（只選支聯會時支會是 null）。 */
type PersonUnit = {
  id: string;
  stake_zh: string;
  stake_en: string;
  ward_zh: string | null;
  ward_en: string | null;
};

/** 介紹頁要顯示的一項大會特色，已依語言挑好（英文缺漏時是中文）。 */
export type Highlight = {
  id: string;
  name: string;
  /** 簡介；沒寫是空字串。 */
  description: string;
  /** 教堂分頁，照場地的順序；只有有說明或有課程的教堂。選了版型的不用，是空陣列。 */
  venues: HighlightVenue[];
  /** 版型；一般的介紹頁是 null。 */
  template: PageTemplate | null;
  /** 以下是版型用的，沒填是空字串。副標兩種版型都有。 */
  subtitle: string;
  leadQuote: string;
  leadQuoteSource: string;
  /** 人物，照排序。 */
  people: HighlightPerson[];
  /** 人物卡片分組用的教堂，照場地的順序（含沒有人的教堂，由頁面決定顯示哪些）。 */
  peopleVenues: { id: string; name: string }[];
  /** 圖文型：活動圖片與圖片說明；沒有圖是 null。 */
  image: { url: string; alt: string } | null;
  /** 圖文型：介紹內容最後放大的一句結語；沒寫是空字串。 */
  closing: string;
  /** 圖文型：有各教堂頁（範本 C）的教堂，照場地的順序。 */
  venuePages: { id: string; name: string }[];
};

/** 個人介紹頁有沒有東西可寫：這個版型要顯示的段落有一段有寫。卡片的按鈕只在有的時候出現。 */
export function hasPersonPage(person: HighlightPerson, template: CardTemplate): boolean {
  return PERSON_SECTIONS[template].some((section) => person.sections[section].length > 0);
}

/** 介紹頁的一個教堂分頁：這間教堂的說明，與分在這項大會特色底下的課程（照場次、課程的順序）。 */
export type HighlightVenue = {
  id: string;
  name: string;
  /** 沒寫是空字串。 */
  body: string;
  /** 教室不公開（GLOSSARY「教室」），所以沒有教室。 */
  courses: { title: string; speaker: string; sessionName: string }[];
};

/**
 * 讀取目前年度的一項大會特色。不是目前年度的、找不到的、介紹頁沒有內容的都回傳 null（介紹頁顯示「找不到」）。
 * 公告上線前要不要顯示，由頁面判斷。
 */
export async function getHighlight(supabase: SupabaseClient, id: string, locale: Locale): Promise<Highlight | null> {
  // 網址被改過、不是編號的，不必交給資料庫。
  if (!UUID_PATTERN.test(id)) return null;
  const { data, error } = await supabase
    .from("highlights")
    .select(
      `id, conference_id, name_zh, name_en, description_zh, description_en, page_template,
      subtitle_zh, subtitle_en, lead_quote_zh, lead_quote_en, lead_quote_source_zh, lead_quote_source_en,
      image_path, image_alt_zh, image_alt_en, closing_zh, closing_en,
      highlight_venues(venue_id, body_zh, body_en, show_title_zh, poster_path), highlight_venue_team(venue_id),
      highlight_people(id, service_area_zh, service_area_en, name_zh, name_en, photo_path, photo_focus, venue_id,
        course_title_zh, course_title_en, bio_zh, bio_en, summary_zh, summary_en, outline_zh, outline_en,
        courses(title_zh, title_en, sessions(venue_id))),
      conferences!inner(is_current)`,
    )
    .eq("id", id)
    .eq("conferences.is_current", true)
    .order("position", { referencedTable: "highlight_people" })
    .order("id", { referencedTable: "highlight_people" })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const description = data.description_zh.trim() === "" ? "" : localized(data, "description", locale);

  const noFeature = { image: null, closing: "", venuePages: [] };
  if (isFeatureTemplate(data.page_template)) {
    const venueRows = await supabase
      .from("venues")
      .select("id, name_zh, name_en")
      .eq("conference_id", data.conference_id)
      .order("position")
      .order("id");
    if (venueRows.error) throw venueRows.error;
    const venuePages = venueRows.data
      .filter((venue) =>
        hasVenuePage(
          data.highlight_venues.find((row) => row.venue_id === venue.id),
          data.highlight_venue_team.filter((member) => member.venue_id === venue.id).length,
        ),
      )
      .map((venue) => ({ id: venue.id, name: localized(venue, "name", locale) }));
    if (description === "" && !data.image_path && venuePages.length === 0) return null;
    return {
      id: data.id,
      name: localized(data, "name", locale),
      description,
      venues: [],
      template: data.page_template,
      subtitle: localized(data, "subtitle", locale),
      leadQuote: "",
      leadQuoteSource: "",
      people: [],
      peopleVenues: [],
      image: data.image_path
        ? { url: highlightImageUrl(supabase, data.image_path), alt: localized(data, "image_alt", locale) }
        : null,
      closing: localized(data, "closing", locale).trim(),
      venuePages,
    };
  }
  if (data.page_template) {
    if (description === "" && data.highlight_people.length === 0) return null;
    // 支聯會、支會可能已經停用，訪客直接讀名單讀不到，改用資料庫函式讀名稱。
    const [rows, venueRows] = await Promise.all([
      supabase.rpc("highlight_people_units", { p_highlight_id: id }),
      supabase.from("venues").select("id, name_zh, name_en").eq("conference_id", data.conference_id).order("position").order("id"),
    ]);
    if (rows.error) throw rows.error;
    if (venueRows.error) throw venueRows.error;
    const units = new Map((rows.data as PersonUnit[]).map((unit) => [unit.id, unit]));
    return {
      id: data.id,
      name: localized(data, "name", locale),
      description,
      venues: [],
      template: data.page_template as PageTemplate,
      subtitle: localized(data, "subtitle", locale),
      leadQuote: localized(data, "lead_quote", locale),
      leadQuoteSource: localized(data, "lead_quote_source", locale),
      people: data.highlight_people.map((person) => {
        const unit = units.get(person.id);
        // 一位人物只對到一門課，讀出來是物件不是陣列。
        const course = person.courses as unknown as
          | ({ sessions: { venue_id: string } | null } & LocalizedRow<"title">)
          | null;
        return {
          id: person.id,
          stake: unit ? localized(unit, "stake", locale) : "",
          ward: unit?.ward_zh ? localized(unit, "ward", locale) : "",
          serviceArea: localized(person, "service_area", locale).trim(),
          venueId: course?.sessions?.venue_id ?? person.venue_id,
          name: localized(person, "name", locale),
          photoUrl: person.photo_path && highlightImageUrl(supabase, person.photo_path),
          photoFocus: person.photo_focus,
          courseTitle: (course ? localized(course, "title", locale) : localized(person, "course_title", locale)).trim(),
          sections: {
            bio: textLines(localized(person, "bio", locale)),
            summary: textLines(localized(person, "summary", locale)),
            outline: textLines(localized(person, "outline", locale)).map((line) => line.replace(OUTLINE_MARKER, "")),
          },
        };
      }),
      peopleVenues: venueRows.data.map((venue) => ({ id: venue.id, name: localized(venue, "name", locale) })),
      ...noFeature,
    };
  }
  const venueRows = await supabase
    .from("venues")
    .select("id, name_zh, name_en, sessions(name_zh, name_en, courses(title_zh, title_en, speaker_zh, speaker_en, highlight_id))")
    .eq("conference_id", data.conference_id)
    .order("position")
    .order("id")
    .order("position", { referencedTable: "sessions" })
    .order("id", { referencedTable: "sessions" })
    .order("position", { referencedTable: "sessions.courses" })
    .order("id", { referencedTable: "sessions.courses" });
  if (venueRows.error) throw venueRows.error;

  const venues = venueRows.data
    .map((venue): HighlightVenue => {
      const text = data.highlight_venues.find((row) => row.venue_id === venue.id);
      return {
        id: venue.id,
        name: localized(venue, "name", locale),
        // 中文沒寫就當成沒有說明（和簡介一樣，英文版沒有英文時顯示中文）。
        body: text && text.body_zh.trim() !== "" ? localized(text, "body", locale) : "",
        courses: venue.sessions.flatMap((session) =>
          session.courses
            // 用資料庫讀出的編號比對：網址的編號可能是大寫。
            .filter((course) => course.highlight_id === data.id)
            .map((course) => ({
              title: localized(course, "title", locale),
              speaker: localized(course, "speaker", locale),
              sessionName: localized(session, "name", locale),
            })),
        ),
      };
    })
    .filter((venue) => venue.body !== "" || venue.courses.length > 0);
  // 和 hasHighlightPage 同一個規則，但看實際要顯示的分頁：兩次讀取之間換了目前年度時，場地讀不到，
  // 只有教堂說明的就沒東西可看，要顯示找不到，不能是一頁空白。
  if (description === "" && venues.length === 0) return null;
  return {
    id: data.id,
    name: localized(data, "name", locale),
    description,
    venues,
    template: null,
    subtitle: "",
    leadQuote: "",
    leadQuoteSource: "",
    people: [],
    peopleVenues: [],
    ...noFeature,
  };
}

type LocalizedRow<F extends string> = Record<`${F}_zh` | `${F}_en`, string>;
type CourseRow = { id: string; highlight_id: string | null } & LocalizedRow<"title" | "speaker">;
type SessionRow = { id: string; courses: { id: string }[] } & LocalizedRow<"name">;

/**
 * 一個場次的課程依分類分組：分類照「大會有什麼」的順序，沒有分類的放最後；組內照課程的順序。
 * 連續兩堂的另一堂在同一間教堂；場次排在前面的是前面那一堂（同一門課不會出現在兩組，資料庫擋下）。
 */
function groupCourses(
  courses: CourseRow[],
  sessions: SessionRow[],
  highlights: ({ id: string } & LocalizedRow<"name">)[],
  pairs: { first_course_id: string; second_course_id: string }[],
  highlightLink: (id: string | null) => string | null,
  locale: Locale,
): CourseGroup[] {
  const sessionIndex = (courseId: string) => sessions.findIndex((s) => s.courses.some((c) => c.id === courseId));
  const pairedWith = (course: CourseRow): AgendaCourse["pairedWith"] => {
    const pair = pairs.find((p) => p.first_course_id === course.id || p.second_course_id === course.id);
    if (!pair) return null;
    const otherId = pair.first_course_id === course.id ? pair.second_course_id : pair.first_course_id;
    const [mine, other] = [sessionIndex(course.id), sessionIndex(otherId)];
    // 另一堂不在這間教堂（不該發生）時，當成不是連續兩堂。
    if (other < 0) return null;
    return { sessionName: localized(sessions[other], "name", locale), isSecond: other < mine };
  };
  const toCourse = (course: CourseRow): AgendaCourse => ({
    title: localized(course, "title", locale),
    speaker: localized(course, "speaker", locale),
    pairedWith: pairedWith(course),
  });

  const groups: CourseGroup[] = highlights
    .map((highlight) => ({
      category: { name: localized(highlight, "name", locale), highlightId: highlightLink(highlight.id) },
      courses: courses.filter((course) => course.highlight_id === highlight.id).map(toCourse),
    }))
    .filter((group) => group.courses.length > 0);
  const uncategorized = courses.filter((course) => !highlights.some((h) => h.id === course.highlight_id));
  return uncategorized.length > 0 ? [...groups, { category: null, courses: uncategorized.map(toCourse) }] : groups;
}

/** 範本 C 的一位團隊成員，已依語言挑好（英文缺漏時是中文）。 */
export type TeamMember = {
  id: string;
  /** 事工，例如指揮、司琴；沒填是空字串。 */
  role: string;
  name: string;
  photoUrl: string | null;
  photoFocus: number;
  /** 人物介紹，一行一段。 */
  bio: string[];
};

/** 範本 C：圖文型大會特色在一間教堂的頁面，已依語言挑好。 */
export type VenuePage = {
  highlight: { id: string; name: string; template: FeatureTemplate };
  venue: { id: string; name: string };
  /** 節目名稱，例如〈妳是我的寶〉；沒寫是空字串。 */
  showTitle: string;
  poster: { url: string; alt: string } | null;
  /** 製作靈感（Markdown）；沒寫是空字串。 */
  inspiration: string;
  team: TeamMember[];
  /** 有教堂頁的教堂（含這一間），照場地的順序，給切換其他教堂用。 */
  venues: { id: string; name: string }[];
};

/**
 * 讀取目前年度一項圖文型大會特色在一間教堂的頁面。不是圖文型的、不是目前年度的、找不到的、
 * 這間教堂沒有內容的都回傳 null。公告上線前要不要顯示，由頁面判斷。
 */
export async function getVenuePage(
  supabase: SupabaseClient,
  highlightId: string,
  venueId: string,
  locale: Locale,
): Promise<VenuePage | null> {
  const highlight = await getHighlight(supabase, highlightId, locale);
  if (!highlight || !isFeatureTemplate(highlight.template)) return null;
  // 網址的編號可能是大寫。
  const venue = highlight.venuePages.find((candidate) => candidate.id === venueId.toLowerCase());
  if (!venue) return null;
  const [page, team] = await Promise.all([
    supabase
      .from("highlight_venues")
      .select("body_zh, body_en, show_title_zh, show_title_en, poster_path, poster_alt_zh, poster_alt_en")
      .eq("highlight_id", highlight.id)
      .eq("venue_id", venue.id)
      .maybeSingle(),
    supabase
      .from("highlight_venue_team")
      .select("id, role_zh, role_en, name_zh, name_en, photo_path, photo_focus, bio_zh, bio_en")
      .eq("highlight_id", highlight.id)
      .eq("venue_id", venue.id)
      .order("position")
      .order("id"),
  ]);
  if (page.error) throw page.error;
  if (team.error) throw team.error;
  const row = page.data;
  return {
    highlight: { id: highlight.id, name: highlight.name, template: highlight.template },
    venue,
    showTitle: row && row.show_title_zh.trim() !== "" ? localized(row, "show_title", locale).trim() : "",
    poster: row?.poster_path
      ? { url: highlightImageUrl(supabase, row.poster_path), alt: localized(row, "poster_alt", locale) }
      : null,
    // 中文沒寫就當成沒有（和教堂說明一樣）。
    inspiration: row && row.body_zh.trim() !== "" ? localized(row, "body", locale) : "",
    team: team.data.map((member) => ({
      id: member.id,
      role: localized(member, "role", locale).trim(),
      name: localized(member, "name", locale),
      photoUrl: member.photo_path && highlightImageUrl(supabase, member.photo_path),
      photoFocus: member.photo_focus,
      bio: textLines(localized(member, "bio", locale)),
    })),
    venues: highlight.venuePages,
  };
}

// 個人介紹頁的純文字一行一段（大綱一行一點），空行不算。
function textLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

// 大綱前面自己打的編號或項目符號（「1.」「1、」「1)」「•」「- 」），頁面已經會編號。
// 正文開頭的小數（3.5 公分）、負號（-5°C）不算：點後面接數字的不是編號，- 與 * 後面要有空白。
const OUTLINE_MARKER = /^(\d+(?:[.．](?!\d)|[、)）])|[•・]|[-*](?=\s))\s*/;

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
