// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messages } from "@/lib/i18n/messages";
import { adminClient, anonClient, must } from "../../../test/supabase";
import Home from "../page";
import ChairMessagePage from "./chair-message/page";
import { CommitteeNav } from "./committee-nav";
import { metadata } from "./layout";
import MeetingsPage from "./meetings/page";
import MemberPage from "./members/[memberId]/page";
import MembersPage from "./members/page";
import IntroductionPage from "./page";
import PlanPage from "./plan/page";
import TeamPage from "./team/page";

/*
 * 公開的籌備委員會頁面（#74）：有選單的多頁網站。repo 是公開的，這裡一律用假名。
 */

// 頁面在伺服器上讀 cookie 的部分換掉：用沒登入的訪客連線讀資料、首頁用中文、語言切換按鈕不畫。
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => anonClient() }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "zh", getMessages: async () => messages.zh }));
vi.mock("@/components/language-switch", () => ({ LanguageSwitch: () => null }));
// 頁首的字型由 Next.js 建置時下載，測試裡沒有。
vi.mock("next/font/google", () => ({ Noto_Serif_TC: () => ({ variable: "" }) }));
const navigation = vi.hoisted(() => ({ pathname: "/committee", search: "" }));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ push: vi.fn() }),
}));

const admin = adminClient();
let conferenceIds: string[] = [];
let currentId: string;
let stake: { id: string; name_zh: string; region: string };
let memberIds: Record<string, string> = {};

// 目前年度（共用的測試資料）有一份名單；另外建一個過去的 2001 年度、一個還沒到的 2099 年度。
beforeEach(async () => {
  currentId = must(await admin.from("conferences").select("id").eq("is_current", true).single()).id;
  stake = must(await admin.from("stakes").select("id, name_zh, region").eq("is_active", true).order("position").limit(1).single());
  const past = must(await admin.from("conferences").insert({ year: 2001, conference_date: "2001-05-15" }).select("id").single());
  const future = must(await admin.from("conferences").insert({ year: 2099, conference_date: "2099-05-15" }).select("id").single());
  conferenceIds = [past.id, future.id];
  memberIds = {};

  for (const [id, label] of [
    [currentId, "今年"],
    [past.id, "2001"],
    [future.id, "2099"],
  ]) {
    must(
      await admin.from("committee_texts").insert({
        conference_id: id,
        introduction: `${label}的大會簡介`,
        chair_message: `${label}主席的話`,
        memorandum: `${label}的備忘錄`,
        execution_plan: `${label}的執行計畫`,
      }),
    );
    must(
      await admin.from("committee_team_members").insert([
        { conference_id: id, team: "course", role: "deputy", name: `${label}測試丙`, region: "south", stake_id: stake.id },
        { conference_id: id, team: "conveners", role: "lead", name: `${label}測試甲`, region: null, stake_id: stake.id },
        { conference_id: id, team: "course", role: "lead", name: `${label}測試乙`, region: "north", stake_id: stake.id },
      ]),
    );
    memberIds[label] = must(
      await admin
        .from("committee_members")
        .insert({ conference_id: id, name: `${label}測試丁`, stake_id: stake.id, relief_society_presidency: true, bio: `我是${label}測試丁。` })
        .select("id")
        .single(),
    ).id;
    must(await admin.from("committee_members").insert({ conference_id: id, name: `${label}王測試`, stake_id: stake.id }));
    must(
      await admin
        .from("committee_meetings")
        .insert({ conference_id: id, title: `${label}第 1 次會議`, meeting_date: "2001-01-10", url: "https://www.canva.com/x" }),
    );
    must(
      await admin
        .from("committee_links")
        .insert({ conference_id: id, position: 1, title: `${label}執行計畫試算表`, url: "https://docs.google.com/x" }),
    );
  }
});

