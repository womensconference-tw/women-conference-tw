import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";
import { getContentEditor, toTaipeiDateTimeInput } from "./content";
import { getProgramme, type Programme } from "./programme";
import { listRegistrations } from "./registration-list";
import { copyConference, listConferences, setCurrentConference } from "./years";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let sourceId: string;
let stakeId: string;
let wardId: string;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個還沒開放報名的 2099 目前年度（lastYear() 把它變成已截止的去年）、一位總管理員、一位北區課務組、一位北區報報組；測完全部刪掉。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));

  const now = Date.now();
  sourceId = must(
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

  stakeId = must(await admin.from("stakes").insert({ region: "north", name_zh: "測試年度支聯會" }).select("id").single()).id;
  wardId = must(await admin.from("wards").insert({ stake_id: stakeId, name_zh: "測試年度支會" }).select("id").single()).id;

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
  // 刪掉年度大會時，它的場地、課程與報名一起刪除。
  must(await admin.from("conferences").delete().gte("year", 2099));
  must(await admin.from("wards").delete().eq("stake_id", stakeId));
  must(await admin.from("stakes").delete().eq("id", stakeId));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

/** 表單上的台灣時間（datetime-local 的格式），距離現在 offset 毫秒。 */
function taipei(offset: number): string {
  return toTaipeiDateTimeInput(new Date(Date.now() + offset).toISOString());
}

async function copied(client = headAdmin) {
  const result = await copyConference(client, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-05-15" });
  if (!result.ok) throw new Error(`複製失敗：${result.error}`);
  return result.conferenceId;
}

/** 把複製出來的年度設為目前年度，時程是報名前（明天開放）。 */
async function switchedTo(conferenceId: string) {
  const result = await setCurrentConference(headAdmin, {
    conferenceId,
    announceAt: taipei(-DAY),
    registrationOpensAt: taipei(DAY),
    registrationClosesAt: taipei(2 * DAY),
  });
  if (!result.ok) throw new Error(`切換失敗：${result.error}`);
}

/**
 * 2099 年的完整安排：一個場地、兩個場次、三門課（其中兩門成對、一門有教室）、限量午餐、不限量午后動態、
 * 首頁內容、常見問題、自訂區塊，以及一筆報名。建好後把時程移到過去（已截止），像去年一樣。
 */
async function lastYear() {
  must(
    await admin
      .from("conferences")
      .update({
        start_time: "09:00",
        end_time: "16:00",
        theme_scripture_zh: "你的兒女都要受耶和華的教訓",
        theme_scripture_en: "All thy children shall be taught of the Lord",
        welcome_zh: "歡迎姐妹們",
        admin_line_id: "@twsisters",
      })
      .eq("id", sourceId),
  );
  const insert = async (table: string, row: Record<string, unknown>) =>
    must(await admin.from(table).insert({ conference_id: sourceId, ...row }).select("id").single()).id as string;
  const venue = await insert("venues", { region: "north", name_zh: "台北金華教堂", features_zh: "另有午后動態" });
  const first = await insert("sessions", { venue_id: venue, position: 1, name_zh: "第一場" });
  const second = await insert("sessions", { venue_id: venue, position: 2, name_zh: "第二場" });
  const genealogy = await insert("courses", { session_id: first, title_zh: "家譜入門", capacity: 20 });
  await insert("courses", { session_id: first, position: 1, title_zh: "自由選課" });
  const genealogyTwo = await insert("courses", { session_id: second, title_zh: "家譜進階", capacity: 20 });
  must(await admin.from("course_classrooms").insert({ course_id: genealogy, classroom: "201 教室" }));
  must(await admin.from("course_pairs").insert({ conference_id: sourceId, first_course_id: genealogy, second_course_id: genealogyTwo }));
  const lunch = await insert("lunch_options", { venue_id: venue, name_zh: "素食便當", capacity: 30 });
  await insert("afternoon_activities", { venue_id: venue, title_zh: "手作花圈" });
  await insert("faqs", { question_zh: "要收費嗎？", answer_zh: "不用。" });
  await insert("custom_blocks", { title_zh: "交通資訊", button_label_zh: "查看", button_url: "/lookup" });

  const registration = await insert("registrations", {
    venue_id: venue,
    stake_id: stakeId,
    ward_id: wardId,
    name: "去年的報名者",
    phone: "0912345678",
    portrait_consented_at: new Date().toISOString(),
    locale: "zh",
    lunch_option_id: lunch,
  });
  must(
    await admin
      .from("registration_courses")
      .insert({ registration_id: registration, venue_id: venue, session_id: first, course_id: genealogy }),
  );

  const now = Date.now();
  must(
    await admin
      .from("conferences")
      .update({
        announce_at: new Date(now - 30 * DAY).toISOString(),
        registration_opens_at: new Date(now - 20 * DAY).toISOString(),
        registration_closes_at: new Date(now - 10 * DAY).toISOString(),
      })
      .eq("id", sourceId),
  );
}

/** 課程安排去掉編號，只留看得到的內容與名額；成對課程以課名表示。 */
function arrangement(programme: Programme) {
  const titles = new Map(
    programme.venues.flatMap((venue) => venue.sessions.flatMap((session) => session.courses)).map((course) => [course.id, course.nameZh]),
  );
  return {
    venues: programme.venues.map((venue) => ({
      nameZh: venue.nameZh,
      region: venue.region,
      featuresZh: venue.featuresZh,
      sessions: venue.sessions.map((session) => ({
        nameZh: session.nameZh,
        courses: session.courses.map((course) => [course.nameZh, course.capacity, course.classroom]),
      })),
      lunchOptions: venue.lunchOptions.map((lunch) => [lunch.nameZh, lunch.capacity]),
      afternoonActivities: venue.afternoonActivities.map((activity) => [activity.nameZh, activity.capacity]),
    })),
    coursePairs: programme.coursePairs.map((pair) => [titles.get(pair.firstCourseId), titles.get(pair.secondCourseId)]),
  };
}

describe("複製去年建立新年度", () => {
  it("場地、場次、課程、名額、教室、成對課程、午餐、午后動態都複製過去", async () => {
    await lastYear();

    await switchedTo(await copied());

    const programme = (await getProgramme(headAdmin))!;
    expect(programme.year).toBe(2100);
    expect(arrangement(programme)).toEqual({
      venues: [
        {
          nameZh: "台北金華教堂",
          region: "north",
          featuresZh: "另有午后動態",
          sessions: [
            {
              nameZh: "第一場",
              courses: [
                ["家譜入門", 20, "201 教室"],
                ["自由選課", null, null],
              ],
            },
            { nameZh: "第二場", courses: [["家譜進階", 20, null]] },
          ],
          lunchOptions: [["素食便當", 30]],
          afternoonActivities: [["手作花圈", null]],
        },
      ],
      coursePairs: [["家譜入門", "家譜進階"]],
    });
  });

  it("首頁內容、常見問題、自訂區塊都複製過去", async () => {
    await lastYear();

    await switchedTo(await copied());

    expect(await getContentEditor(headAdmin)).toMatchObject({
      year: 2100,
      conferenceDate: "2100-05-15",
      startTime: "09:00",
      endTime: "16:00",
      themeScriptureZh: "你的兒女都要受耶和華的教訓",
      themeScriptureEn: "All thy children shall be taught of the Lord",
      welcomeZh: "歡迎姐妹們",
      adminLineId: "@twsisters",
      faqs: [{ titleZh: "要收費嗎？", bodyZh: "不用。" }],
      customBlocks: [{ titleZh: "交通資訊", buttonLabelZh: "查看", buttonUrl: "/lookup" }],
    });
  });

  it("報名沒有被複製，新年度的名額都是空的", async () => {
    await lastYear();

    await switchedTo(await copied());

    expect((await listRegistrations(headAdmin, "")).total).toBe(0);
  });

  it("場地沿用同一個固定識別，支聯會的預設場地在新年度仍對得上（跨區標記用）", async () => {
    await lastYear();

    const id = await copied();

    const siteKeys = async (conferenceId: string) =>
      must(await admin.from("venues").select("site_key").eq("conference_id", conferenceId)).map((venue) => venue.site_key);
    expect(await siteKeys(id)).toEqual(await siteKeys(sourceId));
  });

  it("新年度還沒開放報名，課程可以照常調整", async () => {
    await lastYear();
    await switchedTo(await copied());
    const programme = (await getProgramme(headAdmin))!;
    const session = programme.venues[0].sessions[1];

    const { error } = await headAdmin.from("sessions").delete().eq("id", session.id);

    expect(error).toBeNull();
  });

  it("新年度出現在年度列表，時程時間點是空的，還不是目前年度", async () => {
    const id = await copied();

    const years = await listConferences(headAdmin);
    expect(years.map((year) => [year.year, year.isCurrent])).toEqual(
      expect.arrayContaining([
        [2100, false],
        [2099, true],
      ]),
    );
    expect(years.find((year) => year.id === id)).toMatchObject({
      year: 2100,
      conferenceDate: "2100-05-15",
      announceAt: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
  });
});

describe("切換目前年度", () => {
  it("新年度填好時程後設為目前年度，首頁顯示新年度，去年變成舊年度", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: taipei(DAY),
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: true });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2100, phase: "upcoming" });
    const years = await listConferences(headAdmin);
    expect(years.find((year) => year.id === sourceId)?.isCurrent).toBe(false);
  });

  it("時程還空著又沒填時不能切換，目前年度不變", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: "",
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: false, error: "schedule_incomplete" });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("時間不依序時不能切換", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: taipei(3 * DAY),
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: false, error: "schedule_order" });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("切回時程已填好的舊年度時不必再填，原本的時程不變", async () => {
    const id = await copied();
    const before = (await listConferences(headAdmin)).find((year) => year.id === sourceId)!;
    await switchedTo(id);

    const result = await setCurrentConference(headAdmin, { conferenceId: sourceId });

    expect(result).toEqual({ ok: true });
    const after = (await listConferences(headAdmin)).find((year) => year.id === sourceId)!;
    expect(after).toEqual({ ...before, isCurrent: true });
  });
});

