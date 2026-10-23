import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { adminClient, anonClient, databaseClient, must, signedInClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";
import {
  deleteHighlightPerson,
  deleteHomeItem,
  getContentEditor,
  isSafeButtonUrl,
  missingEnglish,
  moveHighlightPerson,
  moveHomeItem,
  parseTaipeiDateTime,
  saveConferenceDetails,
  saveHighlightPerson,
  saveHighlightVenue,
  saveHomeItem,
  saveSchedule,
  toTaipeiDateTimeInput,
  type ConferenceDetailsInput,
  type HighlightPersonInput,
  type HomeItemInput,
  type ScheduleInput,
} from "./content";
import { getHighlight, getHomeContent } from "./home-content";

const admin = adminClient();
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個還沒開放報名的 2099 目前年度、一位總管理員、一位北區課務組、一位北區報報組；測完全部刪掉。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));

  const now = Date.now();
  conferenceId = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: new Date(now - 2 * DAY).toISOString(),
        registration_opens_at: new Date(now + DAY).toISOString(),
        registration_closes_at: new Date(now + 2 * DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;

  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "course@example.com", role: "course_team", region: "north" },
    { email: "report@example.com", role: "registration_team", region: "north" },
  ];
  for (const { email, ...scope } of staff) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
  }
  [headAdmin, courseTeam, registrationTeam] = await Promise.all(staff.map(({ email }) => signedInClient(email)));
});

