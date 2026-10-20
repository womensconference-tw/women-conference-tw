// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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
    expect(source.getAttribute("media")).toBe("(min-width: 768px)");
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
    expect(screen.getByText("你要把你的重擔卸給耶和華").closest("div")!.className).toContain("md:hidden");
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