afterEach(async () => {
  cleanup();
  navigation.pathname = "/committee";
  navigation.search = "";
  // 目前年度是共用的測試資料，只刪這裡加的；其他年度整個刪掉，名單一起刪除。
  for (const table of ["committee_texts", "committee_team_members", "committee_members", "committee_meetings", "committee_links"]) {
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

type YearPage = (props: { searchParams: Promise<{ year?: string }>; params: Promise<object> }) => Promise<ReactElement>;
const open = (page: YearPage, year?: string) =>
  renderPage(page({ searchParams: Promise.resolve(year ? { year } : {}), params: Promise.resolve({}) }));

it("沒登入打開公開網址：首頁是目前年度的大會簡介", async () => {
  await open(IntroductionPage as YearPage);

  expect(screen.getByRole("heading", { level: 1, name: "大會簡介" })).toBeTruthy();
  expect(screen.getByText("今年的大會簡介")).toBeTruthy();
  expect(screen.queryByText("今年主席的話")).toBeNull();
});

it("主席的話、執行計畫各一頁；執行計畫下面列出重要連結", async () => {
  await open(ChairMessagePage as YearPage);
  expect(screen.getByText("今年主席的話")).toBeTruthy();
  cleanup();

  await open(PlanPage as YearPage);
  expect(screen.getByText("今年的執行計畫")).toBeTruthy();
  expect(screen.getByRole("link", { name: /今年執行計畫試算表/ }).getAttribute("href")).toBe("https://docs.google.com/x");
});

it("會議記錄頁：最上面是備忘錄，下面是會議記錄", async () => {
  await open(MeetingsPage as YearPage);

  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
  expect(headings).toEqual(["籌備委員會備忘錄", "會議記錄"]);
  expect(screen.getByText("今年的備忘錄")).toBeTruthy();
  expect(screen.getByRole("link", { name: /今年第 1 次會議/ })).toBeTruthy();
});

it("工作團隊是一張表：組別、擔任職務、姓名、所屬區域、所屬支聯會，依組別再依職務排列", async () => {
  await open(TeamPage as YearPage);

  const rows = tableRows(screen.getByRole("table") as HTMLTableElement);
  expect(rows).toEqual([
    ["組別", "擔任職務", "姓名", "所屬區域", "所屬支聯會"],
    ["總召團", "總召", "今年測試甲", "全區", stake.name_zh],
    ["課務組", "組長", "今年測試乙", "北區", stake.name_zh],
    ["課務組", "副組長", "今年測試丙", "南區", stake.name_zh],
  ]);
});

it("籌備委員依區分組，每位一張卡片連到個人頁；沒有照片時顯示姓氏；可以搜尋姓名或支聯會", async () => {
  const regions: Record<string, string> = { north: "北區", central: "中區", south: "南區" };
  await open(MembersPage as YearPage);

  expect(screen.getByText("來自全台 1 個支聯會、共 2 位姐妹，依北、中、南區排列。")).toBeTruthy();
  const region = screen.getByRole("heading", { level: 2, name: regions[stake.region] }).closest("section")!;
  const card = within(region).getByRole("link", { name: new RegExp(`今年測試丁.*${stake.name_zh}`) });
  expect(card.getAttribute("href")).toBe(`/committee/members/${memberIds["今年"]}`);
  expect(card.textContent).toMatch(/^今今年測試丁/);

  const search = screen.getByLabelText("搜尋姓名或支聯會");
  fireEvent.change(search, { target: { value: "王" } });
  expect(screen.queryByText("今年測試丁")).toBeNull();
  expect(screen.getByText("今年王測試")).toBeTruthy();
  fireEvent.change(search, { target: { value: stake.name_zh } });
  expect(screen.getByText("今年測試丁")).toBeTruthy();
  fireEvent.change(search, { target: { value: "不存在的名字" } });
  expect(screen.getByText("找不到符合的委員。")).toBeTruthy();
});

it("看過去的年度時，委員卡片連到的個人頁、個人頁的「回到委員名單」都帶著年度", async () => {
  await open(MembersPage as YearPage, "2001");
  const card = screen.getByRole("link", { name: /2001測試丁/ });
  expect(card.getAttribute("href")).toBe(`/committee/members/${memberIds["2001"]}?year=2001`);
  cleanup();

  await renderPage(MemberPage({ params: Promise.resolve({ memberId: memberIds["2001"] }), searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: /回到委員名單/ }).getAttribute("href")).toBe("/committee/members?year=2001");
});

it("個人頁：支聯會、姓名與自我介紹；還沒到的年度、不存在的委員找不到", async () => {
  await renderPage(MemberPage({ params: Promise.resolve({ memberId: memberIds["今年"] }), searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { level: 1, name: "今年測試丁" })).toBeTruthy();
  expect(screen.getByText(`${stake.name_zh}・慈助會會長團`)).toBeTruthy();
  expect(screen.getByText("我是今年測試丁。")).toBeTruthy();
  cleanup();

  for (const memberId of [memberIds["2099"], "00000000-0000-4000-8000-000000000000", "abc"]) {
    await expect(
      renderPage(MemberPage({ params: Promise.resolve({ memberId }), searchParams: Promise.resolve({}) })),
    ).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  }
});

it("可以選過去的年度；還沒到的年度看不到，也不在選單裡", async () => {
  await open(IntroductionPage as YearPage, "2001");
  expect(screen.getByText("2001的大會簡介")).toBeTruthy();
  expect(screen.queryByRole("option", { name: /2099/ })).toBeNull();
  cleanup();

  // 網址改成還沒到的年度：當成沒選，顯示目前年度。
  await open(IntroductionPage as YearPage, "2099");
  expect(screen.queryByText("2099的大會簡介")).toBeNull();
  expect(screen.getByText("今年的大會簡介")).toBeTruthy();
});

it("選單：依序是七項，標出目前這一頁；看過去的年度時換頁帶著年度，大會網站連到前台首頁", () => {
  navigation.pathname = `/committee/members/${"0".repeat(8)}`;
  navigation.search = "year=2001";
  render(<CommitteeNav />);

  const links = within(screen.getByRole("navigation")).getAllByRole("link");
  expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["大會簡介", "/committee?year=2001"],
    ["主席的話", "/committee/chair-message?year=2001"],
    ["會議記錄", "/committee/meetings?year=2001"],
    ["工作團隊", "/committee/team?year=2001"],
    ["籌備委員", "/committee/members?year=2001"],
    ["執行計畫", "/committee/plan?year=2001"],
    ["大會網站", "/"],
  ]);
  expect(screen.getByRole("link", { current: "page" }).textContent).toBe("籌備委員");
});

it("不給搜尋引擎收錄，前台首頁也沒有連到這裡", async () => {
  expect(metadata.robots).toEqual({ index: false, follow: false });

  await renderPage(Home());
  expect(document.querySelector('a[href^="/committee"]')).toBeNull();
});
