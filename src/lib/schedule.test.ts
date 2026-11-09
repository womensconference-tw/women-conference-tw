import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";
import {
  getScheduleEditor,
  parseTaipeiDateTime,
  saveConferenceDetails,
  saveSchedule,
  toTaipeiDateTimeInput,
  type ConferenceDetailsInput,
  type ScheduleInput,
} from "./schedule";

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
};

async function saveDetails(changes: Partial<ConferenceDetailsInput> = {}, client = headAdmin) {
  return saveConferenceDetails(client, { conferenceId: conferenceId!, ...details, ...changes });
}

async function schedule(input: Omit<ScheduleInput, "conferenceId">, client = headAdmin) {
  return saveSchedule(client, { conferenceId: conferenceId!, ...input });
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

describe("大會日期與時間", () => {
  it("存檔後報名入口頁立即顯示新的日期與時間", async () => {
    expect(await saveDetails()).toEqual({ ok: true });

    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({
      conferenceDate: "2099-05-16",
      startTime: "09:00",
      endTime: "16:30",
    });
  });

  it("後台讀得到日期、時間與時程，可以帶進表單", async () => {
    await saveDetails();

    expect(await getScheduleEditor(headAdmin)).toMatchObject({
      conferenceId,
      year: 2099,
      conferenceDate: "2099-05-16",
      startTime: "09:00",
      endTime: "16:30",
      registrationOpened: false,
    });
  });

  it("時間可以清空", async () => {
    await saveDetails();
    expect(await saveDetails({ startTime: "", endTime: "" })).toEqual({ ok: true });

    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ startTime: null, endTime: null });
  });

  it("舊首頁的欄位（歡迎詞、管理員 LINE）存檔時不動，資料留著", async () => {
    must(await admin.from("conferences").update({ welcome_zh: "歡迎姐妹們", admin_line_id: "@twsisters" }).eq("id", conferenceId!));

    expect(await saveDetails()).toEqual({ ok: true });

    const stored = must(await admin.from("conferences").select("welcome_zh, admin_line_id").eq("id", conferenceId!).single());
    expect(stored).toEqual({ welcome_zh: "歡迎姐妹們", admin_line_id: "@twsisters" });
  });

  it("頁面開著時目前年度換了，不會改到舊年度", async () => {
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));

    expect(await saveDetails({ conferenceDate: "2099-06-01" })).toEqual({ ok: false, error: "not_found" });
    expect(
      await schedule({ announceAt: taipei(-DAY), registrationOpensAt: taipei(DAY), registrationClosesAt: taipei(2 * DAY) }),
    ).toEqual({ ok: false, error: "not_found" });
    const stored = must(await admin.from("conferences").select("conference_date").eq("id", conferenceId!).single());
    expect(stored.conference_date).toBe("2099-05-15");
  });

  it.each([
    [{ conferenceDate: "" }, "date_invalid"],
    [{ conferenceDate: "2099-02-30" }, "date_invalid"],
    [{ startTime: "25:00" }, "time_invalid"],
    [{ startTime: "", endTime: "16:30" }, "time_invalid"],
    [{ startTime: "17:00", endTime: "16:30" }, "time_invalid"],
  ] as const)("%o 不能存（%s）", async (changes, error) => {
    expect(await saveDetails(changes)).toEqual({ ok: false, error });
  });
});

describe("時程時間點", () => {
  it("把報名開放改到現在之前，報名入口頁立即變成報名中；截止改到現在之前，變成已截止", async () => {
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
    expect((await getScheduleEditor(headAdmin))!.registrationOpened).toBe(true);
  });
});

describe("只有總管理員能編輯", () => {
  it("課務組、報報組與訪客透過後台都被擋下", async () => {
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveDetails({ conferenceDate: "2099-06-01" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(
        await schedule({ announceAt: taipei(-DAY), registrationOpensAt: taipei(-DAY / 2), registrationClosesAt: taipei(DAY) }, client),
      ).toEqual({ ok: false, error: "not_admin" });
    }
    const stored = must(await admin.from("conferences").select("conference_date").eq("id", conferenceId!).single());
    expect(stored.conference_date).toBe("2099-05-15");
  });

  it("權限規則：非總管理員直接寫資料庫也改不到", async () => {
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      const updated = await client.from("conferences").update({ conference_date: "2099-06-01" }).eq("id", conferenceId!).select("id");
      expect(updated.data ?? []).toEqual([]);
    }
    const stored = must(await admin.from("conferences").select("conference_date").eq("id", conferenceId!).single());
    expect(stored.conference_date).toBe("2099-05-15");
  });

  it("權限規則：總管理員也不能直接換目前年度或年度", async () => {
    const isCurrent = await headAdmin.from("conferences").update({ is_current: false }).eq("id", conferenceId!);
    expect(isCurrent.error?.code).toBe("42501");
    const year = await headAdmin.from("conferences").update({ year: 2098 }).eq("id", conferenceId!);
    expect(year.error?.code).toBe("42501");
  });
});
