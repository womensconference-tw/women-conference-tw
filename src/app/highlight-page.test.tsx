// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../test/supabase";
import { HighlightPage } from "./highlight-page";
import { HighlightVenues } from "./highlight-venues";
import { HomePage } from "./home-page";
import { PersonPage } from "./person-page";
import { VenuePage } from "./venue-page";

// 頁面在伺服器上讀 cookie 的部分換掉：用訪客的連線讀資料、語言由測試決定、語言切換按鈕不畫。
let locale: Locale = "zh";
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => locale, getMessages: async () => messages[locale] }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;
let previousCurrentIds: string[] = [];
let fixtureId: string | undefined;
let choirId: string;
let exhibitionId: string;

// 2099 年度大會設成目前年度，有兩項大會特色：寫了介紹內容的即席唱詩班、沒寫的靜態展示。測完復原。
async function arrange(announced: boolean) {
  const now = Date.now();
  fixtureId = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: new Date(now + (announced ? -2 : 1) * DAY).toISOString(),
        registration_opens_at: new Date(now + 2 * DAY).toISOString(),
        registration_closes_at: new Date(now + 3 * DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
  const insert = async (row: Record<string, unknown>) =>
    must(await admin.from("highlights").insert({ conference_id: fixtureId, ...row }).select("id").single()).id as string;
  choirId = await insert({
    position: 1,
    name_zh: "即席唱詩班",
    name_en: "Impromptu choir",
    summary_zh: "跟著影片練唱",
    description_zh: [
      "## 練唱",
      "先看[練唱影片](https://www.youtube.com/watch?v=1)",
      "<script>alert(1)</script>",
      "[危險連結](javascript:alert(1))",
    ].join("\n\n"),
  });
  exhibitionId = await insert({ position: 2, name_zh: "靜態展示" });
}

beforeEach(async () => {
  locale = "zh";
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));
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

describe("介紹頁", () => {
  it("顯示名稱與排好的介紹內容；HTML 和不安全的連結不會變成頁面上的元素", async () => {
    await arrange(true);

    await renderPage(HighlightPage({ id: choirId, preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("即席唱詩班");
    expect(screen.getByRole("heading", { name: "練唱" })).toBeTruthy();
    const video = screen.getByRole("link", { name: /練唱影片/ });
    expect(video.getAttribute("href")).toBe("https://www.youtube.com/watch?v=1");
    expect(video.getAttribute("target")).toBe("_blank");
    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "危險連結" })).toBeNull();
    expect(screen.getByText("危險連結")).toBeTruthy();
    expect(screen.getByRole("link", { name: messages.zh.highlight.backHome }).getAttribute("href")).toBe("/");
    expect(screen.queryByText(/預覽模式/)).toBeNull();
  });

  it("英文版：名稱用英文，介紹內容英文沒填時顯示中文，連結的提示也是英文", async () => {
    await arrange(true);
    locale = "en";

    await renderPage(HighlightPage({ id: choirId, preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Impromptu choir");
    expect(screen.getByRole("link", { name: /^練唱影片\s*\(opens in a new tab\)$/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: messages.en.highlight.backHome })).toBeTruthy();
  });

  it("沒寫介紹內容的、找不到的，顯示找不到", async () => {
    await arrange(true);

    await expect(renderPage(HighlightPage({ id: exhibitionId, preview: false }))).rejects.toThrow("not found");
    await expect(renderPage(HighlightPage({ id: crypto.randomUUID(), preview: false }))).rejects.toThrow("not found");
  });

  it("公告上線前：前台找不到，預覽看得到，回首頁回到預覽首頁", async () => {
    await arrange(false);

    await expect(renderPage(HighlightPage({ id: choirId, preview: false }))).rejects.toThrow("not found");

    await renderPage(HighlightPage({ id: choirId, preview: true }));
    expect(screen.getByRole("status").textContent).toBe(messages.zh.preview.highlight);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("即席唱詩班");
    expect(screen.getByRole("link", { name: messages.zh.highlight.backHome }).getAttribute("href")).toBe("/preview");
  });
});

describe("介紹頁的教堂分頁", () => {
  // 靜態展示沒有簡介：金華有說明（夾帶 HTML 與危險連結）、大雅只有課程、鳥松什麼都沒有。
  async function arrangeVenues() {
    await arrange(true);
    const venue = async (position: number, name_zh: string) =>
      must(
        await admin.from("venues").insert({ conference_id: fixtureId, position, region: "north", name_zh }).select("id").single(),
      ).id as string;
    const jinhua = await venue(1, "台北金華教堂");
    const daya = await venue(2, "台中大雅教堂");
    await venue(3, "高雄鳥松教堂");
    must(
      await admin.from("highlight_venues").insert({
        conference_id: fixtureId,
        highlight_id: exhibitionId,
        venue_id: jinhua,
        body_zh: "展示在**一樓大廳**\n\n<script>alert(1)</script>\n\n[危險連結](javascript:alert(1))",
      }),
    );
    const session = must(
      await admin.from("sessions").insert({ conference_id: fixtureId, venue_id: daya, name_zh: "第一場次" }).select("id").single(),
    ).id;
    const course = must(
      await admin
        .from("courses")
        .insert({ conference_id: fixtureId, session_id: session, title_zh: "手作展示", speaker_zh: "王淑娟", highlight_id: exhibitionId })
        .select("id")
        .single(),
    ).id;
    must(await admin.from("course_classrooms").insert({ course_id: course, classroom: "201 教室" }));
  }

  it("只有有內容的教堂出現按鈕，按了切換；說明的 HTML 和危險連結不會變成元素，課程不帶教室", async () => {
    await arrangeVenues();

    await renderPage(HighlightPage({ id: exhibitionId, preview: false }));

    const picker = screen.getByRole("group", { name: messages.zh.highlight.venuePickerLabel });
    const buttons = within(picker).getAllByRole("button");
    expect(buttons.map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["台北金華教堂", "true"],
      ["台中大雅教堂", "false"],
    ]);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("台北金華教堂");
    expect(screen.getByText("一樓大廳").tagName).toBe("STRONG");
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByRole("link", { name: "危險連結" })).toBeNull();

    fireEvent.click(buttons[1]);
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("台中大雅教堂");
    expect(screen.getByText("手作展示")).toBeTruthy();
    expect(screen.getByText("王淑娟")).toBeTruthy();
    expect(screen.queryByText(/201/)).toBeNull();
  });

  it("關掉 JavaScript 時（伺服器畫的）每間教堂都依序顯示，沒有按了不會動的按鈕", async () => {
    await arrangeVenues();
    let element = await HighlightPage({ id: exhibitionId, preview: false });
    while (typeof element.type === "function") {
      element = await (element.type as (props: unknown) => ReactElement | Promise<ReactElement>)(element.props);
    }

    const html = renderToString(element);

    expect(html).toContain("台北金華教堂");
    expect(html).toContain("手作展示");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("hidden");
  });

  it("選的教堂在重新讀資料後不見了（例如管理員清空說明後切換語言），回到第一間，不會整區空白", async () => {
    const venue = (id: string, name: string) => ({ id, name, body: `${name}的說明`, courses: [] });
    const venues = [venue("a", "金華"), venue("b", "大雅"), venue("c", "鳥松")];
    const { rerender } = render(<HighlightVenues venues={venues} locale="zh" />);

    fireEvent.click(screen.getByRole("button", { name: "鳥松" }));
    rerender(<HighlightVenues venues={venues.slice(0, 2)} locale="zh" />);

    expect(screen.getByRole("button", { name: "金華" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("金華");

    // 選的那間還在時，換了順序照樣選著它。
    fireEvent.click(screen.getByRole("button", { name: "大雅" }));
    rerender(<HighlightVenues venues={[venues[1], venues[0]]} locale="zh" />);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("大雅");
  });

  it("網址的編號是大寫也找得到，課程照樣列出", async () => {
    await arrangeVenues();

    await renderPage(HighlightPage({ id: exhibitionId.toUpperCase(), preview: false }));

    fireEvent.click(screen.getByRole("button", { name: "台中大雅教堂" }));
    expect(screen.getByText("手作展示")).toBeTruthy();
  });

  it("首頁卡片：只有教堂分頁的大會特色也能點", async () => {
    await arrangeVenues();

    await renderPage(HomePage({ preview: false }));

    const section = screen.getByRole("heading", { name: messages.zh.home.highlightsHeading }).closest("section")!;
    expect(within(section).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      `/highlights/${choirId}`,
      `/highlights/${exhibitionId}`,
    ]);
  });
});

describe("介紹頁的人物版型", () => {
  let taipeiStakeId: string;
  let luzhouWardId: string;
  let shaluWardId: string;
  let taichungStakeId: string;

  beforeEach(async () => {
    const stake = async (row: Record<string, unknown>) => must(await admin.from("stakes").insert(row).select("id").single()).id as string;
    const ward = async (row: Record<string, unknown>) => must(await admin.from("wards").insert(row).select("id").single()).id as string;
    taipeiStakeId = await stake({ region: "north", name_zh: "測試中台北支聯會" });
    luzhouWardId = await ward({ stake_id: taipeiStakeId, name_zh: "測試蘆洲支會" });
    taichungStakeId = await stake({ region: "central", name_zh: "測試西台中支聯會" });
    shaluWardId = await ward({ stake_id: taichungStakeId, name_zh: "測試沙鹿支會", name_en: "Test Shalu Ward" });
  });

  afterEach(async () => {
    // 人物指向測試的支聯會，先刪人物（年度大會在最外層才刪）。
    if (fixtureId) must(await admin.from("highlight_people").delete().eq("conference_id", fixtureId));
    must(await admin.from("stakes").delete().in("id", [taipeiStakeId, taichungStakeId]));
  });

  // 在 2099 目前年度加一項人物版型的大會特色與它的人物（照順序）。
  async function templatePage(row: Record<string, unknown>, people: Record<string, unknown>[]) {
    const id = must(
      await admin
        .from("highlights")
        .insert({ conference_id: fixtureId, position: 3, ...row })
        .select("id")
        .single(),
    ).id as string;
    // 一次一筆：一次寫好幾筆時，有的人沒給的欄位會被當成空值，不是預設值。
    for (const [index, person] of people.entries()) {
      must(await admin.from("highlight_people").insert({ conference_id: fixtureId, highlight_id: id, position: index + 1, ...person }));
    }
    return id;
  }

  async function venue(position: number, nameZh: string, nameEn = "") {
    return must(
      await admin
        .from("venues")
        .insert({ conference_id: fixtureId, position, region: "north", name_zh: nameZh, name_en: nameEn })
        .select("id")
        .single(),
    ).id as string;
  }

  async function personIds(highlightId: string) {
    const rows = must(await admin.from("highlight_people").select("id").eq("highlight_id", highlightId).order("position"));
    return rows.map((row) => row.id as string);
  }

  // 卡片：main 裡有圓形照片的清單項目。
  const cards = () => screen.queryAllByRole("listitem").filter((item) => item.closest("main") && item.querySelector(".rounded-full"));
  const visibleNames = () =>
    cards()
      .filter((card) => !card.closest("[hidden]"))
      .map((card) => card.querySelector(".text-lead")!.textContent);

  it("向貴賓致敬：麵包屑、標題區、引言與介紹內容、依教堂分組的人物卡片；有介紹的人物有按鈕連到個人介紹頁", async () => {
    await arrange(true);
    const jinhua = await venue(1, "台北金華教堂");
    const photo = `${fixtureId}/${crypto.randomUUID()}.jpg`;
    const id = await templatePage(
      {
        name_zh: "向貴賓致敬",
        page_template: "honor",
        subtitle_zh: "80 歲長輩，持守到底的美好榜樣。",
        lead_quote_zh: "在我們當中，有一群特別值得尊敬的姐妹。",
        description_zh: "她們走過歲月的風雨。\n\n<script>alert(1)</script>",
      },
      [
        {
          stake_id: taipeiStakeId,
          ward_id: luzhouWardId,
          venue_id: jinhua,
          name_zh: "沈亦斌 姐妹",
          photo_path: photo,
          photo_focus: 20,
          bio_zh: "她的故事",
        },
        // 沒有介紹的不放按鈕；向貴賓致敬沒有課程簡介，寫了也不算。
        { name_zh: "黃蘋 姐妹", venue_id: jinhua, summary_zh: "不顯示" },
      ],
    );
    const [shen] = await personIds(id);

    await renderPage(HighlightPage({ id, preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("向貴賓致敬");
    const crumbs = within(screen.getByRole("navigation", { name: messages.zh.activity.breadcrumbLabel }));
    expect(crumbs.getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["首頁", "/"],
      ["大會有什麼", "/#about"],
    ]);
    expect(crumbs.getByText("向貴賓致敬").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: messages.zh.site.title }).getAttribute("href")).toBe("/");
    expect(screen.getByText("80 歲長輩，持守到底的美好榜樣。")).toBeTruthy();
    expect(screen.getByText("在我們當中，有一群特別值得尊敬的姐妹。").tagName).toBe("BLOCKQUOTE");
    expect(screen.getByText("她們走過歲月的風雨。")).toBeTruthy();
    expect(document.querySelector("main script")).toBeNull();

    expect(screen.getByRole("heading", { level: 2, name: "貴賓介紹" })).toBeTruthy();
    // 只有一間教堂：不放選教堂按鈕，說明也不叫人選教堂。
    expect(screen.getByText(messages.zh.activity.pickCard)).toBeTruthy();
    expect(screen.queryByRole("group", { name: messages.zh.activity.venuePickerLabel })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "台北金華教堂" }).nextSibling!.textContent).toBe("2 位貴賓");
    expect(cards().map((card) => card.textContent)).toEqual([
      "測試中台北支聯會測試蘆洲支會沈亦斌 姐妹閱讀她的故事",
      "黃蘋 姐妹",
    ]);
    const image = within(cards()[0]).getByRole("img", { name: "沈亦斌 姐妹" });
    expect(image.getAttribute("src")).toMatch(new RegExp(`/highlight-images/${photo}$`));
    expect((image as HTMLImageElement).style.objectPosition).toBe("50% 20%");
    expect(within(cards()[0]).getByRole("link", { name: "閱讀她的故事" }).getAttribute("href")).toBe(
      `/highlights/${id}/people/${shen}`,
    );
    expect(within(cards()[1]).queryByRole("link")).toBeNull();
    // 刻意不放報名按鈕。
    expect(screen.queryByRole("link", { name: messages.zh.home.registerButton })).toBeNull();
  });

  it("角落課程：按鈕是課程名稱（對應到課程時從課程帶）；沒有介紹時只顯示名稱；英文版缺漏顯示中文", async () => {
    await arrange(true);
    locale = "en";
    const daya = await venue(1, "台中大雅教堂", "Taichung Daya Chapel");
    const sessionId = must(
      await admin.from("sessions").insert({ conference_id: fixtureId, venue_id: daya, name_zh: "第一場次" }).select("id").single(),
    ).id;
    const courseId = must(
      await admin
        .from("courses")
        .insert({ conference_id: fixtureId, session_id: sessionId, title_zh: "皮編手環", title_en: "Leather bracelets" })
        .select("id")
        .single(),
    ).id;
    const id = await templatePage({ name_zh: "角落課程", name_en: "Corner classes", page_template: "corner" }, [
      // 教堂沒選，從課程帶。
      { name_zh: "陳雅玲", stake_id: taichungStakeId, ward_id: shaluWardId, course_id: courseId, outline_zh: "一" },
      { name_zh: "曾鈺芸", venue_id: daya, course_title_zh: "肩背包" },
    ]);

    await renderPage(HighlightPage({ id, preview: false }));

    expect(screen.getByRole("heading", { level: 2, name: messages.en.activity.corner.peopleHeading })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Taichung Daya Chapel" }).nextSibling!.textContent).toBe("2 teachers");
    expect(screen.getByRole("link", { name: /Leather bracelets/ }).getAttribute("href")).toMatch(new RegExp(`^/highlights/${id}/people/`));
    expect(screen.getByText("Test Shalu Ward")).toBeTruthy();
    expect(screen.getByText("肩背包").closest("a")).toBeNull();
    // 只寫了人物、沒有引言與介紹內容時，沒有介紹區。
    expect(document.querySelector("blockquote")).toBeNull();
  });

  it("傳教士：支聯會與服務地區分兩行；預覽版的連結回到預覽首頁、連到預覽的個人介紹頁", async () => {
    await arrange(false);
    const id = await templatePage({ name_zh: "與年長夫婦傳教士有約", page_template: "missionary" }, [
      { stake_id: taichungStakeId, service_area_zh: "台中傳道部", name_zh: "曾其祥、曾李瑞馨 夫婦", outline_zh: "見證" },
    ]);
    const [couple] = await personIds(id);

    await expect(renderPage(HighlightPage({ id, preview: false }))).rejects.toThrow("not found");
    await renderPage(HighlightPage({ id, preview: true }));

    expect(screen.getByRole("status").textContent).toBe(messages.zh.preview.highlight);
    expect(screen.getByRole("link", { name: "認識這對傳教士" }).getAttribute("href")).toBe(
      `/preview/highlights/${id}/people/${couple}`,
    );
    expect(screen.getByText("測試西台中支聯會")).toBeTruthy();
    expect(screen.getByText("服務地區：台中傳道部")).toBeTruthy();
    // 沒選教堂的放在「其他」。
    expect(screen.getByRole("heading", { level: 3, name: messages.zh.activity.otherVenue })).toBeTruthy();
    expect(screen.getByRole("link", { name: "首頁" }).getAttribute("href")).toBe("/preview");
  });

  it("選教堂按鈕：照場地的順序只列有人的教堂，沒選教堂的在最後；只顯示所選那一間", async () => {
    await arrange(true);
    const niaosong = await venue(3, "高雄鳥松教堂");
    const jinhua = await venue(1, "台北金華教堂");
    await venue(2, "台中大雅教堂");
    const id = await templatePage({ name_zh: "靈性課程", page_template: "spiritual" }, [
      { name_zh: "南一", venue_id: niaosong },
      { name_zh: "北一", venue_id: jinhua },
      { name_zh: "沒選" },
      { name_zh: "北二", venue_id: jinhua },
    ]);

    await renderPage(HighlightPage({ id, preview: false }));

    expect(screen.getByText(messages.zh.activity.pickVenue)).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "台北金華教堂",
      "高雄鳥松教堂",
      "其他",
    ]);
    const group = within(screen.getByRole("group", { name: messages.zh.activity.venuePickerLabel }));
    expect(group.getAllByRole("button").map((button) => [button.textContent, button.getAttribute("aria-pressed")])).toEqual([
      ["全部教堂", "true"],
      ["台北金華教堂", "false"],
      ["高雄鳥松教堂", "false"],
      ["其他", "false"],
    ]);
    expect(visibleNames()).toEqual(["北一", "北二", "南一", "沒選"]);

    fireEvent.click(group.getByRole("button", { name: "高雄鳥松教堂" }));
    expect(visibleNames()).toEqual(["南一"]);
    expect(group.getByRole("button", { name: "高雄鳥松教堂" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(group.getByRole("button", { name: "全部教堂" }));
    expect(visibleNames()).toEqual(["北一", "北二", "南一", "沒選"]);
  });

  it("選教堂按鈕：伺服器畫的頁面沒有按鈕、全部的人都在", async () => {
    await arrange(true);
    const jinhua = await venue(1, "台北金華教堂");
    const daya = await venue(2, "台中大雅教堂");
    const id = await templatePage({ name_zh: "向貴賓致敬", page_template: "honor" }, [
      { name_zh: "北一", venue_id: jinhua },
      { name_zh: "中一", venue_id: daya },
    ]);
    let element = await HighlightPage({ id, preview: false });
    while (typeof element.type === "function") {
      element = await (element.type as (props: unknown) => ReactElement | Promise<ReactElement>)(element.props);
    }
    const html = renderToString(element);
    expect(html).not.toContain(messages.zh.activity.venuePickerLabel);
    expect(html).toContain("北一");
    expect(html).toContain("中一");
  });

  it("個人介紹頁：人物卡與所屬教堂、標題是課程名稱、依版型顯示的段落、回到活動", async () => {
    await arrange(true);
    const daya = await venue(1, "台中大雅教堂");
    const id = await templatePage({ name_zh: "角落課程", page_template: "corner" }, [
      {
        name_zh: "周明瑜 姐妹",
        stake_id: taipeiStakeId,
        ward_id: luzhouWardId,
        venue_id: daya,
        course_title_zh: "浮游花瓶製作",
        bio_zh: "第一段\n第二段",
        outline_zh: "1. 材料說明\n2. 創作",
      },
      { name_zh: "沒寫介紹", venue_id: daya },
    ]);
    const [zhou, empty] = await personIds(id);

    await renderPage(PersonPage({ highlightId: id, personId: zhou.toUpperCase(), preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("浮游花瓶製作");
    const crumbs = within(screen.getByRole("navigation", { name: messages.zh.activity.breadcrumbLabel }));
    expect(crumbs.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/", "/#about", `/highlights/${id}`]);
    expect(crumbs.getByText("周明瑜 姐妹").getAttribute("aria-current")).toBe("page");
    const aside = within(screen.getByRole("complementary", { name: "周明瑜 姐妹" }));
    expect(aside.getByText("測試中台北支聯會")).toBeTruthy();
    expect(aside.getByText("台中大雅教堂")).toBeTruthy();
    // 沒寫課程簡介，那一段不出現。
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(["講師介紹", "課程大綱"]);
    expect(screen.getByText("第二段").tagName).toBe("P");
    expect(within(document.querySelector("main ol:not(nav ol)")!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "材料說明",
      "創作",
    ]);
    expect(screen.getByRole("link", { name: /回到角落課程/ }).getAttribute("href")).toBe(`/highlights/${id}`);
    cleanup();

    // 沒有介紹的人物、別的活動的人物、不存在的編號都找不到。
    await expect(renderPage(PersonPage({ highlightId: id, personId: empty, preview: false }))).rejects.toThrow("not found");
    await expect(renderPage(PersonPage({ highlightId: choirId, personId: zhou, preview: false }))).rejects.toThrow("not found");
    await expect(renderPage(PersonPage({ highlightId: id, personId: "x", preview: false }))).rejects.toThrow("not found");
  });

  it("個人介紹頁：公告上線前只有預覽看得到；向貴賓致敬的標題是姓名", async () => {
    await arrange(false);
    const id = await templatePage({ name_zh: "向貴賓致敬", page_template: "honor" }, [{ name_zh: "沈亦斌 姐妹", bio_zh: "故事" }]);
    const [shen] = await personIds(id);

    await expect(renderPage(PersonPage({ highlightId: id, personId: shen, preview: false }))).rejects.toThrow("not found");
    await renderPage(PersonPage({ highlightId: id, personId: shen, preview: true }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("沈亦斌 姐妹");
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("貴賓介紹");
    expect(screen.getByRole("link", { name: /回到向貴賓致敬/ }).getAttribute("href")).toBe(`/preview/highlights/${id}`);
  });

  it("選了版型、沒有人物也沒有介紹內容時找不到，首頁卡片不能點", async () => {
    await arrange(true);
    const id = await templatePage({ name_zh: "向貴賓致敬", page_template: "honor", subtitle_zh: "只有副標" }, []);

    await expect(renderPage(HighlightPage({ id, preview: false }))).rejects.toThrow("not found");
    await renderPage(HomePage({ preview: false }));
    expect(screen.queryByRole("link", { name: /向貴賓致敬/ })).toBeNull();
  });
});

describe("圖文型介紹頁與各教堂頁", () => {
  async function venue(position: number, nameZh: string) {
    return must(
      await admin
        .from("venues")
        .insert({ conference_id: fixtureId, position, region: "north", name_zh: nameZh })
        .select("id")
        .single(),
    ).id as string;
  }

  async function featurePage(row: Record<string, unknown>) {
    return must(
      await admin
        .from("highlights")
        .insert({ conference_id: fixtureId, position: 3, ...row })
        .select("id")
        .single(),
    ).id as string;
  }

  async function venueRow(highlightId: string, venueId: string, row: Record<string, unknown>) {
    must(await admin.from("highlight_venues").insert({ conference_id: fixtureId, highlight_id: highlightId, venue_id: venueId, ...row }));
  }

  async function teamMember(highlightId: string, venueId: string, position: number, row: Record<string, unknown>) {
    must(
      await admin
        .from("highlight_venue_team")
        .insert({ conference_id: fixtureId, highlight_id: highlightId, venue_id: venueId, position, ...row }),
    );
  }

  it("即席唱詩班：標題區、只列有內容的教堂按鈕、活動圖片、介紹內容與結語", async () => {
    await arrange(true);
    const photo = `${fixtureId}/${crypto.randomUUID()}.jpg`;
    const id = await featurePage({
      name_zh: "即席唱詩班",
      page_template: "choir",
      subtitle_zh: "為了大會而相聚，齊聲歌唱。",
      description_zh: "「即席」唱詩班，並不是一個固定的唱詩班。",
      image_path: photo,
      image_alt_zh: "姐妹們一起唱詩的照片",
      closing_zh: "來吧！加入即席唱詩班吧！",
    });
    const niaosong = await venue(3, "高雄鳥松教堂");
    const jinhua = await venue(1, "台北金華教堂");
    await venue(2, "台中大雅教堂");
    await teamMember(id, niaosong, 1, { name_zh: "司琴" });
    await venueRow(id, jinhua, { body_zh: "說明" });

    await renderPage(HighlightPage({ id, preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("即席唱詩班");
    expect(screen.getByText("為了大會而相聚，齊聲歌唱。")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(messages.zh.activity.choir.venuePrompt);
    const buttons = within(screen.getByRole("heading", { level: 2 }).parentElement!).getAllByRole("link");
    expect(buttons.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["台北金華教堂›", `/highlights/${id}/venues/${jinhua}`],
      ["高雄鳥松教堂›", `/highlights/${id}/venues/${niaosong}`],
    ]);
    const image = screen.getByRole("img", { name: "姐妹們一起唱詩的照片" });
    expect(image.getAttribute("src")).toMatch(new RegExp(`/highlight-images/${photo}$`));
    expect(screen.getByText("「即席」唱詩班，並不是一個固定的唱詩班。")).toBeTruthy();
    expect(screen.getByText("來吧！加入即席唱詩班吧！")).toBeTruthy();
    expect(screen.queryByRole("link", { name: messages.zh.home.registerButton })).toBeNull();
  });

  it("各教堂頁：節目名稱、切換其他教堂、海報、製作靈感、團隊成員、回到活動；預覽版連到預覽", async () => {
    await arrange(false);
    const id = await featurePage({ name_zh: "迷妳音樂會", page_template: "concert" });
    const jinhua = await venue(1, "台北金華教堂");
    const daya = await venue(2, "台中大雅教堂");
    const poster = `${fixtureId}/${crypto.randomUUID()}.png`;
    await venueRow(id, daya, {
      show_title_zh: "〈妳是我的寶〉",
      poster_path: poster,
      poster_alt_zh: "大雅教堂迷妳音樂會海報",
      body_zh: "在這一場充滿音樂與愛的午後。\n\n<script>alert(1)</script>",
    });
    // 舊資料的海報沒有圖片說明：至少說出是哪間教堂的海報。
    await venueRow(id, jinhua, { show_title_zh: "金華場", poster_path: `${fixtureId}/${crypto.randomUUID()}.jpg` });
    await teamMember(id, daya, 2, { role_zh: "主持", name_zh: "王台君", bio_zh: "第一段\n第二段" });
    await teamMember(id, daya, 1, { role_zh: "製作人", name_zh: "陳玉穎" });

    await expect(renderPage(VenuePage({ highlightId: id, venueId: daya, preview: false }))).rejects.toThrow("not found");
    await renderPage(VenuePage({ highlightId: id, venueId: daya, preview: true }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("台中大雅教堂");
    expect(screen.getByText("〈妳是我的寶〉")).toBeTruthy();
    const crumbs = within(screen.getByRole("navigation", { name: messages.zh.activity.breadcrumbLabel }));
    expect(crumbs.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/preview",
      "/preview#about",
      `/preview/highlights/${id}`,
    ]);
    const others = within(screen.getByRole("navigation", { name: messages.zh.activity.otherVenues }));
    expect(others.getByRole("link", { name: "台北金華教堂" }).getAttribute("href")).toBe(`/preview/highlights/${id}/venues/${jinhua}`);
    expect(others.getByText("台中大雅教堂").getAttribute("aria-current")).toBe("page");
    // 海報連結的名稱是圖片說明，點了會怎樣寫在提示裡。
    const posterLink = screen.getByRole("link", { name: "大雅教堂迷妳音樂會海報" });
    expect(posterLink.getAttribute("href")).toMatch(new RegExp(`/highlight-images/${poster}$`));
    expect(document.getElementById(posterLink.getAttribute("aria-describedby")!)!.textContent).toContain(
      messages.zh.activity.posterEnlarge,
    );
    expect(screen.getByRole("heading", { level: 2, name: messages.zh.activity.inspiration })).toBeTruthy();
    expect(screen.getByText("在這一場充滿音樂與愛的午後。")).toBeTruthy();
    expect(document.querySelector("main script")).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: messages.zh.activity.concert.teamHeading })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual(["陳玉穎", "王台君"]);
    expect(screen.getByText("主持")).toBeTruthy();
    expect(screen.getByText("第二段").tagName).toBe("P");
    expect(screen.getByRole("link", { name: /回到迷妳音樂會/ }).getAttribute("href")).toBe(`/preview/highlights/${id}`);
    cleanup();

    await renderPage(VenuePage({ highlightId: id, venueId: jinhua, preview: true }));
    expect(screen.getByRole("link", { name: "台北金華教堂的海報" })).toBeTruthy();
  });

  it("各教堂頁：只有一間教堂時不放切換；沒有內容的教堂、別的活動都找不到", async () => {
    await arrange(true);
    const id = await featurePage({ name_zh: "即席唱詩班", page_template: "choir" });
    const jinhua = await venue(1, "台北金華教堂");
    const daya = await venue(2, "台中大雅教堂");
    await teamMember(id, jinhua, 1, { role_zh: "指揮", name_zh: "黃淑真" });

    await renderPage(VenuePage({ highlightId: id, venueId: jinhua, preview: false }));
    expect(screen.queryByRole("navigation", { name: messages.zh.activity.otherVenues })).toBeNull();
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(messages.zh.activity.choir.teamHeading);
    // 沒有海報、製作靈感時不出現。
    expect(screen.queryByRole("heading", { name: messages.zh.activity.inspiration })).toBeNull();
    cleanup();

    await expect(renderPage(VenuePage({ highlightId: id, venueId: daya, preview: false }))).rejects.toThrow("not found");
    await expect(renderPage(VenuePage({ highlightId: choirId, venueId: jinhua, preview: false }))).rejects.toThrow("not found");
  });
});

describe("首頁的大會有什麼", () => {
  it("寫了介紹內容的卡片連到介紹頁，沒寫的不能點", async () => {
    await arrange(true);

    await renderPage(HomePage({ preview: false }));

    const section = screen.getByRole("heading", { name: messages.zh.home.highlightsHeading }).closest("section")!;
    const links = within(section).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([`/highlights/${choirId}`]);
    expect(links[0].textContent).toContain("跟著影片練唱");
    const exhibition = within(section).getByRole("heading", { name: "靜態展示" });
    expect(exhibition.closest("a")).toBeNull();
  });

  it("預覽首頁的卡片連到預覽版的介紹頁", async () => {
    await arrange(false);

    await renderPage(HomePage({ preview: true }));

    const section = screen.getByRole("heading", { name: messages.zh.home.highlightsHeading }).closest("section")!;
    expect(within(section).getByRole("link").getAttribute("href")).toBe(`/preview/highlights/${choirId}`);
  });
});
