// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
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

const open = () =>
  renderPage(CommitteePreviewPage({ searchParams: Promise.resolve({ year: "2099" }), params: Promise.resolve({}) }));

async function saveDraft(values: Record<string, string>) {
  return must(
    await admin
      .from("committee_text_drafts")
      .insert({ conference_id: conferenceId, introduction: "已發布的簡介", memorandum: "已發布的備忘錄", ...values })
      .select("revision")
      .single(),
  ).revision as string;
}

it("總管理員打開預覽：照公開頁面的樣子顯示草稿排版，其他內容照舊；發布時帶上這份草稿的版本代號", async () => {
  getCurrentStaff.mockResolvedValue({ role: "admin" });
  const revision = await saveDraft({ memorandum: "## 第一章\n\n**組織**" });

  await open();

  expect(screen.getByRole("status").textContent).toMatch(/^預覽：/);
  expect(screen.getByText(/籌備委員會備忘錄有修改/)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "第一章" })).toBeTruthy();
  expect(screen.getByText("組織").tagName).toBe("STRONG");
  expect(screen.queryByText("已發布的備忘錄")).toBeNull();
  expect(screen.getByText("已發布的簡介")).toBeTruthy();
  expect(screen.getByText("第 1 次會議")).toBeTruthy();

  const publish = screen.getByRole("button", { name: "發布" }).closest("form")!;
  expect(new FormData(publish).get("revision")).toBe(revision);
  expect(new FormData(publish).get("conferenceId")).toBe(conferenceId);
  expect(new FormData(publish).get("year")).toBe("2099");
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
