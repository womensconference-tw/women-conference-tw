// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../test/supabase";
import { HomePage } from "./home-page";

// 頁面在伺服器上讀 cookie 的部分換掉：用訪客的連線讀資料、語言由測試決定、語言切換按鈕不畫。
let locale: Locale = "zh";
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => locale, getMessages: async () => messages[locale] }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;
let previousCurrentIds: string[] = [];
let fixtureId: string | undefined;

// 2099 年度大會設成目前年度（報名前），有主題經文、歡迎詞與署名。測完復原。
beforeEach(async () => {
  locale = "zh";
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));
  const now = Date.now();
  fixtureId = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: new Date(now - 2 * DAY).toISOString(),
        registration_opens_at: new Date(now + DAY).toISOString(),
        registration_closes_at: new Date(now + 2 * DAY).toISOString(),
        theme_scripture_zh: "你要把你的重擔卸給耶和華",
        welcome_zh: "歡迎姐妹們",
        welcome_signature_zh: "2099台灣姐妹大會籌備委員會",
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
});

afterEach(async () => {
  cleanup();
  if (fixtureId) must(await admin.from("conferences").delete().eq("id", fixtureId));
  fixtureId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

/** 伺服器元件：一路呼叫到畫面元素，再畫出來。 */
async function renderPage(page: ReactElement | Promise<ReactElement>) {
  let element = await page;
  while (typeof element.type === "function") {
    element = await (element.type as (props: unknown) => ReactElement | Promise<ReactElement>)(element.props);
  }
  render(element);
}

const path = (prefix: string) => `${fixtureId}/${prefix}-${crypto.randomUUID()}.png`;

describe("首頁主視覺", () => {
  it("四張都沒有時沒有圖，用文字顯示主題經文；歡迎詞最後有署名", async () => {
    await renderPage(HomePage({ preview: false }));

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("你要把你的重擔卸給耶和華")).toBeTruthy();
    expect(screen.getByText("2099台灣姐妹大會籌備委員會").className).toContain("text-right");
  });

  it("有圖時：手機寬度用手機版、電腦寬度用電腦版，圖片說明給螢幕閱讀器；主題經文不再用文字重複", async () => {
    const [mobile, desktop] = [path("mobile-zh"), path("desktop-zh")];
    must(
      await admin
        .from("conferences")
        .update({ hero_alt_zh: "2099 主視覺", hero_mobile_zh_path: mobile, hero_desktop_zh_path: desktop })
        .eq("id", fixtureId!),
    );

    await renderPage(HomePage({ preview: false }));

    const image = screen.getByRole<HTMLImageElement>("img", { name: "2099 主視覺" });
    expect(image.getAttribute("src")).toContain(mobile);
    const source = image.closest("picture")!.querySelector("source")!;
    expect(source.getAttribute("media")).toBe("(min-width: 48rem)");
    expect(source.getAttribute("srcset")).toContain(desktop);
    expect(screen.queryByText("你要把你的重擔卸給耶和華")).toBeNull();
  });

  it("只有電腦版的圖時：手機不下載電腦版，手機上隱藏圖、改用文字顯示主題經文", async () => {
    const desktop = path("desktop-zh");
    must(await admin.from("conferences").update({ hero_alt_zh: "2099 主視覺", hero_desktop_zh_path: desktop }).eq("id", fixtureId!));

    await renderPage(HomePage({ preview: false }));

    const image = screen.getByRole<HTMLImageElement>("img", { name: "2099 主視覺" });
    // 手機用的是不用下載的透明小圖，電腦版只在寬螢幕的來源裡。
    expect(image.getAttribute("src")).toMatch(/^data:image\/gif;base64,/);
    const picture = image.closest("picture")!;
    expect(picture.className).toBe("hidden md:block");
    expect(picture.querySelector("source")!.getAttribute("srcset")).toContain(desktop);
    expect(screen.getByText("你要把你的重擔卸給耶和華").closest("figure")!.className).toContain("md:hidden");
  });

  it("英文版沒有英文圖就用中文圖", async () => {
    const mobile = path("mobile-zh");
    must(
      await admin
        .from("conferences")
        .update({ hero_alt_zh: "2099 主視覺", hero_alt_en: "2099 key visual", hero_mobile_zh_path: mobile })
        .eq("id", fixtureId!),
    );
    locale = "en";

    await renderPage(HomePage({ preview: false }));

    const image = screen.getByRole<HTMLImageElement>("img", { name: "2099 key visual" });
    expect(image.getAttribute("src")).toContain(mobile);
    expect(image.closest("picture")!.querySelector("source")!.getAttribute("srcset")).toContain(mobile);
  });
});

const insert = async (table: string, row: Record<string, unknown>) =>
  must(await admin.from(table).insert({ conference_id: fixtureId, ...row }).select("id").single()).id as string;

/** 報名開放與截止時間（台灣時間），都在 2026-01-01 公告之後。報名開放後不能新增場地，要先建好。 */
async function setSchedule(opensAt: string, closesAt: string) {
  must(
    await admin
      .from("conferences")
      .update({ announce_at: "2026-01-01T00:00:00+08:00", registration_opens_at: opensAt, registration_closes_at: closesAt })
      .eq("id", fixtureId!),
  );
}

describe("首頁區塊", () => {
  it("依新設計的順序：主視覺、狀態列、歡迎詞、大會有什麼、大會程序、報名、常見問題、需要幫忙、自訂區塊", async () => {
    await insert("highlights", { name_zh: "即席唱詩班" });
    await insert("venues", { region: "north", name_zh: "台北金華教堂" });
    await insert("faqs", { question_zh: "要帶什麼？", answer_zh: "經文" });
    await insert("custom_blocks", { title_zh: "交通資訊" });
    await insert("agenda_items", { start_time: "08:30", end_time: "09:15", name_zh: "報到" });

    await renderPage(HomePage({ preview: false }));

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "歡迎來到姐妹大會",
      "大會有什麼",
      "大會程序",
      "報名參加",
      "常見問題",
      "需要幫忙嗎？",
      "交通資訊",
    ]);
    // 沒有主視覺圖時，主題經文在最上面、狀態列前面。
    const text = document.body.textContent!;
    expect(text.indexOf("你要把你的重擔卸給耶和華")).toBeLessThan(text.indexOf("開放報名"));
    expect(text.indexOf("開放報名")).toBeLessThan(text.indexOf("歡迎姐妹們"));
    // 電腦版 Header 的頁內連結都跳得到。
    const nav = screen.getByRole("navigation", { name: "頁面內容" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["認識大會", "大會程序", "報名與查詢", "聯絡管理員"]);
    for (const link of links) expect(document.querySelector(link.getAttribute("href")!), link.textContent!).not.toBeNull();
    expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: "回到最上面" }).getAttribute("href")).toBe("#top");
    expect(document.getElementById("top")).not.toBeNull();
  });

  it("沒有歡迎詞、大會特色、場地、常見問題時，這幾區與頁內連結都不顯示", async () => {
    must(await admin.from("conferences").update({ welcome_zh: "" }).eq("id", fixtureId!));

    await renderPage(HomePage({ preview: false }));

    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "報名參加",
      "需要幫忙嗎？",
    ]);
    const nav = screen.getByRole("navigation", { name: "頁面內容" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#register", "#help"]);
  });
});

