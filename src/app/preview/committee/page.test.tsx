// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminClient, must } from "../../../../test/supabase";
import CommitteePreviewPage from "./page";

/*
 * 籌備委員會文字頁草稿的預覽（#76）。誰讀得到草稿由資料庫的權限規則決定（src/lib/committee.test.ts），
 * 這裡用不受權限規則限制的連線讀資料，只看頁面怎麼顯示、誰能打開。repo 是公開的，一律用假名。
 */

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => adminClient() }));
const getCurrentStaff = vi.fn();
vi.mock("@/app/staff/current-staff", () => ({ getCurrentStaff: () => getCurrentStaff() }));
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect ${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => redirect(path) }));
// 發布按鈕旁的結果訊息是讀網址的跳出視窗，這裡不畫。
vi.mock("@/app/staff/result-message", () => ({ ResultMessage: () => null }));
// 頁首的字型由 Next.js 建置時下載，測試裡沒有。
vi.mock("next/font/google", () => ({ Noto_Serif_TC: () => ({ variable: "" }) }));

const admin = adminClient();
let conferenceId: string;

// 2099 年度已發布一版文字頁，有一筆會議記錄。
beforeEach(async () => {
  conferenceId = must(
    await admin.from("conferences").insert({ year: 2099, conference_date: "2099-05-15" }).select("id").single(),
  ).id;
  must(
    await admin
      .from("committee_texts")
      .insert({ conference_id: conferenceId, introduction: "已發布的簡介", memorandum: "已發布的備忘錄" }),
  );
  must(
    await admin
      .from("committee_meetings")
      .insert({ conference_id: conferenceId, title: "第 1 次會議", meeting_date: "2099-01-10", url: "https://example.com/m" }),
  );
  getCurrentStaff.mockReset();
  redirect.mockClear();
});

afterEach(async () => {
  cleanup();
  must(await admin.from("conferences").delete().eq("id", conferenceId));
});

/** 伺服器元件：一路呼叫到畫面元素，再畫出來。 */
async function renderPage(page: ReactElement | Promise<ReactElement>) {
  let element = await page;
  while (typeof element.type === "function") {
    element = await (element.type as (props: unknown) => ReactElement | Promise<ReactElement>)(element.props);
  }
  render(element);
}

const open = (page?: string) =>
  renderPage(
    CommitteePreviewPage({ searchParams: Promise.resolve({ year: "2099", ...(page && { page }) }), params: Promise.resolve({}) }),
  );

// 選單上目前這一頁的名稱（有修改的頁面多一個「（有修改）」給螢幕閱讀器）。
const currentPage = () => within(screen.getByRole("navigation", { name: "籌備委員會選單" })).getByRole("link", { current: "page" }).textContent;

async function saveDraft(values: Record<string, string>) {
  return must(
    await admin
      .from("committee_text_drafts")
      .insert({ conference_id: conferenceId, introduction: "已發布的簡介", memorandum: "已發布的備忘錄", ...values })
      .select("revision")
      .single(),
  ).revision as string;
}

it("總管理員打開預覽：照公開頁面的樣子一頁一項，先看有修改的那一頁；發布時帶上這份草稿的版本代號", async () => {
  getCurrentStaff.mockResolvedValue({ role: "admin" });
  const revision = await saveDraft({ memorandum: "## 第一章\n\n**組織**" });

  await open();

  expect(screen.getByRole("status").textContent).toMatch(/^預覽：/);
  expect(screen.getByText(/籌備委員會備忘錄有修改/)).toBeTruthy();
  // 備忘錄在「會議記錄」那一頁的最上面，下面照舊是會議記錄。
  expect(currentPage()).toBe("會議記錄（有修改）");
  expect(screen.getByRole("heading", { level: 1, name: "會議記錄（2099 年）" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "第一章" })).toBeTruthy();
  expect(screen.getByText("組織").tagName).toBe("STRONG");
  expect(screen.queryByText("已發布的備忘錄")).toBeNull();
  expect(screen.getByText("第 1 次會議")).toBeTruthy();
  // 其他頁不在這一頁。
  expect(screen.queryByText("已發布的簡介")).toBeNull();

  const publish = screen.getByRole("button", { name: "發布" }).closest("form")!;
  expect(new FormData(publish).get("revision")).toBe(revision);
  expect(new FormData(publish).get("conferenceId")).toBe(conferenceId);
  expect(new FormData(publish).get("year")).toBe("2099");
});

it("用選單切換各頁：連結帶著年度與頁面，沒修改的頁面顯示已發布的內容", async () => {
  getCurrentStaff.mockResolvedValue({ role: "admin" });
  await saveDraft({ execution_plan: "草稿的執行計畫" });

  await open();
  expect(currentPage()).toBe("執行計畫（有修改）");
  expect(screen.getByText("草稿的執行計畫")).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "籌備委員會選單" });
  expect(within(nav).getByRole("link", { name: "大會簡介" }).getAttribute("href")).toBe("/preview/committee?year=2099&page=introduction");
  cleanup();

  await open("introduction");
  expect(currentPage()).toBe("大會簡介");
  expect(screen.getByText("已發布的簡介")).toBeTruthy();
  expect(screen.queryByText("草稿的執行計畫")).toBeNull();
});

it("沒有草稿：說明沒有要發布的修改，沒有發布按鈕", async () => {
  getCurrentStaff.mockResolvedValue({ role: "admin" });

  await open();

  expect(screen.getByText(/沒有尚未發布的修改/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "發布" })).toBeNull();
});

it("課務組、報報組打開預覽：回到籌備委員會頁，看不到草稿", async () => {
  getCurrentStaff.mockResolvedValue({ role: "course_team" });
  await saveDraft({ memorandum: "草稿的備忘錄" });

  await expect(open()).rejects.toThrow("redirect /staff/committee");
  expect(screen.queryByText("草稿的備忘錄")).toBeNull();
});

it("沒登入打開預覽：導到登入頁", async () => {
  getCurrentStaff.mockResolvedValue(null);

  await expect(open()).rejects.toThrow("redirect /staff/login");
});
