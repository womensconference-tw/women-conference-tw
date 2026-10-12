import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, databaseClient, must } from "../../test/supabase";
import {
  isRegistrationNumber,
  submitRegistration,
  validateCourseChoices,
  type CourseChoices,
  type RegistrationInput,
} from "./registration";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let venueId: string;
let stakeIds: string[] = [];
let taipeiStakeId: string;
let xindianWardId: string;
let taichungWardId: string;

// 每個測試都有一個報名中的 2099 年度大會（報名期間包住現在），一個場地，
// 兩個支聯會各有支會；測完全部刪掉、復原原本的目前年度。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));

  const now = Date.now();
  const conference = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: new Date(now - 2 * DAY).toISOString(),
        registration_opens_at: new Date(now - DAY).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  );
  conferenceId = conference.id;

  venueId = must(
    await admin
      .from("venues")
      .insert({ conference_id: conferenceId, name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" })
      .select("id")
      .single(),
  ).id;

  const [taipei, taichung] = must(
    await admin
      .from("stakes")
      .insert([
        { position: 1, name_zh: "測試台北支聯會", name_en: "Test Taipei Stake" },
        { position: 2, name_zh: "測試台中支聯會", name_en: "Test Taichung Stake" },
      ])
      .select("id, position")
      .order("position"),
  );
  stakeIds = [taipei.id, taichung.id];
  taipeiStakeId = taipei.id;

  xindianWardId = must(
    await admin
      .from("wards")
      .insert({ stake_id: taipei.id, name_zh: "測試新店支會", name_en: "Test Xindian Ward" })
      .select("id")
      .single(),
  ).id;
  taichungWardId = must(
    await admin
      .from("wards")
      .insert({ stake_id: taichung.id, name_zh: "測試大雅支會", name_en: "Test Daya Ward" })
      .select("id")
      .single(),
  ).id;
});

afterEach(async () => {
  // 刪掉年度大會時，它的場地與報名一起刪除。
  if (conferenceId) must(await admin.from("conferences").delete().eq("id", conferenceId));
  conferenceId = undefined;
  if (stakeIds.length > 0) {
    must(await admin.from("wards").delete().in("stake_id", stakeIds));
    must(await admin.from("stakes").delete().in("id", stakeIds));
  }
  stakeIds = [];
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

function validInput(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    name: "王小美",
    phone: "0912-345-678",
    noPhone: false,
    email: "",
    lineId: "",
    stakeId: taipeiStakeId,
    wardId: xindianWardId,
    venueId,
    courseIds: [],
    portraitConsent: true,
    ...overrides,
  };
}

describe("送出報名", () => {
  it("資料齊全時報名成功，回傳存下的資料", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({ email: " mei@example.com ", lineId: "mei123" }),
    );

    expect(result).toEqual({
      ok: true,
      registration: {
        id: expect.any(String),
        name: "王小美",
        phone: "0912345678",
        registrationNumber: null,
        email: "mei@example.com",
        lineId: "mei123",
        stakeId: taipeiStakeId,
        wardId: xindianWardId,
        venueId,
        courseIds: [],
      },
    });
  });

  // 代報人用自己的電話幫家人報名。
  it("同一支電話可以報 3 位", async () => {
    const supabase = anonClient();
    const results = [];
    for (const name of ["王媽媽", "王小美", "王小華"]) {
      results.push(await submitRegistration(supabase, validInput({ name })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  it("沒有電話的人拿到 6 碼報名編號", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({ phone: "", noPhone: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.phone).toBeNull();
    expect(result.registration.registrationNumber).toMatch(/^[1-9]\d{5}$/);
    expect(isRegistrationNumber(result.registration.registrationNumber!)).toBe(true);
  });

  it("沒有同意肖像權不能送出", async () => {
    const result = await submitRegistration(anonClient(), validInput({ portraitConsent: false }));

    expect(result).toEqual({ ok: false, errors: { portraitConsent: "portraitConsentRequired" } });
  });

  it.each([
    { phase: "報名前", opensIn: DAY, closesIn: 2 * DAY },
    { phase: "已截止", opensIn: -2 * DAY, closesIn: -DAY },
  ])("$phase送出被拒絕", async ({ opensIn, closesIn }) => {
    const now = Date.now();
    must(
      await admin
        .from("conferences")
        .update({
          announce_at: new Date(now - 3 * DAY).toISOString(),
          registration_opens_at: new Date(now + opensIn).toISOString(),
          registration_closes_at: new Date(now + closesIn).toISOString(),
        })
        .eq("id", conferenceId!),
    );

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { form: "notOpen" } });
  });

  it("支會不屬於所選的支聯會時被拒絕", async () => {
    const result = await submitRegistration(anonClient(), validInput({ wardId: taichungWardId }));

    expect(result).toEqual({ ok: false, errors: { ward: "wardUnavailable" } });
  });

  // 教會重新劃分後，舊單位停用；報名表上已不顯示，送出時也不接受。
  it("停用的支會不能選", async () => {
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { ward: "wardUnavailable" } });
  });

  it("停用的支聯會不能選", async () => {
    must(await admin.from("stakes").update({ is_active: false }).eq("id", taipeiStakeId));

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { stake: "stakeUnavailable" } });
  });

  // 填表時場地被刪掉（或不屬於目前年度）：請她重新選，不是說她沒選。
  it("場地已不在可選的名單中時被拒絕", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({ venueId: crypto.randomUUID() }),
    );

    expect(result).toEqual({ ok: false, errors: { venue: "venueUnavailable" } });
  });

  it("每個有問題的欄位各自標出錯誤", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({
        name: "  ",
        phone: "",
        email: "mei@",
        lineId: "x".repeat(51),
        stakeId: "",
        wardId: "",
        venueId: "",
      }),
    );

    expect(result).toEqual({
      ok: false,
      errors: {
        name: "nameRequired",
        phone: "phoneRequired",
        email: "emailInvalid",
        lineId: "lineIdTooLong",
        stake: "stakeRequired",
        ward: "wardRequired",
        venue: "venueRequired",
      },
    });
  });

  it.each([
    { phone: "（02）2345-6789", saved: "0223456789" },
    { phone: "+886 912 345 678", saved: "+886912345678" },
    { phone: "０９１２３４５６７８", saved: "0912345678" },
  ])("電話 $phone 整理成 $saved", async ({ phone, saved }) => {
    const result = await submitRegistration(anonClient(), validInput({ phone }));

    expect(result.ok && result.registration.phone).toBe(saved);
  });

  it.each(["1234", "0912-ABC-678", "09123456789012345"])("電話 %s 格式不對", async (phone) => {
    const result = await submitRegistration(anonClient(), validInput({ phone }));

    expect(result).toEqual({ ok: false, errors: { phone: "phoneInvalid" } });
  });
});

