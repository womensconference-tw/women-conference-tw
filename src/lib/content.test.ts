import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, databaseClient, must, signedInClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";
import {
  deleteHomeItem,
  getContentEditor,
  isSafeButtonUrl,
  missingEnglish,
  moveHomeItem,
  parseTaipeiDateTime,
  saveConferenceDetails,
  saveHomeItem,
  saveSchedule,
  toTaipeiDateTimeInput,
  type ConferenceDetailsInput,
  type HomeItemInput,
  type ScheduleInput,
} from "./content";
import { getHomeContent } from "./home-content";

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
      adminLine: { id: "@twsisters" },
    });
    const en = await getHomeContent(anonClient(), "en");
    expect(en).toMatchObject({
      themeScripture: { text: "All thy children shall be taught of the Lord", reference: "Isaiah 54:13" },
      welcome: "Welcome, sisters",
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
    try {
      // 另一位總管理員正在換目前年度，還沒提交。
      let commit!: () => void;
      const mayCommit = new Promise<void>((resolve) => (commit = resolve));
      let started!: (pid: number) => void;
      const switcherPid = new Promise<number>((resolve) => (started = resolve));
      const switched = switcher.begin(async (tx) => {
        await tx`update public.conferences set is_current = false where id = ${conferenceId!}`;
        const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
        started(pid);
        await mayCommit;
      });
      const pid = await switcherPid;

      // 這時候讀到的還是目前年度；寫入要等換年度做完。
      const results = Promise.all([
        saveItem({ kind: "block", titleZh: "新的" }),
        saveItem({ kind: "block", id: block, titleZh: "改了" }),
        moveHomeItem(headAdmin, "block", block, "up"),
        deleteHomeItem(headAdmin, "block", block),
      ]);
      for (let waited = 0; ; waited += 50) {
        const [{ blocked }] = await watcher<{ blocked: number }[]>`
          select count(*)::int as blocked from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`;
        if (blocked === 4) break;
        if (waited > 10_000) throw new Error("儲存沒有排在換年度後面");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      commit();
      await switched;

      expect(await results).toEqual(Array(4).fill({ ok: false, error: "not_found" }));
      expect(must(await admin.from("custom_blocks").select("title_zh").eq("conference_id", conferenceId!))).toEqual([
        { title_zh: "舊年度的" },
      ]);
    } finally {
      await Promise.all([switcher.end(), watcher.end()]);
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
