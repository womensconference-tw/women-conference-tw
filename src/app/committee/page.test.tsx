// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../../test/supabase";
import Home from "../page";
import PublicCommitteePage, { metadata } from "./page";

/*
 * 公開的籌備委員會頁面（#74）。repo 是公開的，這裡一律用假名。
 */

// 頁面在伺服器上讀 cookie 的部分換掉：用沒登入的訪客連線讀資料、首頁用中文、語言切換按鈕不畫。
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "zh", getMessages: async () => messages.zh }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));

const admin = adminClient();
let conferenceIds: string[] = [];
let currentId: string;
let stake: { id: string; name_zh: string; region: string };

// 目前年度（共用的測試資料）有一份名單；另外建一個過去的 2001 年度、一個還沒到的 2099 年度。
beforeEach(async () => {
  currentId = must(await admin.from("conferences").select("id").eq("is_current", true).single()).id;
  stake = must(await admin.from("stakes").select("id, name_zh, region").eq("is_active", true).order("position").limit(1).single());
  const past = must(await admin.from("conferences").insert({ year: 2001, conference_date: "2001-05-15" }).select("id").single());
  const future = must(await admin.from("conferences").insert({ year: 2099, conference_date: "2099-05-15" }).select("id").single());
  conferenceIds = [past.id, future.id];

  for (const [id, label] of [
    [currentId, "今年"],
    [past.id, "2001"],
    [future.id, "2099"],
  ]) {
    must(await admin.from("committee_texts").insert({ conference_id: id, introduction: `${label}的大會簡介` }));
    must(
      await admin.from("committee_team_members").insert([
        { conference_id: id, team: "course", role: "deputy", name: `${label}測試丙`, region: "south", stake_id: stake.id },
        { conference_id: id, team: "conveners", role: "lead", name: `${label}測試甲`, region: null, stake_id: stake.id },
        { conference_id: id, team: "course", role: "lead", name: `${label}測試乙`, region: "north", stake_id: stake.id },
      ]),
    );
    must(
      await admin
        .from("committee_members")
        .insert({ conference_id: id, name: `${label}測試丁`, stake_id: stake.id, relief_society_presidency: true }),
    );
  }
});

afterEach(async () => {
  cleanup();
  // 目前年度是共用的測試資料，只刪這裡加的；其他年度整個刪掉，名單一起刪除。
  for (const table of ["committee_texts", "committee_team_members", "committee_members"]) {
    must(await admin.from(table).delete().eq("conference_id", currentId));
  }
  must(await admin.from("conferences").delete().in("id", conferenceIds));
});

/** 伺服器元件：一路呼叫到畫面元素，再畫出來。 */
async function renderPage(page: ReactElement | Promise<ReactElement>) {
  let element = await page;
  while (typeof element.type === "function") {
    element = await (element.type as (props: unknown) => ReactElement | Promise<ReactElement>)(element.props);
  }
  render(element);
}

// 表格每一列各格的文字，含標題列。
const tableRows = (table: HTMLTableElement) =>
  Array.from(table.rows, (row) => Array.from(row.cells, (cell) => cell.textContent));

const open = (year?: string) =>
  renderPage(PublicCommitteePage({ searchParams: Promise.resolve(year ? { year } : {}), params: Promise.resolve({}) }));

it("沒登入打開公開網址：看得到目前年度的內容", async () => {
  await open();

  expect(screen.getByText("今年的大會簡介")).toBeTruthy();
  expect(screen.getByText("今年測試甲")).toBeTruthy();
  expect(screen.getByText("今年測試丁")).toBeTruthy();
});

it("工作團隊是一張表：組別、擔任職務、姓名、所屬區域、所屬支聯會，依組別再依職務排列", async () => {
  await open();

  const table = screen.getByText("今年測試甲").closest("table")!;
  const rows = tableRows(table);
  expect(rows).toEqual([
    ["組別", "擔任職務", "姓名", "所屬區域", "所屬支聯會"],
    ["總召團", "總召", "今年測試甲", "全區", stake.name_zh],
    ["課務組", "組長", "今年測試乙", "北區", stake.name_zh],
    ["課務組", "副組長", "今年測試丙", "南區", stake.name_zh],
  ]);
});

it("籌備委員表有所屬區域，取支聯會的區", async () => {
  await open();

  const table = screen.getByText("今年測試丁").closest("table")!;
  const rows = tableRows(table);
  const regions: Record<string, string> = { north: "北區", central: "中區", south: "南區" };
  expect(rows).toEqual([
    ["所屬區域", "所屬支聯會", "籌備委員姓名", "是否為慈助會會長團成員"],
    [regions[stake.region], stake.name_zh, "今年測試丁", "✓ 是"],
  ]);
});

it("可以選過去的年度；還沒到的年度看不到，也不在選單裡", async () => {
  await open("2001");
  expect(screen.getByText("2001的大會簡介")).toBeTruthy();
  expect(screen.queryByRole("option", { name: /2099/ })).toBeNull();
  cleanup();

  // 網址改成還沒到的年度：當成沒選，顯示目前年度。
  await open("2099");
  expect(screen.queryByText("2099的大會簡介")).toBeNull();
  expect(screen.getByText("今年的大會簡介")).toBeTruthy();
});

it("不給搜尋引擎收錄，前台首頁也沒有連到這裡", async () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });

  await renderPage(Home());
  expect(document.querySelector('a[href^="/committee"]')).toBeNull();
});