describe("狀態列與報名區", () => {
  it("報名前：狀態列寫開放日期，報名區是說明卡，沒有報名與查詢按鈕", async () => {
    await setSchedule("2099-04-01T09:00:00+08:00", "2099-05-01T00:00:00+08:00");

    await renderPage(HomePage({ preview: false }));

    expect(screen.getByText("4月1日（星期三）開放報名")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "報名還沒開始" })).toBeTruthy();
    expect(screen.getByText("開放報名：4月1日（星期三） 上午9:00")).toBeTruthy();
    expect(screen.getByText("報名截止：5月1日（星期五） 上午12:00")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "前往報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "我要報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^查詢/ })).toBeNull();
  });

  it("報名中：狀態列寫截止日期與「前往報名」（捲到報名區），報名區有三步驟、報名、代報與查詢", async () => {
    // 截止在 1/14 00:00，姐妹可以報到 1/13，只寫日期時寫 1/13。
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");

    await renderPage(HomePage({ preview: false }));

    expect(screen.getByText("報名中・截止 1/13")).toBeTruthy();
    expect(screen.getByRole("link", { name: "前往報名" }).getAttribute("href")).toBe("#register");
    const register = document.getElementById("register")!;
    expect(within(register).getByRole("heading", { name: "現在可以報名" })).toBeTruthy();
    expect(within(register).getAllByRole("listitem")).toHaveLength(3);
    expect(within(register).getByRole("link", { name: "我要報名" }).getAttribute("href")).toBe("/register");
    expect(within(register).getByRole("link", { name: "幫家人或朋友報名" }).getAttribute("href")).toBe(
      "/register?for=others",
    );
    expect(within(register).getByText(/1月13日（星期二）以前都可以自己修改。$/)).toBeTruthy();
    expect(within(register).getByRole("link", { name: "查詢或修改我的報名" }).getAttribute("href")).toBe("/lookup");
  });

  it("已截止：狀態列寫已截止與「查詢我的報名」，報名區只有說明與查詢", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2026-02-01T00:00:00+08:00");

    await renderPage(HomePage({ preview: false }));

    expect(screen.getByText("報名已截止")).toBeTruthy();
    const [statusLink, registerLink] = screen.getAllByRole("link", { name: "查詢我的報名" });
    expect(statusLink.getAttribute("href")).toBe("#register");
    expect(registerLink.getAttribute("href")).toBe("/lookup");
    expect(screen.getByRole("heading", { name: "報名已經截止" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "我要報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "幫家人或朋友報名" })).toBeNull();
  });

  it("英文版：狀態列、報名區、大會程序都是英文", async () => {
    await insert("venues", { region: "north", name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" });
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");
    locale = "en";

    await renderPage(HomePage({ preview: false }));

    expect(screen.getByText("Registration open · closes Jan 13")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to registration" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "Welcome to the Women's Conference",
      "Programme",
      "Register",
      "Need help?",
    ]);
    expect(screen.getByRole("button", { name: "Taipei Jinhua Chapel" })).toBeTruthy();
    expect(screen.getByText(/You can change it yourself until Tuesday, January 13\.$/)).toBeTruthy();
  });
});

describe("大會程序", () => {
  let jinhua: string;
  let daya: string;

  // 金華有兩個場次接到時間軸，大雅一個；金華的課程有教室，首頁不能顯示。
  beforeEach(async () => {
    jinhua = await insert("venues", { position: 1, region: "north", name_zh: "台北金華教堂", address_zh: "台北市金華街" });
    daya = await insert("venues", { position: 2, region: "central", name_zh: "台中大雅教堂", address_zh: "台中市大雅區" });
    const [first, second, dayaFirst] = [
      await insert("sessions", { venue_id: jinhua, position: 1, name_zh: "第一場次" }),
      await insert("sessions", { venue_id: jinhua, position: 2, name_zh: "第二場次" }),
      await insert("sessions", { venue_id: daya, position: 1, name_zh: "第一場次" }),
    ];
    const course = await insert("courses", { session_id: first, title_zh: "我會傾聽", speaker_zh: "錢繁萱" });
    must(await admin.from("course_classrooms").insert({ course_id: course, classroom: "三樓福研" }));
    await insert("courses", { session_id: second, title_zh: "寫下生活" });
    await insert("courses", { session_id: second, title_zh: "大會堂唱詩班之旅" });
    await insert("courses", { session_id: dayaFirst, title_zh: "沈思的力量" });
    const [opening, row1, row2] = [
      await insert("agenda_items", { position: 1, start_time: "09:30", end_time: "10:30", name_zh: "開幕式" }),
      await insert("agenda_items", { position: 2, start_time: "11:00", end_time: "11:50", name_zh: "第一場次" }),
      await insert("agenda_items", { position: 3, start_time: "13:30", end_time: "14:15", name_zh: "第二場次" }),
    ];
    const setting = async (agendaItem: string, venue: string, extra: Record<string, unknown>) =>
      must(
        await admin
          .from("agenda_item_venues")
          .insert({ conference_id: fixtureId, agenda_item_id: agendaItem, venue_id: venue, ...extra }),
      );
    await setting(opening, jinhua, { place_zh: "一樓大會堂" });
    await setting(opening, daya, { place_zh: "3F 大會堂" });
    await setting(row1, jinhua, { session_id: first });
    await setting(row2, jinhua, { session_id: second });
    await setting(row1, daya, { session_id: dayaFirst });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("預設第一間教堂：地址、地圖、時間軸與課程講師，不顯示教室；手機只展開第一個場次", async () => {
    await renderPage(HomePage({ preview: false }));

    const agenda = document.getElementById("agenda")!;
    expect(within(agenda).getByRole("button", { name: "台北金華教堂" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(agenda).getByRole("button", { name: "台中大雅教堂" }).getAttribute("aria-pressed")).toBe("false");
    expect(within(agenda).getByRole("heading", { name: "台北金華教堂" })).toBeTruthy();
    expect(within(agenda).getByText("台北市金華街")).toBeTruthy();
    expect(within(agenda).getByRole("link", { name: "開啟地圖導航" }).getAttribute("href")).toContain(
      encodeURIComponent("台北市金華街"),
    );
    expect(within(agenda).getByText("一樓大會堂")).toBeTruthy();
    expect(within(agenda).getByText("錢繁萱")).toBeTruthy();
    expect(document.body.textContent).not.toContain("三樓福研");
    const [first, second] = agenda.querySelectorAll("details");
    expect(first.open).toBe(true);
    expect(second.open).toBe(false);
    expect(second.querySelector("summary")!.textContent).toContain("看 2 個選項");
  });

  it("電腦寬度：所有場次都展開", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 48rem)",
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    await renderPage(HomePage({ preview: false }));

    const details = [...document.getElementById("agenda")!.querySelectorAll("details")];
    expect(details.map((element) => element.open)).toEqual([true, true]);
  });

  it("按另一間教堂的按鈕，就在畫面上換成那間教堂的地址、地點與課程", async () => {
    await renderPage(HomePage({ preview: false }));

    const agenda = document.getElementById("agenda")!;
    fireEvent.click(within(agenda).getByRole("button", { name: "台中大雅教堂" }));

    expect(within(agenda).getByRole("button", { name: "台中大雅教堂" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(agenda).getByRole("heading", { name: "台中大雅教堂" })).toBeTruthy();
    expect(within(agenda).getByText("台中市大雅區")).toBeTruthy();
    expect(within(agenda).getByText("3F 大會堂")).toBeTruthy();
    expect(within(agenda).getByText("沈思的力量")).toBeTruthy();
    expect(within(agenda).queryByText("我會傾聽")).toBeNull();
  });
});