afterEach(async () => {
  must(await admin.from("staff_members").delete().not("user_id", "is", null));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  // 刪掉年度大會時，它的常見問題與自訂區塊一起刪除。
  if (conferenceId) must(await admin.from("conferences").delete().eq("id", conferenceId));
  conferenceId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

// 沒選人物版型的介紹頁，人物版型的欄位都是空的。
const ordinaryPage = { template: null, subtitle: "", leadQuote: "", leadQuoteSource: "", people: [] };

/** 表單上的台灣時間（datetime-local 的格式），距離現在 offset 毫秒。 */
function taipei(offset: number): string {
  return toTaipeiDateTimeInput(new Date(Date.now() + offset).toISOString());
}

const details: Omit<ConferenceDetailsInput, "conferenceId"> = {
  conferenceDate: "2099-05-16",
  startTime: "09:00",
  endTime: "16:30",
  themeScriptureZh: "你的兒女都要受耶和華的教訓",
  themeScriptureEn: "All thy children shall be taught of the Lord",
  themeScriptureReferenceZh: "以賽亞書 54:13",
  themeScriptureReferenceEn: "Isaiah 54:13",
  welcomeZh: "歡迎姐妹們",
  welcomeEn: "Welcome, sisters",
  welcomeSignatureZh: "2099台灣姐妹大會籌備委員會",
  welcomeSignatureEn: "",
  adminLineId: " @twsisters ",
};

async function saveDetails(changes: Partial<ConferenceDetailsInput> = {}, client = headAdmin) {
  return saveConferenceDetails(client, { conferenceId: conferenceId!, ...details, ...changes });
}

async function schedule(input: Omit<ScheduleInput, "conferenceId">, client = headAdmin) {
  return saveSchedule(client, { conferenceId: conferenceId!, ...input });
}

async function saveItem(input: Omit<HomeItemInput, "conferenceId">, client = headAdmin) {
  return saveHomeItem(client, { conferenceId: conferenceId!, ...input });
}

async function savedItem(input: Omit<HomeItemInput, "conferenceId">) {
  const result = await saveItem(input);
  if (!result.ok) throw new Error(`新增${input.kind}失敗：${result.error}`);
  return result.id;
}

async function blockTitles() {
  return (await getHomeContent(anonClient(), "zh"))!.customBlocks.map((block) => block.title);
}

type Database = ReturnType<typeof databaseClient>;

/** 開一個交易做完 `work` 後先不提交，等 release() 才提交。失敗時 release() 也要呼叫，交易才會結束、放開鎖。 */
function holdOpen(client: Database, work: (tx: TransactionSql) => Promise<unknown>) {
  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => (release = resolve));
  let started!: (pid: number) => void;
  let failed!: (error: unknown) => void;
  const pid = new Promise<number>((resolve, reject) => ((started = resolve), (failed = reject)));
  const done = client.begin(async (tx) => {
    await work(tx);
    const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    started(pid);
    await mayCommit;
  });
  // 交易還沒拿到 pid 就失敗時，等 pid 的人也要知道。
  done.catch(failed);
  return { pid, release, done };
}

/** 正在等 `pid` 放開鎖的連線。 */
async function waitingFor(watcher: Database, pid: number): Promise<number[]> {
  const rows = await watcher<{ pid: number }[]>`
    select pid from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`;
  return rows.map((row) => row.pid);
}

async function blockedBy(watcher: Database, pid: number): Promise<number> {
  return (await waitingFor(watcher, pid)).length;
}

async function waitUntil(message: string, condition: () => Promise<boolean>) {
  for (let waited = 0; !(await condition()); waited += 50) {
    if (waited > 10_000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("台灣時間", () => {
  it("表單上的台灣時間換成資料庫的時間", () => {
    expect(parseTaipeiDateTime("2027-03-01T09:00")).toBe("2027-03-01T01:00:00.000Z");
    expect(parseTaipeiDateTime("2027-03-01T09:00:30")).toBe("2027-03-01T01:00:30.000Z");
    expect(parseTaipeiDateTime(" ")).toBeNull();
  });

  it.each(["2027-02-30T09:00", "2027-03-01", "2027-03-01T25:00", "明天"])("「%s」不是有效的時間", (raw) => {
    expect(parseTaipeiDateTime(raw)).toBeUndefined();
  });

  it("資料庫的時間換成表單上的台灣時間", () => {
    expect(toTaipeiDateTimeInput("2027-03-01T01:00:00+00:00")).toBe("2027-03-01T09:00");
    expect(toTaipeiDateTimeInput("2027-02-28T16:30:45Z")).toBe("2027-03-01T00:30");
    expect(toTaipeiDateTimeInput(null)).toBe("");
  });
});

describe("英文缺漏警示", () => {
  it("中文有填、英文空白時要警示", () => {
    expect(missingEnglish("歡迎", "")).toBe(true);
    expect(missingEnglish("歡迎", "  ")).toBe(true);
    expect(missingEnglish("歡迎", "Welcome")).toBe(false);
    // 中文也沒填，前台不會顯示，不必警示。
    expect(missingEnglish("", "")).toBe(false);
  });
});

describe("按鈕網址", () => {
  it.each(
    ["\ufeff", "\u00a0", "\u0085", "\u2028", "\u3000", "\u200b", "\t", "\u007f", "é"].map((char) => [
      char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
      char,
    ]),
  )(
    "網址中間有 U+%s 時，後台和資料庫的判斷一樣",
    async (_, char) => {
      const url = `/a${char}b`;
      const { error } = await admin
        .from("custom_blocks")
        .insert({ conference_id: conferenceId, title_zh: "測試", button_label_zh: "按", button_url: url });
      expect(error === null).toBe(isSafeButtonUrl(url));
    },
  );

  it.each(["https://example.com/a?b=1", "HTTP://example.com", "/lookup", "/"])("接受「%s」", (url) => {
    expect(isSafeButtonUrl(url)).toBe(true);
  });

  it.each(["javascript:alert(1)", "//evil.example", "/\\evil.example", "https://", "/a b", "/\tx", "example.com"])(
    "不接受「%s」",
    (url) => {
      expect(isSafeButtonUrl(url)).toBe(false);
    },
  );
});

describe("總管理員編輯年度內容", () => {
  it("存檔後首頁立即顯示新的內容，英文版顯示英文", async () => {
    expect(await saveDetails()).toEqual({ ok: true });

    const zh = await getHomeContent(anonClient(), "zh");
    expect(zh).toMatchObject({
      time: { start: "09:00", end: "16:30" },
      themeScripture: { text: "你的兒女都要受耶和華的教訓", reference: "以賽亞書 54:13" },
      welcome: "歡迎姐妹們",
      welcomeSignature: "2099台灣姐妹大會籌備委員會",
      adminLine: { id: "@twsisters" },
    });
    const en = await getHomeContent(anonClient(), "en");
    expect(en).toMatchObject({
      themeScripture: { text: "All thy children shall be taught of the Lord", reference: "Isaiah 54:13" },
      welcome: "Welcome, sisters",
      // 英文署名沒填，顯示中文。
      welcomeSignature: "2099台灣姐妹大會籌備委員會",
    });
    expect((await getCurrentConference(anonClient(), new Date()))!.conferenceDate).toBe("2099-05-16");
  });

  it("後台讀得到中英兩欄，可以帶進表單", async () => {
    await saveDetails({ welcomeEn: "" });

    const editor = await getContentEditor(headAdmin);
    expect(editor).toMatchObject({
      conferenceId,
      year: 2099,
      conferenceDate: "2099-05-16",
      startTime: "09:00",
      endTime: "16:30",
      welcomeZh: "歡迎姐妹們",
      welcomeEn: "",
      adminLineId: "@twsisters",
      registrationOpened: false,
    });
  });

  it("時間與 LINE 可以清空", async () => {
    await saveDetails();
    expect(await saveDetails({ startTime: "", endTime: "", adminLineId: "" })).toEqual({ ok: true });

    const content = await getHomeContent(anonClient(), "zh");
    expect(content).toMatchObject({ time: null, adminLine: null });
  });

  it("頁面開著時目前年度換了，不會改到舊年度", async () => {
    const block = await savedItem({ kind: "block", titleZh: "舊年度的" });
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));

    expect(await saveDetails({ welcomeZh: "改到舊年度" })).toEqual({ ok: false, error: "not_found" });
    expect(
      await schedule({ announceAt: taipei(-DAY), registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await saveItem({ kind: "block", titleZh: "新的" })).toEqual({ ok: false, error: "not_found" });
    expect(await saveItem({ kind: "block", id: block, titleZh: "改了" })).toEqual({ ok: false, error: "not_found" });
    expect(await moveHomeItem(headAdmin, "block", block, "down")).toEqual({ ok: false, error: "not_found" });
    expect(await deleteHomeItem(headAdmin, "block", block)).toEqual({ ok: false, error: "not_found" });
    const stored = must(await admin.from("conferences").select("welcome_zh").eq("id", conferenceId!).single());
    expect(stored.welcome_zh).toBe("");
    expect(must(await admin.from("custom_blocks").select("title_zh").eq("conference_id", conferenceId!))).toEqual([
      { title_zh: "舊年度的" },
    ]);
  });

  it("確認是目前年度之後、寫入之前年度被換掉，也不會改到舊年度", async () => {
    const block = await savedItem({ kind: "block", titleZh: "舊年度的" });
    const [switcher, watcher] = [databaseClient(), databaseClient()];
    // 另一位總管理員正在換目前年度，還沒提交。
    const switching = holdOpen(switcher, (tx) => tx`update public.conferences set is_current = false where id = ${conferenceId!}`);
    try {
      const pid = await switching.pid;

      // 這時候讀到的還是目前年度；寫入要等換年度做完。
      const results = Promise.all([
        saveItem({ kind: "block", titleZh: "新的" }),
        saveItem({ kind: "block", id: block, titleZh: "改了" }),
        moveHomeItem(headAdmin, "block", block, "up"),
        deleteHomeItem(headAdmin, "block", block),
      ]);
      await waitUntil("儲存沒有排在換年度後面", async () => (await blockedBy(watcher, pid)) === 4);
      switching.release();
      await switching.done;

      expect(await results).toEqual(Array(4).fill({ ok: false, error: "not_found" }));
      expect(must(await admin.from("custom_blocks").select("title_zh").eq("conference_id", conferenceId!))).toEqual([
        { title_zh: "舊年度的" },
      ]);
    } finally {
      switching.release();
      await switching.done.catch(() => {});
      await Promise.all([switcher.end(), watcher.end()]);
    }
  });

  it("已經確認是目前年度、正在寫入時，換年度要等寫完", async () => {
    const block = await savedItem({ kind: "block", titleZh: "原本的" });
    const [holder, switcher, watcher] = [databaseClient(), databaseClient(), databaseClient()];
    // 先鎖住這個區塊，讓儲存拿到年度的鎖之後，卡在寫入這一步。
    const holding = holdOpen(holder, (tx) => tx`select 1 from public.custom_blocks where id = ${block} for update`);
    let switchDone: Promise<unknown> = Promise.resolve();
    try {
      const holderPid = await holding.pid;
      const saving = saveItem({ kind: "block", id: block, titleZh: "改了" });
      let savePid: number | undefined;
      await waitUntil("儲存沒有卡在寫入", async () => {
        [savePid] = await waitingFor(watcher, holderPid);
        return savePid !== undefined;
      });

      // 這時候才開始換年度：儲存拿著年度的鎖，換年度要排在它後面。
      switchDone = switcher.begin((tx) => tx`update public.conferences set is_current = false where id = ${conferenceId!}`);
      await waitUntil("換年度沒有等儲存", async () => (await blockedBy(watcher, savePid!)) === 1);
      holding.release();

      expect(await saving).toEqual({ ok: true, id: block });
      await switchDone;
      expect(must(await admin.from("custom_blocks").select("title_zh").eq("id", block).single()).title_zh).toBe("改了");
    } finally {
      holding.release();
      await Promise.all([holding.done.catch(() => {}), switchDone.catch(() => {})]);
      await Promise.all([holder.end(), switcher.end(), watcher.end()]);
    }
  });

  it.each([
    [{ conferenceDate: "" }, "date_invalid"],
    [{ conferenceDate: "2099-02-30" }, "date_invalid"],
    [{ startTime: "25:00" }, "time_invalid"],
    [{ startTime: "", endTime: "16:30" }, "time_invalid"],
    [{ startTime: "17:00", endTime: "16:30" }, "time_invalid"],
    [{ adminLineId: "line id 有空白" }, "line_id_invalid"],
  ] as const)("%o 不能存（%s）", async (changes, error) => {
    expect(await saveDetails(changes)).toEqual({ ok: false, error });
  });
});

describe("時程時間點", () => {
  it("把報名開放改到現在之前，首頁立即變成報名中；截止改到現在之前，變成已截止", async () => {
    expect(await schedule({ announceAt: taipei(-2 * DAY), registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({ ok: true });
    expect((await getCurrentConference(anonClient(), new Date()))!.phase).toBe("upcoming");

    expect(await schedule({ announceAt: taipei(-2 * DAY), registrationOpensAt: taipei(-DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({ ok: true });
    expect((await getCurrentConference(anonClient(), new Date()))!.phase).toBe("open");

    expect(await schedule({ announceAt: taipei(-2 * DAY), registrationClosesAt: taipei(-2 * MINUTE) })).toEqual({ ok: true });
    expect((await getCurrentConference(anonClient(), new Date()))!.phase).toBe("closed");
  });

  it("目前年度的三個時間點都要填", async () => {
    expect(await schedule({ announceAt: "", registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({
      ok: false,
      error: "schedule_incomplete",
    });
  });

  it("要依公告上線、報名開放、報名截止的順序", async () => {
    expect(await schedule({ announceAt: taipei(DAY), registrationOpensAt: taipei(-DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({
      ok: false,
      error: "schedule_order",
    });
    expect(await schedule({ announceAt: taipei(-DAY), registrationOpensAt: taipei(2 * DAY), registrationClosesAt: taipei(DAY) })).toEqual({
      ok: false,
      error: "schedule_order",
    });
  });

  it("不是有效的時間就不存", async () => {
    expect(await schedule({ announceAt: "明天", registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({
      ok: false,
      error: "schedule_invalid",
    });
  });

  it("報名開放後不能再改開放時間，但可以改另外兩個；送回同一分鐘的開放時間也可以", async () => {
    const opensAt = taipei(-DAY);
    await schedule({ announceAt: taipei(-2 * DAY), registrationOpensAt: opensAt, registrationClosesAt: taipei(2 * DAY) });

    expect(await schedule({ announceAt: taipei(-2 * DAY), registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) })).toEqual({
      ok: false,
      error: "opens_at_locked",
    });
    expect(await schedule({ announceAt: taipei(-3 * DAY), registrationClosesAt: taipei(3 * DAY) })).toEqual({ ok: true });
    expect(await schedule({ announceAt: taipei(-3 * DAY), registrationOpensAt: opensAt, registrationClosesAt: taipei(3 * DAY) })).toEqual({ ok: true });
    expect((await getContentEditor(headAdmin))!.registrationOpened).toBe(true);
  });
});

describe("自訂區塊", () => {
  it("新增的區塊依序顯示在首頁，可以往前、往後移", async () => {
    const first = await savedItem({ kind: "block", titleZh: "一", bodyZh: "第一則" });
    const second = await savedItem({ kind: "block", titleZh: "二" });
    const third = await savedItem({ kind: "block", titleZh: "三" });
    expect(await blockTitles()).toEqual(["一", "二", "三"]);

    expect(await moveHomeItem(headAdmin, "block", third, "up")).toEqual({ ok: true });
    expect(await blockTitles()).toEqual(["一", "三", "二"]);
    expect(await moveHomeItem(headAdmin, "block", first, "down")).toEqual({ ok: true });
    expect(await blockTitles()).toEqual(["三", "一", "二"]);
    // 已經在最後，不動。
    expect(await moveHomeItem(headAdmin, "block", second, "down")).toEqual({ ok: true });
    expect(await blockTitles()).toEqual(["三", "一", "二"]);
  });

  it("排序數字重複時也能移動", async () => {
    const ids = [await savedItem({ kind: "block", titleZh: "一" }), await savedItem({ kind: "block", titleZh: "二" })];
    must(await admin.from("custom_blocks").update({ position: 0 }).in("id", ids));
    const [before] = await blockTitles();

    const id = before === "一" ? ids[0] : ids[1];
    expect(await moveHomeItem(headAdmin, "block", id, "down")).toEqual({ ok: true });
    expect((await blockTitles())[1]).toBe(before);
  });

  it("中英標題、內文與按鈕都存下，可以修改與刪除", async () => {
    const id = await savedItem({
      kind: "block",
      titleZh: "交通資訊",
      titleEn: "Getting there",
      bodyZh: "搭捷運",
      bodyEn: "Take the MRT",
      buttonLabelZh: "看地圖",
      buttonLabelEn: "Map",
      buttonUrl: " https://maps.example.com ",
    });
    expect((await getHomeContent(anonClient(), "en"))!.customBlocks).toEqual([
      { title: "Getting there", body: "Take the MRT", button: { label: "Map", url: "https://maps.example.com" } },
    ]);

    expect(await saveItem({ kind: "block", id, titleZh: "交通", buttonUrl: "" })).toMatchObject({ ok: true, id });
    expect((await getHomeContent(anonClient(), "zh"))!.customBlocks).toEqual([{ title: "交通", body: "", button: null }]);
    expect((await getContentEditor(headAdmin))!.customBlocks).toMatchObject([{ id, titleZh: "交通", titleEn: "" }]);

    expect(await deleteHomeItem(headAdmin, "block", id)).toEqual({ ok: true });
    expect(await blockTitles()).toEqual([]);
    expect(await deleteHomeItem(headAdmin, "block", id)).toEqual({ ok: false, error: "not_found" });
  });

  it.each([
    [{ titleZh: " " }, "title_required"],
    [{ titleZh: "標題", buttonUrl: "javascript:alert(1)", buttonLabelZh: "按我" }, "button_url_invalid"],
    [{ titleZh: "標題", buttonUrl: "https://example.com" }, "button_label_required"],
  ] as const)("%o 不能存（%s）", async (input, error) => {
    expect(await saveItem({ kind: "block", ...input })).toEqual({ ok: false, error });
  });
});

describe("常見問題", () => {
  it("問題與答案都要填；存下後依序顯示在首頁", async () => {
    expect(await saveItem({ kind: "faq", titleZh: "要帶什麼？", bodyZh: "" })).toEqual({ ok: false, error: "body_required" });

    await savedItem({ kind: "faq", titleZh: "要帶什麼？", bodyZh: "經文", titleEn: "What to bring?", bodyEn: "Scriptures" });
    const second = await savedItem({ kind: "faq", titleZh: "可以停車嗎？", bodyZh: "車位有限" });
    expect(await moveHomeItem(headAdmin, "faq", second, "up")).toEqual({ ok: true });

    expect((await getHomeContent(anonClient(), "en"))!.faqs).toEqual([
      { question: "可以停車嗎？", answer: "車位有限" },
      { question: "What to bring?", answer: "Scriptures" },
    ]);
    expect((await getContentEditor(headAdmin))!.faqs.map((faq) => faq.titleZh)).toEqual(["可以停車嗎？", "要帶什麼？"]);
  });
});

describe("大會特色", () => {
  async function cards(locale: "zh" | "en" = "zh") {
    return (await getHomeContent(anonClient(), locale))!.highlights.map(({ name, summary, linkable }) => ({
      name,
      summary,
      linkable,
    }));
  }

  it("新增的大會特色依序顯示在首頁，可以往前、往後移、修改、刪除", async () => {
    const choir = await savedItem({ kind: "highlight", titleZh: "即席唱詩班", summaryZh: " 跟著影片練唱 " });
    const service = await savedItem({ kind: "highlight", titleZh: "公益服務" });
    expect(await cards()).toEqual([
      { name: "即席唱詩班", summary: "跟著影片練唱", linkable: false },
      { name: "公益服務", summary: "", linkable: false },
    ]);

    expect(await moveHomeItem(headAdmin, "highlight", service, "up")).toEqual({ ok: true });
    expect((await cards()).map((card) => card.name)).toEqual(["公益服務", "即席唱詩班"]);

    expect(
      await saveItem({ kind: "highlight", id: choir, titleZh: "唱詩班", titleEn: "Choir", summaryZh: "練唱", bodyZh: "## 練唱" }),
    ).toMatchObject({ ok: true, id: choir });
    expect((await getContentEditor(headAdmin))!.highlights).toMatchObject([
      { id: service, titleZh: "公益服務" },
      { id: choir, titleZh: "唱詩班", titleEn: "Choir", summaryZh: "練唱", summaryEn: "", bodyZh: "## 練唱", bodyEn: "" },
    ]);

    expect(await deleteHomeItem(headAdmin, "highlight", service)).toEqual({ ok: true });
    expect((await cards()).map((card) => card.name)).toEqual(["唱詩班"]);
  });

  it("名稱要填", async () => {
    expect(await saveItem({ kind: "highlight", titleZh: " ", bodyZh: "內容" })).toEqual({ ok: false, error: "title_required" });
  });

  it("寫了介紹內容的才有介紹頁；英文沒填時顯示中文", async () => {
    const choir = await savedItem({
      kind: "highlight",
      titleZh: "即席唱詩班",
      titleEn: "Choir",
      summaryZh: "跟著影片練唱",
      bodyZh: "先看[練唱影片](https://www.youtube.com/)",
    });
    const empty = await savedItem({ kind: "highlight", titleZh: "靜態展示" });

    expect(await cards("en")).toEqual([
      { name: "Choir", summary: "跟著影片練唱", linkable: true },
      { name: "靜態展示", summary: "", linkable: false },
    ]);
    expect(await getHighlight(anonClient(), choir, "en")).toEqual({
      name: "Choir",
      description: "先看[練唱影片](https://www.youtube.com/)",
      venues: [],
      ...ordinaryPage,
    });
    expect(await getHighlight(anonClient(), empty, "zh")).toBeNull();
    expect(await getHighlight(anonClient(), "不是編號", "zh")).toBeNull();
  });

  it("過去年度的大會特色沒有介紹頁", async () => {
    const other = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    try {
      const old = must(
        await admin
          .from("highlights")
          .insert({ conference_id: other, name_zh: "去年的", description_zh: "去年的內容" })
          .select("id")
          .single(),
      ).id;
      // 總管理員讀得到每個年度的資料，也一樣只有目前年度的才有介紹頁。
      expect(await getHighlight(anonClient(), old, "zh")).toBeNull();
      expect(await getHighlight(headAdmin, old, "zh")).toBeNull();
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("課務組、報報組與訪客都不能新增、修改、排序、刪除", async () => {
    const id = await savedItem({ kind: "highlight", titleZh: "原本的" });
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveItem({ kind: "highlight", titleZh: "新的" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await saveItem({ kind: "highlight", id, titleZh: "被改了" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await moveHomeItem(client, "highlight", id, "up")).toEqual({ ok: false, error: "not_admin" });
      expect(await deleteHomeItem(client, "highlight", id)).toEqual({ ok: false, error: "not_admin" });

      // 直接寫資料庫也改不到。
      expect((await client.from("highlights").insert({ conference_id: conferenceId, name_zh: "偷加" })).error).not.toBeNull();
      expect((await client.from("highlights").update({ name_zh: "被改了" }).eq("id", id).select("id")).data ?? []).toEqual([]);
      expect((await client.from("highlights").delete().eq("id", id).select("id")).data ?? []).toEqual([]);
      expect((await client.rpc("move_home_item", { p_table: "highlights", p_id: id, p_up: true })).error).not.toBeNull();
    }
    expect((await cards()).map((card) => card.name)).toEqual(["原本的"]);
  });

  it("權限規則：總管理員也不能直接把大會特色換到別的年度", async () => {
    const id = await savedItem({ kind: "highlight", titleZh: "特色" });
    const other = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    try {
      expect((await headAdmin.from("highlights").update({ conference_id: other }).eq("id", id)).error?.code).toBe("42501");
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });
});

describe("大會特色的教堂分頁", () => {
  async function venue(position: number, nameZh: string, nameEn = "") {
    return must(
      await admin
        .from("venues")
        .insert({ conference_id: conferenceId, position, region: "north", name_zh: nameZh, name_en: nameEn })
        .select("id")
        .single(),
    ).id as string;
  }

  async function course(venueId: string, session: { position: number; nameZh: string }, title: string, extra = {}) {
    const sessionId = must(
      await admin
        .from("sessions")
        .upsert(
          { conference_id: conferenceId, venue_id: venueId, position: session.position, name_zh: session.nameZh },
          { ignoreDuplicates: false },
        )
        .select("id")
        .single(),
    ).id;
    must(await admin.from("courses").insert({ conference_id: conferenceId, session_id: sessionId, title_zh: title, ...extra }));
    return sessionId as string;
  }

  it("只有寫了說明或有課程的教堂出現分頁，照場地的順序；課程照場次排，英文缺漏顯示中文", async () => {
    const corner = await savedItem({ kind: "highlight", titleZh: "角落課程", titleEn: "Corner classes" });
    const other = await savedItem({ kind: "highlight", titleZh: "靈性課程" });
    const daya = await venue(2, "台中大雅教堂", "Taichung Daya Chapel");
    const jinhua = await venue(1, "台北金華教堂");
    await venue(3, "高雄鳥松教堂");
    const second = await course(jinhua, { position: 2, nameZh: "第二場次" }, "免揉麵包", {
      highlight_id: corner,
      speaker_zh: "王淑娟",
    });
    must(await admin.from("courses").insert({ conference_id: conferenceId, session_id: second, title_zh: "別類的課", highlight_id: other }));
    await course(jinhua, { position: 1, nameZh: "第一場次" }, "花圈", { highlight_id: corner, title_en: "Wreath" });

    expect(
      await saveHighlightVenue(headAdmin, { highlightId: corner, venueId: daya, bodyZh: " 在**二樓** ", bodyEn: "" }),
    ).toEqual({ ok: true });

    expect(await getHighlight(anonClient(), corner, "en")).toEqual({
      name: "Corner classes",
      description: "",
      venues: [
        {
          id: jinhua,
          name: "台北金華教堂",
          body: "",
          courses: [
            { title: "Wreath", speaker: "", sessionName: "第一場次" },
            { title: "免揉麵包", speaker: "王淑娟", sessionName: "第二場次" },
          ],
        },
        { id: daya, name: "Taichung Daya Chapel", body: "在**二樓**", courses: [] },
      ],
      ...ordinaryPage,
    });

    const editor = (await getContentEditor(headAdmin))!.highlights.find((item) => item.id === corner)!;
    expect(editor.linkable).toBe(true);
    expect(editor.venues.map(({ venueName, bodyZh, courseCount }) => [venueName, bodyZh, courseCount])).toEqual([
      ["台北金華教堂", "", 2],
      ["台中大雅教堂", "在**二樓**", 0],
      ["高雄鳥松教堂", "", 0],
    ]);
  });

  it("只有教堂說明、沒有簡介也沒有課程，首頁卡片照樣能點；清空說明後不能點，介紹頁找不到", async () => {
    const concert = await savedItem({ kind: "highlight", titleZh: "迷妳音樂會" });
    const jinhua = await venue(1, "台北金華教堂");
    expect(await cards()).toEqual([{ name: "迷妳音樂會", summary: "", linkable: false }]);

    expect(await saveHighlightVenue(headAdmin, { highlightId: concert, venueId: jinhua, bodyZh: "午后演出", bodyEn: "Afternoon" })).toEqual({
      ok: true,
    });
    expect(await cards()).toEqual([{ name: "迷妳音樂會", summary: "", linkable: true }]);
    expect((await getHighlight(anonClient(), concert, "en"))?.venues).toEqual([
      { id: jinhua, name: "台北金華教堂", body: "Afternoon", courses: [] },
    ]);

    // 只有英文說明不算有內容（中文版會是空的）。
    expect(await saveHighlightVenue(headAdmin, { highlightId: concert, venueId: jinhua, bodyZh: " ", bodyEn: "Afternoon" })).toEqual({
      ok: true,
    });
    expect(await cards()).toEqual([{ name: "迷妳音樂會", summary: "", linkable: false }]);

    expect(await saveHighlightVenue(headAdmin, { highlightId: concert, venueId: jinhua, bodyZh: "", bodyEn: " " })).toEqual({ ok: true });
    expect(must(await admin.from("highlight_venues").select("venue_id").eq("highlight_id", concert))).toEqual([]);
    expect(await getHighlight(anonClient(), concert, "zh")).toBeNull();
  });

  it("別的年度的教堂、找不到的大會特色、不是目前年度的都不能存", async () => {
    const concert = await savedItem({ kind: "highlight", titleZh: "迷妳音樂會" });
    const jinhua = await venue(1, "台北金華教堂");
    const other = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    try {
      const oldVenue = must(
        await admin.from("venues").insert({ conference_id: other, region: "north", name_zh: "去年的" }).select("id").single(),
      ).id;
      const oldHighlight = must(
        await admin.from("highlights").insert({ conference_id: other, name_zh: "去年的" }).select("id").single(),
      ).id;
      const save = (highlightId: string, venueId: string) =>
        saveHighlightVenue(headAdmin, { highlightId, venueId, bodyZh: "說明", bodyEn: "" });
      expect(await save(concert, oldVenue)).toEqual({ ok: false, error: "not_found" });
      expect(await save(oldHighlight, oldVenue)).toEqual({ ok: false, error: "not_found" });
      expect(await save(crypto.randomUUID(), jinhua)).toEqual({ ok: false, error: "not_found" });
      expect(await save("不是編號", jinhua)).toEqual({ ok: false, error: "not_found" });
      expect(must(await admin.from("highlight_venues").select("venue_id").eq("conference_id", conferenceId!))).toEqual([]);
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("課務組、報報組與訪客都不能存，直接寫資料庫也不行", async () => {
    const concert = await savedItem({ kind: "highlight", titleZh: "迷妳音樂會" });
    const jinhua = await venue(1, "台北金華教堂");
    expect(await saveHighlightVenue(headAdmin, { highlightId: concert, venueId: jinhua, bodyZh: "原本的", bodyEn: "" })).toEqual({
      ok: true,
    });
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveHighlightVenue(client, { highlightId: concert, venueId: jinhua, bodyZh: "被改了", bodyEn: "" })).toEqual({
        ok: false,
        error: "not_admin",
      });
      const row = { conference_id: conferenceId, highlight_id: concert, venue_id: jinhua, body_zh: "被改了" };
      expect((await client.from("highlight_venues").upsert(row)).error).not.toBeNull();
      expect((await client.from("highlight_venues").update({ body_zh: "被改了" }).eq("highlight_id", concert).select("venue_id")).data ?? []).toEqual(
        [],
      );
      expect((await client.from("highlight_venues").delete().eq("highlight_id", concert).select("venue_id")).data ?? []).toEqual([]);
      const rpc = await client.rpc("save_highlight_venue", {
        p_highlight_id: concert,
        p_venue_id: jinhua,
        p_body_zh: "被改了",
        p_body_en: "",
      });
      expect(rpc.error).not.toBeNull();
    }
    expect(must(await admin.from("highlight_venues").select("body_zh").eq("conference_id", conferenceId!))).toEqual([{ body_zh: "原本的" }]);
  });

  it("刪除大會特色或教堂時，分頁說明一起刪除", async () => {
    const concert = await savedItem({ kind: "highlight", titleZh: "迷妳音樂會" });
    const corner = await savedItem({ kind: "highlight", titleZh: "角落課程" });
    const jinhua = await venue(1, "台北金華教堂");
    const daya = await venue(2, "台中大雅教堂");
    for (const [highlightId, venueId] of [[concert, jinhua], [corner, daya]]) {
      expect(await saveHighlightVenue(headAdmin, { highlightId, venueId, bodyZh: "說明", bodyEn: "" })).toEqual({ ok: true });
    }
    expect(await deleteHomeItem(headAdmin, "highlight", concert)).toEqual({ ok: true });
    must(await admin.from("venues").delete().eq("id", daya));
    expect(must(await admin.from("highlight_venues").select("venue_id").eq("conference_id", conferenceId!))).toEqual([]);
  });

  async function cards() {
    return (await getHomeContent(anonClient(), "zh"))!.highlights.map(({ name, summary, linkable }) => ({ name, summary, linkable }));
  }
});

describe("介紹頁的人物版型", () => {
  const person = (highlightId: string, changes: Partial<HighlightPersonInput> = {}): HighlightPersonInput => ({
    highlightId,
    stakeZh: "",
    stakeEn: "",
    wardZh: "",
    wardEn: "",
    nameZh: "",
    nameEn: "",
    photoPath: "",
    photoFocus: "50",
    linkLabelZh: "",
    linkLabelEn: "",
    linkUrl: "",
    ...changes,
  });

  async function honor() {
    return savedItem({
      kind: "highlight",
      titleZh: "向貴賓致敬",
      titleEn: "Honouring our guests",
      pageTemplate: "honor",
      subtitleZh: " 80 歲長輩，持守到底的美好榜樣。 ",
      leadQuoteZh: "在我們當中，有一群特別值得尊敬的姐妹。",
      leadQuoteEn: "Among us are sisters who deserve special honour.",
      leadQuoteSourceZh: "",
    });
  }

  async function linkable() {
    return (await getHomeContent(anonClient(), "zh"))!.highlights.map((card) => card.linkable);
  }

  it("選了版型、還沒有介紹內容也沒有人物時不能點；加了人物就能點，介紹頁照順序列出人物", async () => {
    const id = await honor();
    expect(await linkable()).toEqual([false]);
    expect(await getHighlight(anonClient(), id, "zh")).toBeNull();

    const photo = `${conferenceId}/${crypto.randomUUID()}.jpg`;
    expect(
      await saveHighlightPerson(
        headAdmin,
        person(id, {
          stakeZh: "中台北支聯會",
          wardZh: "蘆洲支會",
          wardEn: "Luzhou Ward",
          nameZh: " 沈亦斌 姐妹 ",
          nameEn: "Sister Shen",
          photoPath: photo,
          photoFocus: "25",
          linkUrl: "/highlights/story",
        }),
      ),
    ).toEqual({ ok: true });
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "黃蘋 姐妹", photoFocus: "120" }))).toEqual({ ok: true });
    expect(await linkable()).toEqual([true]);

    const page = (await getHighlight(anonClient(), id, "en"))!;
    expect(page).toMatchObject({
      name: "Honouring our guests",
      description: "",
      venues: [],
      template: "honor",
      // 英文沒填時顯示中文。
      subtitle: "80 歲長輩，持守到底的美好榜樣。",
      leadQuote: "Among us are sisters who deserve special honour.",
      leadQuoteSource: "",
    });
    expect(page.people.map(({ photoUrl, ...rest }) => ({ ...rest, photo: photoUrl?.endsWith(photo) ?? null }))).toMatchObject([
      {
        stake: "中台北支聯會",
        ward: "Luzhou Ward",
        name: "Sister Shen",
        photo: true,
        photoFocus: 25,
        linkLabel: "",
        linkUrl: "/highlights/story",
      },
      // 對準位置超出範圍時當成中間。
      { stake: "", ward: "", name: "黃蘋 姐妹", photo: null, photoFocus: 50, linkLabel: "", linkUrl: null },
    ]);

    const editor = (await getContentEditor(headAdmin))!.highlights[0];
    expect(editor).toMatchObject({ pageTemplate: "honor", subtitleZh: "80 歲長輩，持守到底的美好榜樣。", linkable: true });
    expect(editor.people.map((p) => [p.nameZh, p.photo?.path ?? null])).toEqual([
      ["沈亦斌 姐妹", photo],
      ["黃蘋 姐妹", null],
    ]);
  });

  it("人物可以修改、往前或往後移、刪除；刪光了又沒有介紹內容就不能點", async () => {
    const id = await honor();
    for (const nameZh of ["甲", "乙", "丙"]) {
      expect(await saveHighlightPerson(headAdmin, person(id, { nameZh }))).toEqual({ ok: true });
    }
    const people = async () => (await getContentEditor(headAdmin))!.highlights[0].people;
    const [first, second, third] = await people();

    expect(await moveHighlightPerson(headAdmin, third.id, "up")).toEqual({ ok: true });
    expect(await moveHighlightPerson(headAdmin, first.id, "up")).toEqual({ ok: true });
    expect((await people()).map((p) => p.nameZh)).toEqual(["甲", "丙", "乙"]);

    expect(
      await saveHighlightPerson(headAdmin, person(id, { id: second.id, nameZh: "乙改", linkLabelZh: "作品", linkUrl: "https://example.com/a" })),
    ).toEqual({ ok: true });
    expect((await people()).find((p) => p.id === second.id)).toMatchObject({
      nameZh: "乙改",
      linkLabelZh: "作品",
      linkUrl: "https://example.com/a",
    });

    for (const p of await people()) expect(await deleteHighlightPerson(headAdmin, p.id)).toEqual({ ok: true });
    expect(await linkable()).toEqual([false]);
  });

  it("只寫了介紹內容也能點；教堂說明與課程不算，介紹頁也不分教堂", async () => {
    const id = await honor();
    const venue = must(
      await admin
        .from("venues")
        .insert({ conference_id: conferenceId, position: 1, region: "north", name_zh: "台北金華教堂" })
        .select("id")
        .single(),
    ).id as string;
    expect(await saveHighlightVenue(headAdmin, { highlightId: id, venueId: venue, bodyZh: "在一樓", bodyEn: "" })).toEqual({ ok: true });
    expect(await linkable()).toEqual([false]);

    expect(await saveItem({ kind: "highlight", id, titleZh: "向貴賓致敬", pageTemplate: "honor", bodyZh: "介紹" })).toMatchObject({
      ok: true,
    });
    expect(await linkable()).toEqual([true]);
    expect(await getHighlight(anonClient(), id, "zh")).toMatchObject({ description: "介紹", venues: [], people: [] });

    // 改回一般介紹頁：教堂分頁又出現，人物版型的欄位不顯示。
    expect(await saveItem({ kind: "highlight", id, titleZh: "向貴賓致敬", pageTemplate: "", bodyZh: "介紹" })).toMatchObject({
      ok: true,
    });
    expect(await getHighlight(anonClient(), id, "zh")).toMatchObject({
      template: null,
      subtitle: "",
      venues: [{ id: venue, body: "在一樓" }],
    });
  });

  it("姓名要填，連結網址要安全；版型、照片路徑不對當成找不到", async () => {
    const id = await honor();
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: " " }))).toEqual({ ok: false, error: "person_name_required" });
    for (const linkUrl of ["javascript:alert(1)", "//evil.example", "https://a b"]) {
      expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "甲", linkUrl }))).toEqual({
        ok: false,
        error: "link_url_invalid",
      });
    }
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "甲", photoPath: "../別人的/檔案.jpg" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await saveItem({ kind: "highlight", titleZh: "特色", pageTemplate: "gallery" })).toEqual({ ok: false, error: "not_found" });

    // 直接寫資料庫也擋下。
    const insert = (row: Record<string, unknown>) =>
      admin.from("highlight_people").insert({ conference_id: conferenceId, highlight_id: id, name_zh: "甲", ...row });
    expect((await insert({ link_url: "javascript:alert(1)" })).error?.message).toContain("highlight_people_link_url_safe");
    expect((await insert({ photo_path: "a/b.gif" })).error?.message).toContain("highlight_people_photo_path_valid");
    expect((await insert({ photo_focus: 101 })).error?.message).toContain("highlight_people_photo_focus_range");
    expect((await admin.from("highlights").update({ page_template: "gallery" }).eq("id", id)).error?.message).toContain(
      "highlights_page_template_valid",
    );
  });

  it("過去年度、找不到的大會特色或人物都不能改", async () => {
    const id = await honor();
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "甲" }))).toEqual({ ok: true });
    const [existing] = (await getContentEditor(headAdmin))!.highlights[0].people;
    const missing = crypto.randomUUID();
    expect(await saveHighlightPerson(headAdmin, person(missing, { nameZh: "甲" }))).toEqual({ ok: false, error: "not_found" });
    expect(await saveHighlightPerson(headAdmin, person(id, { id: missing, nameZh: "甲" }))).toEqual({ ok: false, error: "not_found" });
    expect(await deleteHighlightPerson(headAdmin, missing)).toEqual({ ok: false, error: "not_found" });
    expect(await moveHighlightPerson(headAdmin, "不是編號", "up")).toEqual({ ok: false, error: "not_found" });

    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "乙" }))).toEqual({ ok: false, error: "not_found" });
    expect(await saveHighlightPerson(headAdmin, person(id, { id: existing.id, nameZh: "改" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await moveHighlightPerson(headAdmin, existing.id, "up")).toEqual({ ok: false, error: "not_found" });
    expect(await deleteHighlightPerson(headAdmin, existing.id)).toEqual({ ok: false, error: "not_found" });
    expect(must(await admin.from("highlight_people").select("name_zh").eq("highlight_id", id))).toEqual([{ name_zh: "甲" }]);
  });

  it("課務組、報報組與訪客都不能新增、修改、排序、刪除，直接寫資料庫也不行", async () => {
    const id = await honor();
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "甲" }))).toEqual({ ok: true });
    const [existing] = (await getContentEditor(headAdmin))!.highlights[0].people;
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveHighlightPerson(client, person(id, { nameZh: "偷加" }))).toEqual({ ok: false, error: "not_admin" });
      expect(await saveHighlightPerson(client, person(id, { id: existing.id, nameZh: "被改了" }))).toEqual({
        ok: false,
        error: "not_admin",
      });
      expect(await moveHighlightPerson(client, existing.id, "down")).toEqual({ ok: false, error: "not_admin" });
      expect(await deleteHighlightPerson(client, existing.id)).toEqual({ ok: false, error: "not_admin" });

      expect(
        (await client.from("highlight_people").insert({ conference_id: conferenceId, highlight_id: id, name_zh: "偷加" })).error,
      ).not.toBeNull();
      expect((await client.from("highlight_people").update({ name_zh: "被改了" }).eq("id", existing.id).select("id")).data ?? []).toEqual(
        [],
      );
      expect((await client.from("highlight_people").delete().eq("id", existing.id).select("id")).data ?? []).toEqual([]);
      expect((await client.rpc("save_highlight_person", { p_highlight_id: id, p_id: null, p_values: { name_zh: "偷加" } })).error).not.toBeNull();
    }
    expect(must(await admin.from("highlight_people").select("name_zh").eq("highlight_id", id))).toEqual([{ name_zh: "甲" }]);
  });

  it("刪除大會特色時，人物一起刪除", async () => {
    const id = await honor();
    expect(await saveHighlightPerson(headAdmin, person(id, { nameZh: "甲" }))).toEqual({ ok: true });
    expect(await deleteHomeItem(headAdmin, "highlight", id)).toEqual({ ok: true });
    expect(must(await admin.from("highlight_people").select("id").eq("conference_id", conferenceId!))).toEqual([]);
  });
});

describe("只有總管理員能編輯", () => {
  it("課務組、報報組與訪客透過後台都被擋下", async () => {
    const id = await savedItem({ kind: "block", titleZh: "原本的" });
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveDetails({ welcomeZh: "被改了" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(
        await schedule({ announceAt: taipei(-DAY), registrationOpensAt: taipei(-DAY / 2), registrationClosesAt: taipei(DAY) }, client),
      ).toEqual({ ok: false, error: "not_admin" });
      expect(await saveItem({ kind: "block", titleZh: "新的" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await moveHomeItem(client, "block", id, "up")).toEqual({ ok: false, error: "not_admin" });
      expect(await deleteHomeItem(client, "block", id)).toEqual({ ok: false, error: "not_admin" });
    }
    expect(await blockTitles()).toEqual(["原本的"]);
  });

  it("權限規則：非總管理員直接寫資料庫也改不到", async () => {
    const block = await savedItem({ kind: "block", titleZh: "原本的" });
    const faq = await savedItem({ kind: "faq", titleZh: "問", bodyZh: "答" });

    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      const updated = await client.from("conferences").update({ welcome_zh: "被改了" }).eq("id", conferenceId!).select("id");
      expect(updated.data ?? []).toEqual([]);
      expect((await client.from("custom_blocks").insert({ conference_id: conferenceId, title_zh: "偷加" })).error).not.toBeNull();
      expect((await client.from("faqs").insert({ conference_id: conferenceId, question_zh: "偷加", answer_zh: "偷加" })).error).not.toBeNull();
      expect((await client.from("custom_blocks").update({ title_zh: "被改了" }).eq("id", block).select("id")).data ?? []).toEqual([]);
      expect((await client.from("faqs").delete().eq("id", faq).select("id")).data ?? []).toEqual([]);
      expect((await client.rpc("move_home_item", { p_table: "custom_blocks", p_id: block, p_up: true })).error).not.toBeNull();
    }

    const stored = must(await admin.from("conferences").select("welcome_zh").eq("id", conferenceId!).single());
    expect(stored.welcome_zh).toBe("");
    expect(await blockTitles()).toEqual(["原本的"]);
    expect(must(await admin.from("faqs").select("id").eq("id", faq))).toHaveLength(1);
  });

  it("權限規則：總管理員也不能直接把常見問題或自訂區塊換到別的年度", async () => {
    const block = await savedItem({ kind: "block", titleZh: "區塊" });
    const faq = await savedItem({ kind: "faq", titleZh: "問", bodyZh: "答" });
    const other = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    try {
      expect((await headAdmin.from("custom_blocks").update({ conference_id: other }).eq("id", block)).error?.code).toBe("42501");
      expect((await headAdmin.from("faqs").update({ conference_id: other }).eq("id", faq)).error?.code).toBe("42501");
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("權限規則：總管理員也不能直接換目前年度或年度", async () => {
    const isCurrent = await headAdmin.from("conferences").update({ is_current: false }).eq("id", conferenceId!);
    expect(isCurrent.error?.code).toBe("42501");
    const year = await headAdmin.from("conferences").update({ year: 2098 }).eq("id", conferenceId!);
    expect(year.error?.code).toBe("42501");
  });
});
