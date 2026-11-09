// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@/lib/i18n/locale";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../test/supabase";
import { LandingPage } from "./landing-page";

// 頁面在伺服器上讀 cookie 的部分換掉：用訪客的連線讀資料、語言由測試決定、語言切換按鈕不畫。
let locale: Locale = "zh";
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => locale, getMessages: async () => messages[locale] }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));

const admin = adminClient();
let previousCurrentIds: string[] = [];
let fixtureId: string | undefined;
const CONFERENCE_SITE = "https://www.taiwanwomensconference.org/";

// 2099 年度大會設成目前年度，5/15（星期五）9:00–16:00。時程由各測試用 setSchedule 決定。測完復原。
beforeEach(async () => {
  locale = "zh";
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));
  fixtureId = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        start_time: "09:00",
        end_time: "16:00",
        announce_at: "2099-03-01T09:00:00+08:00",
        registration_opens_at: "2099-04-01T09:00:00+08:00",
        registration_closes_at: "2099-05-01T00:00:00+08:00",
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

/** 報名開放與截止時間（台灣時間），公告上線改在 2026-01-01，已經過了。 */
async function setSchedule(opensAt: string, closesAt: string) {
  must(
    await admin
      .from("conferences")
      .update({ announce_at: "2026-01-01T00:00:00+08:00", registration_opens_at: opensAt, registration_closes_at: closesAt })
      .eq("id", fixtureId!),
  );
}

const status = () => document.getElementById("status")!;

describe("報名入口頁", () => {
  it("公告上線前：只顯示「大會資訊即將公布」，沒有大會資訊與報名按鈕", async () => {
    await renderPage(LandingPage({ preview: false }));

    expect(screen.getByText(messages.zh.landing.comingSoon)).toBeTruthy();
    expect(screen.queryByText(/2099/)).toBeNull();
    expect(screen.queryByRole("link", { name: "我要報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "查詢或修改報名" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("報名前：大會名稱、日期與時間，寫開放與截止時間；不能報名也不能查詢", async () => {
    await setSchedule("2099-04-01T09:00:00+08:00", "2099-05-01T00:00:00+08:00");

    await renderPage(LandingPage({ preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("2099 台灣姐妹大會報名");
    expect(screen.getByText("5月15日（星期五）")).toBeTruthy();
    expect(screen.getByText("上午9:00 – 下午4:00")).toBeTruthy();
    expect(within(status()).getByRole("heading", { name: "報名還沒開始" })).toBeTruthy();
    expect(within(status()).getByText("開放報名：4月1日（星期三） 上午9:00")).toBeTruthy();
    expect(within(status()).getByText("報名截止：5月1日（星期五） 上午12:00")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "我要報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "幫家人或朋友報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "查詢或修改報名" })).toBeNull();
  });

  it("報名中：寫截止時間，三個按鈕連到報名、代報與查詢", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");

    await renderPage(LandingPage({ preview: false }));

    expect(within(status()).getByRole("heading", { name: "現在可以報名" })).toBeTruthy();
    expect(within(status()).getByText("報名截止：1月14日（星期三） 上午12:00")).toBeTruthy();
    expect(screen.getByRole("link", { name: "我要報名" }).getAttribute("href")).toBe("/register");
    expect(screen.getByRole("link", { name: "幫家人或朋友報名" }).getAttribute("href")).toBe("/register?for=others");
    expect(screen.getByRole("link", { name: "查詢或修改報名" }).getAttribute("href")).toBe("/lookup");
    // 截止在 1/14 00:00，姐妹可以改到 1/13。
    expect(screen.getByText("1月13日（星期二）以前都可以自己修改。")).toBeTruthy();
    // 頁尾「回到最上面」跳得到。
    expect(screen.getByRole("link", { name: "回到最上面" }).getAttribute("href")).toBe("#top");
    expect(document.getElementById("top")).not.toBeNull();
    // 報名狀態與「我要報名」排在最前面，手機第一屏看得到。
    const text = document.body.textContent!;
    expect(text.indexOf("現在可以報名")).toBeLessThan(text.indexOf("我要報名"));
    expect(text.indexOf("我要報名")).toBeLessThan(text.indexOf("幫家人或朋友報名"));
  });

  it("已截止：只能查詢，不能報名或代報（網站上也不能修改）", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2026-02-01T00:00:00+08:00");

    await renderPage(LandingPage({ preview: false }));

    expect(within(status()).getByRole("heading", { name: "報名已經截止" })).toBeTruthy();
    expect(within(status()).getByText(messages.zh.landing.closedDescription)).toBeTruthy();
    expect(screen.getByRole("link", { name: "查詢我的報名" }).getAttribute("href")).toBe("/lookup");
    expect(screen.queryByRole("link", { name: "我要報名" })).toBeNull();
    expect(screen.queryByRole("link", { name: "幫家人或朋友報名" })).toBeNull();
  });

  it("公告上線後都有連到大會網站的連結，沒有大會特色、籌備委員會的選單", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");

    await renderPage(LandingPage({ preview: false }));

    expect(screen.getByRole("link", { name: "到大會網站看大會介紹與程序" }).getAttribute("href")).toBe(CONFERENCE_SITE);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("英文版：大會資訊、報名狀態、按鈕與大會網站連結都是英文", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");
    locale = "en";

    await renderPage(LandingPage({ preview: false }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("2099 Taiwan Women's Conference registration");
    expect(screen.getByText("Friday, May 15")).toBeTruthy();
    expect(screen.getByText("9:00 AM – 4:00 PM (Taiwan time)")).toBeTruthy();
    expect(within(status()).getByRole("heading", { name: "Registration is open" })).toBeTruthy();
    expect(within(status()).getByText("Registration closes: Wednesday, January 14 12:00 AM (Taiwan time)")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Register now" }).getAttribute("href")).toBe("/register");
    expect(screen.getByRole("link", { name: "Register a family member or friend" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Look up or change a registration" })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "About the conference and programme: visit the conference website" }).getAttribute("href"),
    ).toBe(CONFERENCE_SITE);
  });

  it("後台預覽：公告上線前也照報名前的樣子顯示，最上方有預覽提示", async () => {
    await renderPage(LandingPage({ preview: true }));

    expect(screen.getByRole("status").textContent).toBe(messages.zh.preview.homeNotAnnounced);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("2099 台灣姐妹大會報名");
    expect(within(status()).getByRole("heading", { name: "報名還沒開始" })).toBeTruthy();
    expect(screen.queryByText(messages.zh.landing.comingSoon)).toBeNull();
  });

  it("後台預覽報名中：報名按鈕連到預覽報名表，不會真的報名", async () => {
    await setSchedule("2026-01-01T09:00:00+08:00", "2099-01-14T00:00:00+08:00");

    await renderPage(LandingPage({ preview: true }));

    expect(screen.getByRole("status").textContent).toBe(messages.zh.preview.homeAnnounced);
    expect(screen.getByRole("link", { name: "我要報名" }).getAttribute("href")).toBe("/preview/register");
    expect(screen.getByRole("link", { name: "幫家人或朋友報名" }).getAttribute("href")).toBe(
      "/preview/register?for=others",
    );
  });
});