describe("只有總管理員能管理年度", () => {
  it("課務組、報報組不能複製年度", async () => {
    for (const staff of [courseTeam, registrationTeam]) {
      const result = await copyConference(staff, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-05-15" });
      expect(result).toEqual({ ok: false, error: "not_admin" });
    }
    expect((await listConferences(headAdmin)).map((year) => year.year)).not.toContain(2100);
  });

  it("課務組、報報組不能切換目前年度", async () => {
    const id = await copied();

    for (const staff of [courseTeam, registrationTeam]) {
      const result = await setCurrentConference(staff, {
        conferenceId: id,
        announceAt: taipei(-DAY),
        registrationOpensAt: taipei(DAY),
        registrationClosesAt: taipei(2 * DAY),
      });
      expect(result).toEqual({ ok: false, error: "not_admin" });
    }
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("課務組、報報組看得到所有年度，好選舊年度看名單", async () => {
    await copied();

    for (const staff of [courseTeam, registrationTeam]) {
      expect((await listConferences(staff)).map((year) => year.year)).toEqual(expect.arrayContaining([2100, 2099]));
    }
  });
});

describe("複製時填錯", () => {
  it("年度已經有了", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2099", conferenceDate: "2099-06-01" });
    expect(result).toEqual({ ok: false, error: "year_taken" });
  });

  it.each(["", "99", "20a0", "1999"])("年度「%s」看不懂", async (year) => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year, conferenceDate: "2100-05-15" });
    expect(result).toEqual({ ok: false, error: "year_invalid" });
  });

  it("大會日期不在新年度那一年", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2099-05-15" });
    expect(result).toEqual({ ok: false, error: "date_not_in_year" });
  });

  it("日期不存在", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-02-30" });
    expect(result).toEqual({ ok: false, error: "date_invalid" });
  });
});
