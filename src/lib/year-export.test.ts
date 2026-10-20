import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { submitWhileHolding } from "../../test/hold-transaction";
import { adminClient, anonClient, databaseClient, must, serverClient, signedInClient } from "../../test/supabase";
import { readXlsx } from "../../test/xlsx";
import { sendConfirmationEmail, type SendEmail } from "./confirmation-email";
import { resendConfirmationEmail } from "./email-logs";
import {
  staffCancelRegistration,
  staffSubmitRegistration,
  staffUpdateRegistration,
  type StaffRegistrationChanges,
  type StaffRegistrationInput,
} from "./registration";
import { getStatistics } from "./statistics";
import {
  chineseNumber,
  clearPersonalData,
  conferenceEnded,
  exportYearExcel,
  getYearExportOverview,
  yearExcelFileName,
} from "./year-export";
import { writeXlsx } from "./xlsx";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string;
let otherConferenceId: string;
let stakeId: string;
let wardId: string;
let jinhuaId: string;
let dayaId: string;
let familyOneId: string;
let familyTwoId: string;
let musicId: string;
let healthId: string;
let wreathId: string;
let quiltingId: string;
let bentoId: string;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

/** 台北時間的日期（YYYY-MM-DD），offsetDays 天之後。 */
function taipeiDate(offsetDays: number): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000 + offsetDays * DAY).toISOString().slice(0, 10);
}

