// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../test/supabase";
import { HighlightPage } from "./highlight-page";
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
