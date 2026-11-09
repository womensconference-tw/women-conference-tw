// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../../test/supabase";
import Home from "../page";
import PreviewHomePage from "./page";

// 頁面在伺服器上讀 cookie 的部分換掉：用訪客的連線讀資料、畫面用中文、語言切換按鈕不畫。
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "zh", getMessages: async () => messages.zh }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));
const getCurrentStaff = vi.fn();
vi.mock("@/app/staff/current-staff", () => ({ getCurrentStaff: () => getCurrentStaff() }));
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect ${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));

const admin = adminClient();
let previousCurrentIds: string[] = [];
let fixtureId: string | undefined;

// 2099 年度大會設成目前年度，公告上線還沒到。測完復原。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));
  const fixture = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: "2099-03-01T09:00:00+08:00",
        registration_opens_at: "2099-04-01T09:00:00+08:00",
        registration_closes_at: "2099-05-01T00:00:00+08:00",
        is_current: true,
      })
      .select("id")
      .single(),
  );
  fixtureId = fixture.id;
  getCurrentStaff.mockReset();
  redirect.mockClear();
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

describe("公告上線前", () => {
  it("前台報名首頁只顯示「大會資訊即將公布」，看不到大會資訊，也沒有預覽提示", async () => {
    await renderPage(Home());

    expect(screen.getByText(messages.zh.home.comingSoon)).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByText(/預覽模式/)).toBeNull();
  });

  it("工作人員打開預覽報名首頁：最上方有預覽提示，照報名前的樣子顯示大會資訊與報名狀態", async () => {
    getCurrentStaff.mockResolvedValue({ role: "admin" });

    await renderPage(PreviewHomePage());

    expect(screen.getByRole("status").textContent).toBe("預覽模式：訪客還看不到這些內容。");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("2099 台灣姐妹大會報名");
    expect(screen.getByText("開放報名：4月1日（星期三） 上午9:00")).toBeTruthy();
    expect(screen.queryByText(messages.zh.home.comingSoon)).toBeNull();
  });

  it("不是工作人員打開預覽報名首頁：導到登入頁，看不到內容", async () => {
    getCurrentStaff.mockResolvedValue(null);

    await expect(renderPage(PreviewHomePage())).rejects.toThrow("redirect /staff/login");
    expect(redirect).toHaveBeenCalledWith("/staff/login");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });
});