/*
 * 每個測試有一個已經結束的 2099 目前年度（大會日期是台北時間的昨天，報名已截止）：
 * - 測試金華教堂（第一個場地）：第一場（家譜（上）、詩歌欣賞）、第二場（家譜（下）、健康飲食）、午后動態（手作花圈）、
 *   最後一個沒有開課的場次（Excel 照樣列，每個人都是「不選課」）。家譜（上）（下）是成對課程。午餐素食便當。
 * - 測試大雅教堂（第二個場地）：只有第一場（拼布，限 1 人）。
 * 另有一個也已結束的 2098 年度（只有一個場地）。總管理員、課務組、全區報報組各一位。測完全部刪掉、復原原本的目前年度。
 */
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
        conference_date: taipeiDate(-1),
        announce_at: new Date(now - 3 * DAY).toISOString(),
        // 場地與課程要在開放前建好，建好後才把時程移到過去。
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
  otherConferenceId = must(
    await admin.from("conferences").insert({ year: 2098, conference_date: taipeiDate(-2) }).select("id").single(),
  ).id;
  must(await admin.from("venues").insert({ conference_id: otherConferenceId, region: "north", name_zh: "去年的教堂" }));

  const insert = async (table: string, row: Record<string, unknown>) =>
    must(await admin.from(table).insert({ conference_id: conferenceId, ...row }).select("id").single()).id as string;
  jinhuaId = await insert("venues", { region: "north", position: 1, name_zh: "測試金華教堂" });
  dayaId = await insert("venues", { region: "central", position: 2, name_zh: "測試大雅教堂" });
  const first = await insert("sessions", { venue_id: jinhuaId, position: 1, name_zh: "第一場 10:00–10:50" });
  const second = await insert("sessions", { venue_id: jinhuaId, position: 2, name_zh: "第二場 11:00–11:50" });
  const afternoon = await insert("sessions", { venue_id: jinhuaId, position: 3, name_zh: "午后動態 14:30–16:00" });
  await insert("sessions", { venue_id: jinhuaId, position: 4, name_zh: "沒有開課的場次" });
  const dayaFirst = await insert("sessions", { venue_id: dayaId, position: 1, name_zh: "第一場 10:00–10:50" });
  familyOneId = await insert("courses", { session_id: first, position: 1, title_zh: "家譜（上）", capacity: 20 });
  musicId = await insert("courses", { session_id: first, position: 2, title_zh: "詩歌欣賞" });
  familyTwoId = await insert("courses", { session_id: second, position: 1, title_zh: "家譜（下）", capacity: 20 });
  healthId = await insert("courses", { session_id: second, position: 2, title_zh: "健康飲食" });
  wreathId = await insert("courses", { session_id: afternoon, title_zh: "手作花圈" });
  quiltingId = await insert("courses", { session_id: dayaFirst, title_zh: "拼布", capacity: 1 });
  must(
    await admin
      .from("course_pairs")
      .insert({ conference_id: conferenceId, first_course_id: familyOneId, second_course_id: familyTwoId }),
  );
  bentoId = await insert("lunch_options", { venue_id: jinhuaId, name_zh: "素食便當", capacity: 30 });
  must(
    await admin
      .from("conferences")
      .update({
        registration_opens_at: new Date(now - 2 * DAY).toISOString(),
        registration_closes_at: new Date(now - DAY).toISOString(),
      })
      .eq("id", conferenceId),
  );

  stakeId = must(await admin.from("stakes").insert({ region: "north", name_zh: "測試匯出支聯會" }).select("id").single()).id;
  wardId = must(await admin.from("wards").insert({ stake_id: stakeId, name_zh: "測試匯出支會" }).select("id").single()).id;

  const staff = [
    { email: "head@example.com", name: "總管理員甲", role: "admin", region: null },
    { email: "course@example.com", name: null, role: "course_team", region: "north" },
    { email: "report@example.com", name: null, role: "registration_team", region: null },
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
  // 刪掉年度大會時，它的場地、課程、報名與匯出紀錄一起刪除。
  must(await admin.from("conferences").delete().in("id", [conferenceId, otherConferenceId]));
  must(await admin.from("wards").delete().eq("stake_id", stakeId));
  must(await admin.from("stakes").delete().eq("id", stakeId));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

function input(overrides: Partial<StaffRegistrationInput> = {}): StaffRegistrationInput {
  return {
    name: "王小美",
    phone: "0912345678",
    noPhone: false,
    email: "",
    lineId: "",
    stakeId,
    wardId,
    venueId: jinhuaId,
    courseIds: [],
    lunchOptionId: null,
    choirPart: null,
    services: [],
    printedHandbook: false,
    portraitConsent: true,
    role: "attendee",
    ...overrides,
  };
}

/** 總管理員在後台新增一筆報名（不受報名期間限制），回傳 id。 */
async function registered(overrides: Partial<StaffRegistrationInput> = {}, locale: "zh" | "en" = "zh") {
  const result = await staffSubmitRegistration(headAdmin, input(overrides), { confirmFull: true, locale });
  if (!result.ok) throw new Error(`報名失敗：${JSON.stringify(result.errors)}`);
  return result.registration.id;
}

/** 後台修改報名的內容：沿用 input 的聯絡資料與選擇，再蓋上 overrides。 */
function changes(overrides: Partial<StaffRegistrationChanges> = {}): StaffRegistrationChanges {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { name, stakeId: _stake, wardId: _ward, portraitConsent, ...rest } = input();
  return { ...rest, ...overrides };
}

async function changed(registrationId: string, overrides: Partial<StaffRegistrationChanges>) {
  return staffUpdateRegistration(headAdmin, { registrationId, changes: changes(overrides), confirmFull: true });
}

/** 總管理員下載年度 Excel，回傳匯出紀錄的編號與讀回的工作表。 */
async function downloaded(client = headAdmin, id = conferenceId) {
  const result = await exportYearExcel(client, id);
  if (!result.ok) throw new Error(`下載失敗：${result.error}`);
  return { exportId: result.exportId, sheets: readXlsx(result.bytes).sheets };
}

async function clear(exportId: string, client = headAdmin, id = conferenceId) {
  return clearPersonalData(client, { conferenceId: id, exportId, confirmed: true });
}

async function dataVersion(id = conferenceId): Promise<number> {
  return must(await admin.from("conference_data_versions").select("version").eq("conference_id", id).single()).version;
}

/** 報名資料表裡的個資與保留欄位，用來確認被拒時資料沒變、清除後只有個資被清掉。 */
async function storedRegistrations() {
  return must(
    await admin
      .from("registrations")
      .select(
        "id, name, phone, registration_number, email, line_id, submitted_phone, venue_id, stake_id, ward_id, lunch_option_id, choir_part, services, printed_handbook, role, locale, status, portrait_consented_at, cancelled_at, created_at, updated_at, personal_data_cleared_at, registration_courses(course_id)",
      )
      .eq("conference_id", conferenceId)
      .order("created_at"),
  );
}

async function clearedAt(id = conferenceId) {
  return must(await admin.from("conferences").select("personal_data_cleared_at").eq("id", id).single())
    .personal_data_cleared_at as string | null;
}

/** 在交易裡以某位工作人員的身分呼叫資料庫函式（和網站送來的請求一樣）。 */
async function actAs(tx: TransactionSql, email: string) {
  const [{ id }] = await tx<{ id: string }[]>`select id from auth.users where email = ${email}`;
  await tx`set local role authenticated`;
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: id, role: "authenticated" })}, true)`;
}

describe("大會結束的時間點", () => {
  it("大會日期翌日台北時間 00:00 才算結束", async () => {
    const sql = databaseClient();
    try {
      const [row] = await sql<{ before: boolean; at: boolean }[]>`
        select
          public.conference_ended('2099-05-15', '2099-05-15 23:59:59.999+08') as before,
          public.conference_ended('2099-05-15', '2099-05-16 00:00:00+08') as at`;
      expect(row).toEqual({ before: false, at: true });
    } finally {
      await sql.end();
    }
    expect(conferenceEnded("2099-05-15", new Date("2099-05-15T23:59:59.999+08:00"))).toBe(false);
    expect(conferenceEnded("2099-05-15", new Date("2099-05-16T00:00:00+08:00"))).toBe(true);
  });

  it("大會當天（翌日 00:00 前）不能下載、不能清除；過了翌日 00:00 就可以", async () => {
    await registered();
    must(await admin.from("conferences").update({ conference_date: taipeiDate(0) }).eq("id", conferenceId));
    expect(await exportYearExcel(headAdmin, conferenceId)).toEqual({ ok: false, error: "conference_not_ended" });
    expect(await clear(crypto.randomUUID())).toEqual({ ok: false, error: "conference_not_ended" });
    expect((await getYearExportOverview(headAdmin, conferenceId))?.ended).toBe(false);
    expect(must(await admin.from("year_exports").select("id").eq("conference_id", conferenceId))).toEqual([]);

    must(await admin.from("conferences").update({ conference_date: taipeiDate(-1) }).eq("id", conferenceId));
    const { exportId } = await downloaded();
    expect(await clear(exportId)).toMatchObject({ ok: true, alreadyCleared: false });
  });

  it("下載之後大會日期被改到未來，就不能清除", async () => {
    await registered();
    const { exportId } = await downloaded();
    must(await admin.from("conferences").update({ conference_date: taipeiDate(1) }).eq("id", conferenceId));
    expect(await clear(exportId)).toEqual({ ok: false, error: "conference_not_ended" });
    expect(await clearedAt()).toBeNull();
  });
});

describe("只有總管理員", () => {
  it("課務組、報報組、訪客不能下載、不能清除、看不到匯出紀錄（資料庫拒絕）", async () => {
    await registered();
    const { exportId } = await downloaded();
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await exportYearExcel(client, conferenceId)).toEqual({ ok: false, error: "not_admin" });
      expect(await clear(exportId, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await getYearExportOverview(client, conferenceId)).toBeNull();
      // 直接呼叫資料庫函式、直接讀資料表也一樣。
      expect((await client.rpc("start_year_export", { p_conference_id: conferenceId })).error).not.toBeNull();
      expect((await client.rpc("complete_year_export", { p_export_id: exportId })).error).not.toBeNull();
      const read = await client.from("year_exports").select("id");
      expect(read.data ?? []).toEqual([]);
    }
    expect(must(await admin.from("year_exports").select("id"))).toHaveLength(1);
    expect(await clearedAt()).toBeNull();
  });

  it("總管理員也不能直接寫匯出紀錄、版本號或清除時間，只能透過資料庫函式", async () => {
    await registered();
    const { exportId } = await downloaded();
    const inserted = await headAdmin
      .from("year_exports")
      .insert({ conference_id: conferenceId, data_version: 0, registration_count: 0, exported_by_name: "假的" });
    expect(inserted.error).not.toBeNull();
    expect((await headAdmin.from("year_exports").update({ data_version: 999 }).eq("id", exportId)).error).not.toBeNull();
    expect(must(await admin.from("year_exports").select("data_version").eq("id", exportId).single()).data_version).toBe(
      await dataVersion(),
    );
    expect(
      (await headAdmin.from("conferences").update({ personal_data_cleared_at: new Date().toISOString() }).eq("id", conferenceId))
        .error,
    ).not.toBeNull();
    expect((await headAdmin.from("conference_data_versions").select("version")).error).not.toBeNull();
    expect(await clearedAt()).toBeNull();
  });

  it("別的總管理員開始的匯出紀錄，不能替她標成完成", async () => {
    const user = must(await admin.auth.admin.createUser({ email: "head2@example.com", email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin" }));
    const started = must(await headAdmin.rpc("start_year_export", { p_conference_id: conferenceId })) as {
      export_id: string;
    };
    const other = await signedInClient("head2@example.com");
    expect((await other.rpc("complete_year_export", { p_export_id: started.export_id })).error?.message).toBe("not_found");
    expect((await getYearExportOverview(headAdmin, conferenceId))?.exports).toEqual([]);
  });

  it("各自確認自己那一份：別的總管理員下載的紀錄不能拿來清除", async () => {
    const user = must(await admin.auth.admin.createUser({ email: "head2@example.com", email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin" }));
    const other = await signedInClient("head2@example.com");
    await registered();
    const { exportId } = await downloaded(other);

    expect((await getYearExportOverview(headAdmin, conferenceId))?.exports).toEqual([
      expect.objectContaining({ id: exportId, mine: false, outdated: false }),
    ]);
    expect(await clear(exportId)).toEqual({ ok: false, error: "export_not_mine" });
    expect(await clearedAt()).toBeNull();
    expect(await clear(exportId, other)).toMatchObject({ ok: true, alreadyCleared: false });
  });
});

describe("年度 Excel 的內容", () => {
  it("名單依場地排序，欄位、順序與固定文字照舊試算表；成對課程兩欄都填，場次較少的場地填「不適用」", async () => {
    // 大雅的先報名，名單上仍排在金華後面（依場地順序）。
    await registered({ name: "林小華", venueId: dayaId, courseIds: [quiltingId], choirPart: "alto", role: "volunteer" });
    await registered({
      name: "王小美",
      courseIds: [familyOneId, familyTwoId, wreathId],
      lunchOptionId: bentoId,
      choirPart: "soprano",
      services: ["setup", "reception"],
      printedHandbook: true,
      email: "may@example.com",
      lineId: "may-line",
    });
    await registered(
      { name: "Mary Chen", phone: "0922333444", courseIds: [musicId], services: ["translation", "cleanup"], role: "speaker" },
      "en",
    );
    const cancelled = await registered({ name: "已取消的人", phone: "0933444555" });
    expect(await staffCancelRegistration(headAdmin, cancelled)).toEqual({ ok: true });

    const result = await exportYearExcel(headAdmin, conferenceId);
    if (!result.ok) throw new Error(result.error);
    const { sheets } = readXlsx(result.bytes);

    expect(sheets.map((sheet) => sheet.name)).toEqual(["名單", "場次對照"]);
    expect(sheets[0].rows).toEqual([
      [
        "姓名",
        "參加教堂",
        "報名語言",
        "午餐",
        "第一場次課程",
        "第二場次課程",
        "第三場次課程",
        "第四場次課程",
        "類別",
        "即席唱詩班",
        "事前準備志工",
        "翻譯人員",
        "當天接待志工",
        "事後復原志工",
        "是否要紙本手冊",
      ],
      ["王小美", "測試金華教堂", "zh", "素食便當", "家譜（上）", "家譜（下）", "手作花圈", "不選課", "與會姐妹", "女高音", "是", "否", "是", "否", "需要"],
      ["Mary Chen", "測試金華教堂", "en", "不需要", "詩歌欣賞", "不選課", "不選課", "不選課", "講師", "不參加", "否", "是", "否", "是", "不需要"],
      ["林小華", "測試大雅教堂", "zh", "不需要", "拼布", "不適用", "不適用", "不適用", "志工", "女低音", "否", "否", "否", "否", "不需要"],
    ]);
    expect(sheets[1].rows).toEqual([
      ["場地", "第一場次", "第二場次", "第三場次", "第四場次"],
      ["測試金華教堂", "第一場 10:00–10:50", "第二場 11:00–11:50", "午后動態 14:30–16:00", "沒有開課的場次"],
      ["測試大雅教堂", "第一場 10:00–10:50", "不適用", "不適用", "不適用"],
    ]);
    // 不含電話、Email、LINE ID、報名編號、支聯會、支會。
    const text = JSON.stringify(sheets);
    for (const hidden of ["0912345678", "may@example.com", "may-line", "測試匯出支聯會", "測試匯出支會", "已取消的人"]) {
      expect(text).not.toContain(hidden);
    }

    const overview = await getYearExportOverview(headAdmin, conferenceId);
    expect(overview).toMatchObject({ ended: true, clearedAt: null, registrationTotal: 4 });
    expect(overview?.exports).toEqual([
      {
        id: result.exportId,
        completedAt: expect.any(String),
        exportedByName: "總管理員甲",
        registrationCount: 3,
        outdated: false,
        mine: true,
      },
    ]);
  });

  it("零筆有效報名時「名單」只有表頭、「場次對照」仍列出年度設定，清除流程照樣完成", async () => {
    const cancelled = await registered();
    expect(await staffCancelRegistration(headAdmin, cancelled)).toEqual({ ok: true });
    const { exportId, sheets } = await downloaded();
    expect(sheets[0].rows).toHaveLength(1);
    expect(sheets[0].rows[0][4]).toBe("第一場次課程");
    expect(sheets[1].rows).toHaveLength(3);
    expect(await getYearExportOverview(headAdmin, conferenceId)).toMatchObject({
      registrationTotal: 1,
      exports: [{ registrationCount: 0 }],
    });
    expect(await clear(exportId)).toMatchObject({ ok: true, alreadyCleared: false });
    expect((await storedRegistrations())[0]).toMatchObject({ name: null, phone: null, status: "cancelled" });
  });

  it("場地都沒有場次的年度也下載得了，名單只有固定欄位", async () => {
    // 2098 年只有一個沒有場次的場地。
    const { sheets } = await downloaded(headAdmin, otherConferenceId);
    expect(sheets[0].rows).toEqual([
      ["姓名", "參加教堂", "報名語言", "午餐", "類別", "即席唱詩班", "事前準備志工", "翻譯人員", "當天接待志工", "事後復原志工", "是否要紙本手冊"],
    ]);
    expect(sheets[1].rows).toEqual([["場地"], ["去年的教堂"]]);
  });

  it("場次欄位用中文數字，檔名有年度", () => {
    expect([1, 2, 9, 10, 11, 12, 20, 21].map(chineseNumber)).toEqual(["一", "二", "九", "十", "十一", "十二", "二十", "二十一"]);
    expect(yearExcelFileName(2026)).toBe("2026 年姐妹大會名單.xlsx");
  });
});

describe("清除前的檢查", () => {
  it("沒下載、產檔失敗、只下載其他年度、沒勾確認時拒絕，資料不變", async () => {
    await registered({ email: "may@example.com" });
    const before = await storedRegistrations();

    // 沒下載：沒有任何匯出紀錄。
    expect(await clear(crypto.randomUUID())).toEqual({ ok: false, error: "export_not_found" });

    // 產檔失敗：匯出紀錄沒有完成，畫面不列，也不能拿來清除。
    const failed = exportYearExcel(headAdmin, conferenceId, () => {
      throw new Error("產檔失敗");
    });
    await expect(failed).rejects.toThrow("產檔失敗");
    const [pending] = must(await admin.from("year_exports").select("id, completed_at").eq("conference_id", conferenceId));
    expect(pending.completed_at).toBeNull();
    expect((await getYearExportOverview(headAdmin, conferenceId))?.exports).toEqual([]);
    expect(await clear(pending.id)).toEqual({ ok: false, error: "export_not_found" });

    // 只下載其他年度：那一筆不屬於這個年度。
    const { exportId: otherYear } = await downloaded(headAdmin, otherConferenceId);
    expect(await clear(otherYear)).toEqual({ ok: false, error: "export_not_found" });

    // 沒勾確認。
    const { exportId } = await downloaded();
    expect(await clearPersonalData(headAdmin, { conferenceId, exportId, confirmed: false })).toEqual({
      ok: false,
      error: "not_confirmed",
    });

    expect(await storedRegistrations()).toEqual(before);
    expect(await clearedAt()).toBeNull();
    expect(await clearedAt(otherConferenceId)).toBeNull();
  });

  it.each([
    ["新增", async () => void (await registered({ name: "後來的人", phone: "0955666777" }))],
    ["修改", async (id: string) => void (await changed(id, { choirPart: "alto" }))],
    ["取消", async (id: string) => void (await staffCancelRegistration(headAdmin, id))],
  ])("下載後有報名%s就拒絕，請重新下載；重新下載的那份可以清除", async (_, write) => {
    const id = await registered();
    const { exportId } = await downloaded();
    await write(id);
    const before = await storedRegistrations();

    expect(await clear(exportId)).toEqual({ ok: false, error: "export_outdated" });
    expect(await storedRegistrations()).toEqual(before);
    expect((await getYearExportOverview(headAdmin, conferenceId))?.exports).toEqual([
      expect.objectContaining({ id: exportId, outdated: true }),
    ]);

    const { exportId: again } = await downloaded();
    expect(await clear(again)).toMatchObject({ ok: true });
  });

  it("兩個分頁各自下載，確認綁定各自的匯出紀錄；其中一份過期時只有它被拒絕", async () => {
    const id = await registered();
    const { exportId: first } = await downloaded();
    await changed(id, { choirPart: "alto" });
    const { exportId: second } = await downloaded();

    const overview = await getYearExportOverview(headAdmin, conferenceId);
    expect(overview?.exports.map(({ id, outdated }) => ({ id, outdated }))).toEqual([
      { id: second, outdated: false },
      { id: first, outdated: true },
    ]);
    expect(await clear(first)).toEqual({ ok: false, error: "export_outdated" });
    expect(await clearedAt()).toBeNull();
    expect(await clear(second)).toMatchObject({ ok: true, alreadyCleared: false });
  });

  it("產檔期間別的總管理員清除了個資：這份不算完成，說明已經清除", async () => {
    const user = must(await admin.auth.admin.createUser({ email: "head2@example.com", email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin" }));
    const other = await signedInClient("head2@example.com");
    await registered();
    const { exportId } = await downloaded(other);
    const result = await exportYearExcel(headAdmin, conferenceId, async (sheets) => {
      expect(await clear(exportId, other)).toMatchObject({ ok: true });
      return writeXlsx(sheets);
    });
    expect(result).toEqual({ ok: false, error: "personal_data_cleared" });
    expect((await getYearExportOverview(headAdmin, conferenceId))?.exports).toHaveLength(1);
  });

  it("產檔期間有人修改報名：匯出紀錄存的是讀到的舊版本，那份檔案不能授權清除", async () => {
    const id = await registered({ choirPart: null });
    const result = await exportYearExcel(headAdmin, conferenceId, async (sheets) => {
      expect(await changed(id, { choirPart: "soprano" })).toMatchObject({ ok: true });
      return writeXlsx(sheets);
    });
    if (!result.ok) throw new Error(result.error);
    // 檔案裡是修改前的內容。
    expect(readXlsx(result.bytes).sheets[0].rows[1][9]).toBe("不參加");
    expect(await clear(result.exportId)).toEqual({ ok: false, error: "export_outdated" });
    expect(await clearedAt()).toBeNull();
  });
});

describe("清除與修改同時送出", () => {
  it("修改先拿到鎖：修改成功，清除等它完成後被拒絕", async () => {
    const id = await registered();
    const { exportId } = await downloaded();
    const result = await submitWhileHolding(
      async (tx) => {
        await actAs(tx, "head@example.com");
        await tx`
          select public.staff_update_registration(
            p_registration_id => ${id}, p_phone => '0912345678', p_email => null, p_line_id => null,
            p_venue_id => ${jinhuaId}, p_course_ids => '{}'::uuid[], p_lunch_option_id => null,
            p_choir_part => 'alto', p_services => '{}'::text[], p_printed_handbook => false,
            p_role => 'attendee', p_confirm_full => false
          )`;
      },
      () => clear(exportId),
      undefined,
      "clear_personal_data",
    );
    expect(result).toEqual({ ok: false, error: "export_outdated" });
    expect((await storedRegistrations())[0]).toMatchObject({ name: "王小美", choir_part: "alto" });
    expect(await clearedAt()).toBeNull();
  });

  it("清除先拿到鎖：清除成功，修改等它完成後被拒絕", async () => {
    const id = await registered();
    const { exportId } = await downloaded();
    const result = await submitWhileHolding(
      async (tx) => {
        await actAs(tx, "head@example.com");
        await tx`select public.clear_personal_data(${conferenceId}, ${exportId}, true)`;
      },
      () => changed(id, { choirPart: "alto", phone: "0912345678" }),
      undefined,
      "staff_update_registration",
    );
    expect(result).toEqual({ ok: false, errors: { form: "personalDataCleared" } });
    expect((await storedRegistrations())[0]).toMatchObject({ name: null, choir_part: null });
    expect(await clearedAt()).not.toBeNull();
  });
});

describe("清除與場地、課程設定的修改同時發生", () => {
  // 課程名稱這類修改不經過報名函式。清除已經比對過版本號、還在清除的時候（這裡被寄信紀錄的鎖擋住），
  // 改名不能搶先提交：要嘛排在清除之後，要嘛其中一邊被中止；不能清除成功、改名也成功卻排在清除之前。
  it("清除進行中改了課程名稱：不會清除成功又讓改名排在前面", async () => {
    const id = await registered({ email: "may@example.com" });
    expect(await sendConfirmationEmail(serverClient(), id, "resent", async () => ({ ok: true, id: null }))).toBe("sent");
    const { exportId } = await downloaded();

    vi.spyOn(console, "error").mockImplementation(() => {});
    let result: Awaited<ReturnType<typeof clear>>;
    try {
      result = await submitWhileHolding(
        (tx) => tx`select 1 from public.email_logs where registration_id = ${id} for update`,
        () => clear(exportId),
        (tx) => tx`update public.courses set title_zh = '清除中改的名稱' where id = ${wreathId}`,
        "clear_personal_data",
      );
    } finally {
      vi.restoreAllMocks();
    }
    const [course] = must(await admin.from("courses").select("title_zh").eq("id", wreathId));
    const renamed = course.title_zh === "清除中改的名稱";
    expect(result.ok && renamed).toBe(false);
    if (!result.ok) {
      expect(await clearedAt()).toBeNull();
      expect((await storedRegistrations())[0].name).toBe("王小美");
    }
  });
});

describe("資料版本號", () => {
  it("後台改身分類別、換課、超收新增、取消，各加一", async () => {
    const id = await registered({ venueId: dayaId, courseIds: [quiltingId] });

    let version = await dataVersion();
    expect(await changed(id, { venueId: dayaId, courseIds: [quiltingId], role: "committee" })).toMatchObject({ ok: true });
    expect(await dataVersion()).toBe(++version);

    expect(await changed(id, { venueId: jinhuaId, courseIds: [musicId, healthId] })).toMatchObject({ ok: true });
    expect(await dataVersion()).toBe(++version);

    // 拼布限 1 人，已經被另一筆佔了；總管理員確認後超收。
    await registered({ name: "先報的人", phone: "0955666777", venueId: dayaId, courseIds: [quiltingId] });
    version = await dataVersion();
    await registered({ name: "超收的人", phone: "0966777888", venueId: dayaId, courseIds: [quiltingId] });
    expect(await dataVersion()).toBe(++version);

    expect(await staffCancelRegistration(headAdmin, id)).toEqual({ ok: true });
    expect(await dataVersion()).toBe(++version);
  });

  it("改場地、場次、課程、午餐的名稱或順序會加；只調名額、停止或重新開放報名、改教室不加", async () => {
    let version = await dataVersion();
    const renames: [string, string, Record<string, unknown>][] = [
      ["courses", wreathId, { title_zh: "手作花圈（改名）" }],
      ["venues", dayaId, { name_zh: "測試大雅教堂（改名）" }],
      ["sessions", must(await admin.from("sessions").select("id").eq("venue_id", dayaId).single()).id, { name_zh: "第一場（改名）" }],
      ["lunch_options", bentoId, { name_zh: "葷食便當" }],
    ];
    for (const [table, id, values] of renames) {
      must(await headAdmin.from(table).update(values).eq("id", id).select("id").single());
      expect(await dataVersion()).toBe(++version);
    }

    must(await headAdmin.from("courses").update({ capacity: 99 }).eq("id", quiltingId).select("id").single());
    must(await headAdmin.from("lunch_options").update({ capacity: 99 }).eq("id", bentoId).select("id").single());
    for (const stopped of [true, false]) {
      must(await headAdmin.rpc("set_registration_stopped", { p_kind: "course", p_id: quiltingId, p_stopped: stopped }));
      must(await headAdmin.rpc("set_registration_stopped", { p_kind: "lunch", p_id: bentoId, p_stopped: stopped }));
    }
    must(await headAdmin.from("course_classrooms").upsert({ course_id: quiltingId, classroom: "201 教室" }));
    expect(await dataVersion()).toBe(version);
  });

  it("寫入失敗時不加", async () => {
    const id = await registered();
    const version = await dataVersion();
    // 大雅的課選在金華：課程不在所選場地，整筆被拒絕。
    expect(await changed(id, { venueId: jinhuaId, courseIds: [quiltingId] })).toMatchObject({ ok: false });
    expect(await changed(crypto.randomUUID(), { choirPart: "alto" })).toMatchObject({ ok: false });
    const course = await headAdmin.from("courses").update({ title_zh: " " }).eq("id", wreathId);
    expect(course.error).not.toBeNull();
    expect(await dataVersion()).toBe(version);
  });

  it("別的年度的寫入不影響這個年度的版本", async () => {
    const version = await dataVersion();
    must(await admin.from("venues").update({ name_zh: "去年的教堂（改名）" }).eq("conference_id", otherConferenceId));
    expect(await dataVersion()).toBe(version);
  });
});

describe("清除個資", () => {
  it("清除全部報名（含已取消）與寄信紀錄的個資，保留的欄位不變，記下清除時間", async () => {
    const sent: string[] = [];
    const send: SendEmail = async (message) => {
      sent.push(message.to);
      return { ok: false, error: `寄到 ${message.to}（王小美）失敗` };
    };
    const kept = await registered({ email: "may@example.com", lineId: "may-line", courseIds: [familyOneId, familyTwoId] });
    const cancelled = await registered({ name: "已取消的人", phone: "", noPhone: true, email: "gone@example.com" });
    expect(await sendConfirmationEmail(serverClient(), kept, "resent", send)).toBe("failed");
    expect(await staffCancelRegistration(headAdmin, cancelled)).toEqual({ ok: true });
    expect(await sendConfirmationEmail(serverClient(), cancelled, "cancelled", send)).toBe("failed");
    must(
      await admin
        .from("submissions")
        .insert({ key: crypto.randomUUID(), kind: "staff_submit", fingerprint: "用姓名電話算的", registration_id: kept }),
    );
    const before = await storedRegistrations();
    expect(before[1].registration_number).toMatch(/^\d{6}$/);
    const statisticsBefore = await getStatistics(headAdmin, conferenceId);

    const { exportId } = await downloaded();
    const result = await clear(exportId);
    if (!result.ok) throw new Error(result.error);
    expect(result.alreadyCleared).toBe(false);

    const after = await storedRegistrations();
    expect(after).toEqual(
      before.map((row) => ({
        ...row,
        name: null,
        phone: null,
        registration_number: null,
        email: null,
        line_id: null,
        submitted_phone: null,
        personal_data_cleared_at: result.clearedAt,
      })),
    );
    expect(await clearedAt()).toBe(result.clearedAt);

    const logs = must(await admin.from("email_logs").select("recipient, error, status").in("registration_id", [kept, cancelled]));
    expect(logs).toHaveLength(2);
    expect(logs).toEqual(logs.map(() => ({ recipient: null, error: null, status: "failed" })));
    expect(must(await admin.from("submissions").select("key").eq("registration_id", kept))).toEqual([]);

    // 統計仍可檢視，人數不變。
    expect(await getStatistics(headAdmin, conferenceId)).toEqual(statisticsBefore);
  });

  it("中途失敗全部回復、不記時間，可以重試；重複執行回傳已完成且時間不變", async () => {
    await registered({ email: "may@example.com" });
    const before = await storedRegistrations();
    const { exportId } = await downloaded();

    // 最後一步（記下清除時間）失敗：前面清掉的個資也要一起回復。
    const sql = databaseClient();
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await sql`
        create function public.test_fail_clearing() returns trigger language plpgsql as $$
        begin
          if new.personal_data_cleared_at is not null then raise exception 'test_failure'; end if;
          return new;
        end;
        $$`;
      await sql`
        create trigger test_fail_clearing before update on public.conferences
        for each row execute function public.test_fail_clearing()`;
      expect(await clear(exportId)).toEqual({ ok: false, error: "unavailable" });
    } finally {
      await sql`drop trigger if exists test_fail_clearing on public.conferences`;
      await sql`drop function if exists public.test_fail_clearing()`;
      await sql.end();
      vi.restoreAllMocks();
    }
    expect(await storedRegistrations()).toEqual(before);
    expect(await clearedAt()).toBeNull();

    const first = await clear(exportId);
    if (!first.ok) throw new Error(first.error);
    expect(first.alreadyCleared).toBe(false);
    const again = await clear(exportId);
    expect(again).toEqual({ ok: true, clearedAt: first.clearedAt, alreadyCleared: true });
    expect(await clearedAt()).toBe(first.clearedAt);
  });

  it("清除前開始寄的信，清除後才寫回：只記寄送結果，不寫入收件地址與錯誤回應", async () => {
    const id = await registered({ email: "may@example.com" });
    const { exportId } = await downloaded();

    let cleared = false;
    const failing: SendEmail = async (message) => {
      expect(await clear(exportId)).toMatchObject({ ok: true });
      cleared = true;
      return { ok: false, error: `寄到 ${message.to}（王小美）失敗` };
    };
    expect(await sendConfirmationEmail(serverClient(), id, "resent", failing)).toBe("failed");
    expect(cleared).toBe(true);
    const [log] = must(await admin.from("email_logs").select("recipient, error, status, finished_at").eq("registration_id", id));
    expect(log).toMatchObject({ recipient: null, error: null, status: "failed" });
    expect(log.finished_at).not.toBeNull();
  });

  it("清除前開始寄、清除後寄成功的信：記下已寄出與寄信服務的編號，不留收件地址", async () => {
    const id = await registered({ email: "may@example.com" });
    const { exportId } = await downloaded();
    const succeeding: SendEmail = async () => {
      expect(await clear(exportId)).toMatchObject({ ok: true });
      return { ok: true, id: "resend-123" };
    };
    expect(await sendConfirmationEmail(serverClient(), id, "resent", succeeding)).toBe("sent");
    const [log] = must(
      await admin.from("email_logs").select("recipient, error, status, provider_message_id").eq("registration_id", id),
    );
    expect(log).toEqual({ recipient: null, error: null, status: "sent", provider_message_id: "resend-123" });
  });

  it("清除後不能再下載 Excel、補寄信、新增或修改報名；名單與統計仍可檢視", async () => {
    const id = await registered({ email: "may@example.com" });
    const { exportId } = await downloaded();
    expect(await clear(exportId)).toMatchObject({ ok: true });

    expect(await exportYearExcel(headAdmin, conferenceId)).toEqual({ ok: false, error: "personal_data_cleared" });

    const send = vi.fn<SendEmail>(async () => ({ ok: true, id: null }));
    expect(await resendConfirmationEmail(headAdmin, serverClient(), id, send)).toMatchObject({ ok: false });
    expect(await sendConfirmationEmail(serverClient(), id, "resent", send)).toBe("skipped");
    expect(send).not.toHaveBeenCalled();

    expect(await changed(id, { email: "new@example.com" })).toEqual({ ok: false, errors: { form: "personalDataCleared" } });
    const added = await staffSubmitRegistration(headAdmin, input({ name: "清除後才報的人" }), { confirmFull: true });
    expect(added).toEqual({ ok: false, errors: { form: "personalDataCleared" } });
    expect(await staffCancelRegistration(headAdmin, id)).toEqual({ ok: false, error: "personalDataCleared" });
    expect(await storedRegistrations()).toEqual([expect.objectContaining({ name: null, email: null, status: "registered" })]);

    expect((await getStatistics(headAdmin, conferenceId)).total).toBe(1);
    expect(await getYearExportOverview(headAdmin, conferenceId)).toMatchObject({ clearedAt: expect.any(String) });
  });
});