// 場次與課程只能在開放報名前建立；測試的年度大會已在報名中，所以建立時先把報名開放時間暫時移到之後。
async function beforeOpening<T>(create: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const setOpensAt = async (time: number) =>
    must(
      await admin
        .from("conferences")
        .update({ registration_opens_at: new Date(time).toISOString() })
        .eq("id", conferenceId!),
    );
  await setOpensAt(now + DAY / 2);
  try {
    return await create();
  } finally {
    await setOpensAt(now - DAY);
  }
}

async function addSession(position: number, venue = venueId) {
  return beforeOpening(async () =>
    must(
      await admin
        .from("sessions")
        .insert({ conference_id: conferenceId, venue_id: venue, position, name_zh: `第${position}場` })
        .select("id")
        .single(),
    ).id,
  );
}

async function addCourse(sessionId: string, capacity: number | null, title = "測試課程") {
  return beforeOpening(async () =>
    must(
      await admin
        .from("courses")
        .insert({ conference_id: conferenceId, session_id: sessionId, title_zh: title, capacity })
        .select("id")
        .single(),
    ).id,
  );
}

// 名額在送出時於資料庫交易內一次檢查並佔用（ADR 0006）。
describe("課程名額", () => {
  async function registrationCount(name: string) {
    const rows = must(
      await admin.from("registrations").select("id").eq("conference_id", conferenceId!).eq("name", name),
    );
    return rows.length;
  }

  it("每個場次選一門課，報名成功並記下所選課程", async () => {
    const first = await addCourse(await addSession(1), 30);
    const second = await addCourse(await addSession(2), null);

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [first, second] }));

    expect(result.ok && result.registration.courseIds.toSorted()).toEqual([first, second].toSorted());
    if (!result.ok) return;
    const saved = must(
      await admin
        .from("registration_courses")
        .select("course_id")
        .eq("registration_id", result.registration.id),
    );
    expect(saved.map((row) => row.course_id).toSorted()).toEqual([first, second].toSorted());
  });

  // 兩個請求很少剛好在同一瞬間數名額，所以讓甲的報名寫到一半、交易還沒結束時，乙送出。
  // 有鎖住課程時，乙會等甲寫完才數到已滿；沒鎖的話乙不會等，測試直接失敗。
  it("最後一個名額兩人同時送出，只有一人成功，另一人收到額滿資訊且資料不寫入", async () => {
    const course = await addCourse(await addSession(1), 1);

    const second = await submitWhileHolding(
      (tx) => tx`
        select id from public.submit_registration(
          ${venueId}, ${taipeiStakeId}, ${xindianWardId}, '搶位甲', '0912345678', null, null, true,
          ${[course]}::uuid[]
        )`,
      () => submitRegistration(anonClient(), validInput({ name: "搶位乙", courseIds: [course] })),
    );

    expect(second).toEqual({ ok: false, errors: { courses: "courseFull" }, fullCourseIds: [course] });
    expect(await registrationCount("搶位甲")).toBe(1);
    expect(await registrationCount("搶位乙")).toBe(0);
  });

  it("任一門額滿則整筆不寫入，只回傳額滿的那門", async () => {
    const full = await addCourse(await addSession(1), 1);
    const open = await addCourse(await addSession(2), 10);
    expect((await submitRegistration(anonClient(), validInput({ name: "先報的", courseIds: [full, open] }))).ok).toBe(true);

    const result = await submitRegistration(
      anonClient(),
      validInput({ name: "後報的", courseIds: [full, open] }),
    );

    expect(result).toEqual({ ok: false, errors: { courses: "courseFull" }, fullCourseIds: [full] });
    expect(await registrationCount("後報的")).toBe(0);
  });

  it("不限人數的課程不會額滿", async () => {
    const course = await addCourse(await addSession(1), null);

    const results = [];
    for (const name of ["甲", "乙", "丙", "丁", "戊"]) {
      results.push(await submitRegistration(anonClient(), validInput({ name, courseIds: [course] })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true, true, true]);
  });

  it("已取消的報名不佔名額", async () => {
    const course = await addCourse(await addSession(1), 1);
    const first = await submitRegistration(anonClient(), validInput({ courseIds: [course] }));
    if (!first.ok) throw new Error("報名失敗");
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", first.registration.id),
    );

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [course] }));

    expect(result.ok).toBe(true);
  });

  // 有的姐妹不是每個時段都上課：沒存課程的場次就是「不選課」。
  it("有場次不選課也能報名，只存選了的課", async () => {
    const first = await addCourse(await addSession(1), null);
    await addCourse(await addSession(2), null);

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [first] }));

    expect(result.ok && result.registration.courseIds).toEqual([first]);
  });

  it("每個場次都不選課也能報名", async () => {
    await addCourse(await addSession(1), null);

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [] }));

    expect(result.ok).toBe(true);
  });

  it("同一場次選兩門課時被拒絕", async () => {
    const session = await addSession(1);
    const a = await addCourse(session, null, "甲課");
    const b = await addCourse(session, null, "乙課");

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [a, b] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("其他場地的課程不能選", async () => {
    await addCourse(await addSession(1), null);
    const otherVenue = must(
      await admin
        .from("venues")
        .insert({ conference_id: conferenceId, name_zh: "台中大雅教堂" })
        .select("id")
        .single(),
    ).id;
    const otherCourse = await addCourse(await addSession(1, otherVenue), null);

    const result = await submitRegistration(anonClient(), validInput({ courseIds: [otherCourse] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("課程數量多到不合理時直接擋下", async () => {
    const courseIds = Array.from({ length: 21 }, () => crypto.randomUUID());

    const result = await submitRegistration(anonClient(), validInput({ courseIds }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("課程編號格式不對時標在課程旁", async () => {
    const result = await submitRegistration(anonClient(), validInput({ courseIds: ["abc"] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });
});

/**
 * 在一個還沒結束的資料庫交易裡做 hold，交易開著時呼叫 submit；
 * 確認 submit 的送出函式真的卡在等這個交易的鎖之後，才結束交易，回傳 submit 的結果。
 * 送出函式一直沒有等這個交易（例如沒有上鎖），測試直接失敗，不靠時間碰運氣。
 */
async function submitWhileHolding<T>(
  hold: (tx: TransactionSql) => Promise<unknown>,
  submit: () => Promise<T>,
): Promise<T> {
  const sql = databaseClient();
  const watcher = databaseClient();
  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => (release = resolve));
  let held!: (pid: number) => void;
  const holding = new Promise<number>((resolve) => (held = resolve));
  const transaction = sql.begin(async (tx) => {
    const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    await hold(tx);
    held(pid);
    await mayCommit;
  });
  try {
    // 交易在通知之前就失敗（例如 hold 的 SQL 有錯）時，直接把錯誤拋出來，不要一直等下去。
    const holderPid = await Promise.race([
      holding,
      transaction.then(() => {
        throw new Error("交易結束了卻沒有進入等待狀態");
      }),
    ]);
    const submitted = submit();
    // 只認正在執行送出函式、而且被這個交易擋住的連線，其他連線的等待不算。
    for (let waited = 0; ; waited += 50) {
      const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity
          where ${holderPid}::int = any(pg_blocking_pids(pid))
            and query like '%submit_registration%'
        ) as blocked`;
      if (blocked) break;
      if (waited > 3000) throw new Error("送出函式沒有等那個交易的鎖：可能沒有上鎖");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release();
    await transaction;
    return await submitted;
  } finally {
    release();
    await transaction.catch(() => {});
    await Promise.all([sql.end(), watcher.end()]);
  }
}

// 課程與時段在開放報名前定案；開放後只能修正文字、調整名額與排序（GLOSSARY「報名開放」）。
describe("開放報名後的場次與課程", () => {
  let sessionId: string;
  let courseId: string;

  beforeEach(async () => {
    sessionId = await addSession(1);
    courseId = await addCourse(sessionId, 10);
  });

  it.each<[string, () => PromiseLike<{ error: { message: string } | null }>]>([
    [
      "新增場次",
      () => admin.from("sessions").insert({ conference_id: conferenceId, venue_id: venueId, name_zh: "新場次" }),
    ],
    [
      "新增課程",
      () => admin.from("courses").insert({ conference_id: conferenceId, session_id: sessionId, title_zh: "新課" }),
    ],
    ["刪除課程", () => admin.from("courses").delete().eq("id", courseId)],
    ["刪除場次", () => admin.from("sessions").delete().eq("id", sessionId)],
    [
      "把課程移到別的場次",
      async () => {
        const other = await addSession(2);
        return admin.from("courses").update({ session_id: other }).eq("id", courseId);
      },
    ],
    [
      "把場次移到別的場地",
      async () => {
        const otherVenue = must(
          await admin
            .from("venues")
            .insert({ conference_id: conferenceId, name_zh: "台中大雅教堂" })
            .select("id")
            .single(),
        ).id;
        return admin.from("sessions").update({ venue_id: otherVenue }).eq("id", sessionId);
      },
    ],
  ])("%s被拒絕", async (_, change) => {
    const { error } = await change();

    expect(error?.message).toBe("programme_locked");
  });

  it("可以修正文字、調整名額與排序", async () => {
    const results = [
      await admin
        .from("courses")
        .update({ title_zh: "改正的課名", description_zh: "講師：王姊妹", capacity: 40, position: 3 })
        .eq("id", courseId),
      await admin.from("courses").update({ capacity: null }).eq("id", courseId),
      await admin.from("sessions").update({ name_zh: "第一場 10:00–10:50", position: 2 }).eq("id", sessionId),
    ];

    expect(results.map((result) => result.error)).toEqual([null, null, null]);
  });

  // 刪除整個年度大會時，場次與課程跟著刪除，不受這條規則限制（每個測試結束時也靠這個清掉資料）。
  it("刪除整個年度大會時一起刪掉", async () => {
    const { error } = await admin.from("conferences").delete().eq("id", conferenceId!);
    conferenceId = undefined;

    expect(error).toBeNull();
  });
});

// 選課步驟按「下一步」時檢查每個場次都選了一門課或「不選課」，免得漏選。
describe("選課檢查", () => {
  const a = "00000000-0000-4000-8000-00000000000a";
  const b = "00000000-0000-4000-8000-00000000000b";
  const c = "00000000-0000-4000-8000-00000000000c";
  const sessions = [
    { id: "s1", courses: [{ id: a }, { id: b }] },
    { id: "s2", courses: [{ id: c }] },
    { id: "s3", courses: [] },
  ];

  it.each<{ what: string; choices: CourseChoices; error?: string }>([
    { what: "每個場次都選了一門", choices: { s1: a, s2: c }, error: undefined },
    { what: "一個場次選課、一個場次不選課", choices: { s1: a, s2: null }, error: undefined },
    { what: "每個場次都不選課", choices: { s1: null, s2: null }, error: undefined },
    { what: "有場次沒選也沒按不選課", choices: { s1: a }, error: "courseRequired" },
    // 課程被管理員移到別的場次後，原本那個場次的選擇不算數。
    { what: "選的課已不在那個場次", choices: { s1: c, s2: null }, error: "courseRequired" },
  ])("$what", ({ choices, error }) => {
    expect(validateCourseChoices(choices, sessions).courses).toBe(error);
  });
});

// 有人可能看不到的空白字元，報名服務與資料庫要用同一套規則判斷。
describe("看不見的空白字元", () => {
  it.each([
    { what: "姓名只有 U+0085", input: { name: "\u0085" }, errors: { name: "nameRequired" } },
    { what: "姓名只有 U+FEFF", input: { name: "\uFEFF" }, errors: { name: "nameRequired" } },
    {
      what: "Email 中間有 U+0085",
      input: { email: "mei\u0085@example.com" },
      errors: { email: "emailInvalid" },
    },
  ])("$what時標在該欄位旁", async ({ input, errors }) => {
    const result = await submitRegistration(anonClient(), validInput(input));

    expect(result).toEqual({ ok: false, errors });
  });

  it("前後的看不見空白會去掉", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({ name: "\uFEFF王小美\u0085", lineId: "\t", email: "\u00A0mei@example.com\u3000" }),
    );

    expect(result.ok && result.registration).toMatchObject({
      name: "王小美",
      lineId: null,
      email: "mei@example.com",
    });
  });
});

// 匿名訪客可以不經過報名服務，直接呼叫資料庫的送出函式，所以資料庫自己也要擋。
describe("直接呼叫資料庫的送出函式", () => {
  function callDirectly(overrides: Record<string, unknown> = {}) {
    return anonClient()
      .rpc("submit_registration", {
        p_venue_id: venueId,
        p_stake_id: taipeiStakeId,
        p_ward_id: xindianWardId,
        p_name: "王小美",
        p_phone: "0912345678",
        p_email: null,
        p_line_id: null,
        p_course_ids: [],
        p_portrait_consent: true,
        ...overrides,
      })
      .single<{ name: string; email: string | null; line_id: string | null }>();
  }

  it.each([false, null])("肖像權同意是 %s 時被拒絕", async (consent) => {
    const { error } = await callDirectly({ p_portrait_consent: consent });

    expect(error?.message).toBe("portrait_consent_required");
  });

  it("姓名只有看不見的空白時被拒絕", async () => {
    const { error } = await callDirectly({ p_name: "\uFEFF\u0085 " });

    expect(error).not.toBeNull();
  });

  it("和報名服務一樣去掉前後空白，只有空白的欄位存成空值", async () => {
    const { data } = await callDirectly({
      p_name: "\uFEFF王小美 ",
      p_email: " ",
      p_line_id: "\t",
    });

    expect(data).toMatchObject({ name: "王小美", email: null, line_id: null });
  });
});

describe("報名資料表", () => {
  it("匿名訪客無法直接讀取或列舉", async () => {
    const saved = await submitRegistration(anonClient(), validInput());
    expect(saved.ok).toBe(true);

    const { data } = await anonClient().from("registrations").select("*");

    expect(data ?? []).toEqual([]);
  });

  it("匿名訪客無法直接寫入", async () => {
    const { error } = await anonClient().from("registrations").insert({
      conference_id: conferenceId,
      venue_id: venueId,
      stake_id: taipeiStakeId,
      ward_id: xindianWardId,
      name: "王小美",
      phone: "0912345678",
      portrait_consented_at: new Date().toISOString(),
    });

    expect(error).not.toBeNull();
  });

  it("同時存下報名當下的支聯會與支會", async () => {
    const result = await submitRegistration(anonClient(), validInput());
    if (!result.ok) throw new Error("報名失敗");

    const row = must(
      await admin
        .from("registrations")
        .select("stake_id, ward_id, role, status")
        .eq("id", result.registration.id)
        .single(),
    );
    expect(row).toEqual({
      stake_id: taipeiStakeId,
      ward_id: xindianWardId,
      role: "attendee",
      status: "registered",
    });
  });
});

