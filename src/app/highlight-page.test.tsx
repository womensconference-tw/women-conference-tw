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

  it("向貴賓致敬：麵包屑、標題區、引言與介紹內容、人物卡片；有連結的人物有按鈕，照片對準設定的高度", async () => {
    await arrange(true);
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
        { stake_zh: "中台北支聯會", ward_zh: "蘆洲支會", name_zh: "沈亦斌 姐妹", photo_path: photo, photo_focus: 20, link_url: "/story/1" },
        { name_zh: "黃蘋 姐妹" },
      ],
    );

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
    expect(screen.getByText("共 2 位貴賓。點按鈕，閱讀每一位貴賓的故事。")).toBeTruthy();
    const cards = screen.getAllByRole("listitem").filter((item) => item.closest("main") && item.querySelector(".rounded-full"));
    expect(cards.map((card) => card.textContent)).toEqual([
      "中台北支聯會・蘆洲支會沈亦斌 姐妹閱讀她的故事",
      "黃蘋 姐妹",
    ]);
    const image = within(cards[0]).getByRole("img", { name: "沈亦斌 姐妹" });
    expect(image.getAttribute("src")).toMatch(new RegExp(`/highlight-images/${photo}$`));
    expect((image as HTMLImageElement).style.objectPosition).toBe("50% 20%");
    expect(within(cards[0]).getByRole("link", { name: "閱讀她的故事" }).getAttribute("href")).toBe("/story/1");
    expect(within(cards[1]).queryByRole("link")).toBeNull();
    // 刻意不放報名按鈕與教堂分頁。
    expect(screen.queryByRole("link", { name: messages.zh.home.registerButton })).toBeNull();
    expect(screen.queryByRole("group", { name: messages.zh.highlight.venuePickerLabel })).toBeNull();
  });

  it("靜態展示：按鈕是作品名稱；沒有連結時只顯示作品名稱；英文版缺漏顯示中文", async () => {
    await arrange(true);
    locale = "en";
    const id = await templatePage({ name_zh: "靜態展示", name_en: "Exhibition", page_template: "exhibit" }, [
      { name_zh: "王真真", ward_zh: "沙鹿支會", ward_en: "Shalu Ward", link_label_zh: "溫柔的心", link_url: "https://example.com/work" },
      { name_zh: "廖秀珠", link_label_zh: "油畫靜態展", link_label_en: "Oil paintings" },
    ]);

    await renderPage(HighlightPage({ id, preview: false }));

    expect(screen.getByRole("heading", { level: 2, name: messages.en.activity.exhibit.peopleHeading })).toBeTruthy();
    expect(screen.getByText("2 sisters are exhibiting. Tap a title to read about the work.")).toBeTruthy();
    const work = screen.getByRole("link", { name: /溫柔的心/ });
    expect(work.getAttribute("href")).toBe("https://example.com/work");
    expect(screen.getByText("Shalu Ward")).toBeTruthy();
    expect(screen.getByText("Oil paintings").closest("a")).toBeNull();
    // 只寫了人物、沒有引言與介紹內容時，沒有介紹區。
    expect(document.querySelector("blockquote")).toBeNull();
  });

  it("傳教士：支聯會與服務地區分兩行；沒填按鈕文字用預設文字；預覽版的連結回到預覽首頁", async () => {
    await arrange(false);
    const id = await templatePage({ name_zh: "與年長夫婦傳教士有約", page_template: "missionary" }, [
      { stake_zh: "台中地帶", ward_zh: "高雄傳道部", name_zh: "曾其祥、曾李瑞馨 夫婦", link_url: "/couple" },
    ]);

    await expect(renderPage(HighlightPage({ id, preview: false }))).rejects.toThrow("not found");
    await renderPage(HighlightPage({ id, preview: true }));

    expect(screen.getByRole("status").textContent).toBe(messages.zh.preview.highlight);
    expect(screen.getByRole("link", { name: "認識這對傳教士" }).getAttribute("href")).toBe("/couple");
    // 支聯會與服務地區分兩行，不寫成「台中地帶・高雄傳道部」。
    expect(screen.getByText("台中地帶")).toBeTruthy();
    expect(screen.getByText("服務地區：高雄傳道部")).toBeTruthy();
    expect(screen.queryByText(/台中地帶・/)).toBeNull();
    expect(screen.getByRole("link", { name: "首頁" }).getAttribute("href")).toBe("/preview");
  });

  it("選了版型、沒有人物也沒有介紹內容時找不到，首頁卡片不能點", async () => {
    await arrange(true);
    const id = await templatePage({ name_zh: "向貴賓致敬", page_template: "honor", subtitle_zh: "只有副標" }, []);

    await expect(renderPage(HighlightPage({ id, preview: false }))).rejects.toThrow("not found");
    await renderPage(HomePage({ preview: false }));
    expect(screen.queryByRole("link", { name: /向貴賓致敬/ })).toBeNull();
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
