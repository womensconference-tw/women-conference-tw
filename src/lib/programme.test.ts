import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, databaseClient, must, signedInClient } from "../../test/supabase";
import {
  addCoursePair,
  deleteItem,
  getProgramme,
  parseCapacity,
  removeCoursePair,
  saveItem,
  type ItemInput,
} from "./programme";
import { getRegistrationOptions } from "./registration-options";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let stakeId: string;
let wardId: string;
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
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;

  stakeId = must(await admin.from("stakes").insert({ region: "north", name_zh: "測試課程支聯會" }).select("id").single()).id;
  wardId = must(await admin.from("wards").insert({ stake_id: stakeId, name_zh: "測試課程支會" }).select("id").single()).id;

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
  if (conferenceId) must(await admin.from("conferences").delete().eq("id", conferenceId));
  conferenceId = undefined;
  must(await admin.from("wards").delete().eq("stake_id", stakeId));
  must(await admin.from("stakes").delete().eq("id", stakeId));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

/** 開放報名：把開放時間移到現在之前。 */
async function openRegistration() {
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() })
      .eq("id", conferenceId!),
  );
}

async function save(input: Omit<ItemInput, "conferenceId">, client = headAdmin) {
  return saveItem(client, { conferenceId: conferenceId!, ...input });
}

async function saved(input: Omit<ItemInput, "conferenceId">) {
  const result = await save(input);
  if (!result.ok) throw new Error(`建立${input.kind}失敗：${result.error}`);
  return result.id;
}

/** 一個場地、一個場次、一門課。 */
async function venueWithCourse() {
  const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
  const session = await saved({ kind: "session", parentId: venue, nameZh: "第一場" });
  const course = await saved({ kind: "course", parentId: session, nameZh: "家譜入門", capacity: "20" });
  return { venue, session, course };
}

/** 不經過報名服務，直接寫一筆報名。 */
async function register(venueId: string, choices: { lunch_option_id?: string; status?: string } = {}) {
  const cancelled = choices.status === "cancelled" ? { cancelled_at: new Date().toISOString() } : {};
  return must(
    await admin
      .from("registrations")
      .insert({
        conference_id: conferenceId,
        venue_id: venueId,
        stake_id: stakeId,
        ward_id: wardId,
        name: "測試報名者",
        phone: "0912345678",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
        ...choices,
        ...cancelled,
      })
      .select("id")
      .single(),
  ).id;
}

describe("名額", () => {
  it.each([
    ["", null],
    ["  ", null],
    ["20", 20],
    [" 5 ", 5],
  ])("「%s」是 %s（空白表示不限）", (raw, capacity) => {
    expect(parseCapacity(raw)).toBe(capacity);
  });

  it.each(["0", "-1", "1.5", "abc", "1e3"])("「%s」不是有效的名額", (raw) => {
    expect(parseCapacity(raw)).toBeUndefined();
  });
});

describe("總管理員編輯課程安排", () => {
  it("新增的場地、場次、課程、午餐、午后動態出現在報名表上，中英兩欄都存下", async () => {
    const venue = await saved({
      kind: "venue",
      region: "north",
      nameZh: "台北金華教堂",
      nameEn: "Taipei Jinhua Chapel",
      addressZh: "台北市金華街",
      addressEn: "Jinhua St, Taipei",
    });
    const session = await saved({ kind: "session", parentId: venue, nameZh: "第一場", nameEn: "Session 1" });
    await saved({
      kind: "course",
      parentId: session,
      nameZh: "家譜入門",
      nameEn: "Family history",
      descriptionZh: "講師：林姊妹",
      descriptionEn: "Teacher: Sister Lin",
      capacity: "",
    });
    await saved({ kind: "lunch", parentId: venue, nameZh: "素食便當", nameEn: "Vegetarian", capacity: "30" });
    await saved({ kind: "activity", parentId: venue, nameZh: "手作花圈", nameEn: "Wreath making" });

    const options = await getRegistrationOptions(anonClient(), "en");

    expect(options.venues).toEqual([
      {
        id: venue,
        name: "Taipei Jinhua Chapel",
        sessions: [
          {
            id: session,
            name: "Session 1",
            courses: [
              {
                id: expect.any(String),
                name: "Family history",
                description: "Teacher: Sister Lin",
                isFull: false,
                pairedWith: null,
              },
            ],
          },
        ],
        lunchOptions: [{ id: expect.any(String), name: "Vegetarian", description: "", isFull: false }],
        afternoonActivities: [{ id: expect.any(String), name: "Wreath making", description: "", isFull: false }],
      },
    ]);
    const stored = must(await admin.from("venues").select("address_zh, address_en").eq("id", venue).single());
    expect(stored).toEqual({ address_zh: "台北市金華街", address_en: "Jinhua St, Taipei" });
  });

  it("名額可設數字或不限", async () => {
    const { course } = await venueWithCourse();

    expect(must(await admin.from("courses").select("capacity").eq("id", course).single()).capacity).toBe(20);
    expect((await save({ kind: "course", id: course, nameZh: "家譜入門", capacity: "" })).ok).toBe(true);
    expect(must(await admin.from("courses").select("capacity").eq("id", course).single()).capacity).toBeNull();
  });

  it("修改時去掉前後空白，沒填的英文存成空白", async () => {
    const { course } = await venueWithCourse();

    await saved({ kind: "course", id: course, nameZh: "  家譜入門（新）  ", position: "3" });

    expect(must(await admin.from("courses").select("title_zh, title_en, position").eq("id", course).single())).toEqual({
      title_zh: "家譜入門（新）",
      title_en: "",
      position: 3,
    });
  });

  it("場地的區存得下來，報名開放後也能改", async () => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台中大雅教堂" });
    expect((await getProgramme(headAdmin))?.venues[0].region).toBe("north");

    await openRegistration();
    await saved({ kind: "venue", id: venue, region: "central", nameZh: "台中大雅教堂" });
    expect((await getProgramme(headAdmin))?.venues[0].region).toBe("central");
  });

  it.each<[string, Omit<ItemInput, "conferenceId">, string]>([
    ["沒填中文名稱", { kind: "venue", region: "north", nameZh: "  " }, "name_required"],
    ["名額不是正整數", { kind: "lunch", nameZh: "便當", capacity: "0" }, "capacity_invalid"],
    ["排序不是整數", { kind: "venue", region: "north", nameZh: "教堂", position: "一" }, "position_invalid"],
    ["教室太長", { kind: "course", nameZh: "課", classroom: "教".repeat(51) }, "classroom_invalid"],
    ["場地沒選區", { kind: "venue", nameZh: "教堂" }, "region_required"],
    ["場地的區不認得", { kind: "venue", region: "east", nameZh: "教堂" }, "region_required"],
  ])("%s時不存", async (_, input, error) => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    const session = await saved({ kind: "session", parentId: venue, nameZh: "第一場" });
    const parentId = input.kind === "course" ? session : input.kind === "venue" ? undefined : venue;

    expect(await save({ ...input, parentId })).toEqual({ ok: false, error });
  });

  it("可以刪除沒人報名的選項；刪除場地時連同場次與課程", async () => {
    const { venue, session } = await venueWithCourse();
    const lunch = await saved({ kind: "lunch", parentId: venue, nameZh: "便當" });

    expect(await deleteItem(headAdmin, "lunch", lunch)).toEqual({ ok: true });
    expect(await deleteItem(headAdmin, "venue", venue)).toEqual({ ok: true });

    expect(must(await admin.from("sessions").select("id").eq("id", session))).toEqual([]);
  });

  it("編號格式不對時當成找不到", async () => {
    expect(await deleteItem(headAdmin, "course", "abc")).toEqual({ ok: false, error: "not_found" });
    expect(await save({ kind: "course", id: "abc", nameZh: "課" })).toEqual({ ok: false, error: "not_found" });
    expect(await removeCoursePair(headAdmin, "abc")).toEqual({ ok: false, error: "not_found" });
  });

  it("課程可以換到同場地的另一個場次", async () => {
    const { venue, course } = await venueWithCourse();
    const second = await saved({ kind: "session", parentId: venue, nameZh: "第二場" });

    expect((await save({ kind: "course", id: course, parentId: second, nameZh: "家譜入門" })).ok).toBe(true);

    expect(must(await admin.from("courses").select("session_id").eq("id", course).single()).session_id).toBe(second);
  });
});

describe("有人報名的選項不能刪除", () => {
  it("有有效報名的場地不能刪除，並說明原因", async () => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    await register(venue);

    expect(await deleteItem(headAdmin, "venue", venue)).toEqual({ ok: false, error: "in_use" });
    expect(must(await admin.from("venues").select("id").eq("id", venue))).toHaveLength(1);
  });

  it("有人選的課程不能刪除，連帶刪除它的場次也不行", async () => {
    const { venue, session, course } = await venueWithCourse();
    const registration = await register(venue);
    must(
      await admin
        .from("registration_courses")
        .insert({ registration_id: registration, venue_id: venue, session_id: session, course_id: course }),
    );

    expect(await deleteItem(headAdmin, "course", course)).toEqual({ ok: false, error: "in_use" });
    expect(await deleteItem(headAdmin, "session", session)).toEqual({ ok: false, error: "in_use" });
  });

  // 報名紀錄要完整保留，已取消的報名選過的選項也不能默默消失。
  it("只有已取消的報名選過的午餐也不能刪除", async () => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    const lunch = await saved({ kind: "lunch", parentId: venue, nameZh: "便當" });
    await register(venue, { lunch_option_id: lunch, status: "cancelled" });

    expect(await deleteItem(headAdmin, "lunch", lunch)).toEqual({ ok: false, error: "in_use" });
  });
});

describe("報名開放後", () => {
  it.each<[string, (ids: Awaited<ReturnType<typeof venueWithCourse>>) => Promise<unknown>]>([
    ["新增課程", ({ session }) => save({ kind: "course", parentId: session, nameZh: "新課" })],
    ["刪除課程", ({ course }) => deleteItem(headAdmin, "course", course)],
    ["新增場次", ({ venue }) => save({ kind: "session", parentId: venue, nameZh: "新場次" })],
    ["新增午餐", ({ venue }) => save({ kind: "lunch", parentId: venue, nameZh: "便當" })],
    ["新增午后動態", ({ venue }) => save({ kind: "activity", parentId: venue, nameZh: "花圈" })],
  ])("不能%s", async (_, change) => {
    const ids = await venueWithCourse();
    await openRegistration();

    expect(await change(ids)).toEqual({ ok: false, error: "programme_locked" });
  });

  it("不能新增或刪除場地", async () => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    await openRegistration();

    expect(await save({ kind: "venue", region: "north", nameZh: "台中大雅教堂" })).toEqual({ ok: false, error: "programme_locked" });
    expect(await deleteItem(headAdmin, "venue", venue)).toEqual({ ok: false, error: "programme_locked" });
    expect(await save({ kind: "venue", region: "north", id: venue, nameZh: "台北金華教堂（改名）" })).toEqual({ ok: true, id: venue });

    // 由資料庫擋下，總管理員直接呼叫 API 也一樣。
    const inserted = await headAdmin.from("venues").insert({ region: "north", conference_id: conferenceId, name_zh: "台中大雅教堂" });
    const deleted = await headAdmin.from("venues").delete().eq("id", venue);
    expect([inserted.error?.message, deleted.error?.message]).toEqual(["programme_locked", "programme_locked"]);
  });

  it("不能刪除午餐與午后動態", async () => {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    const lunch = await saved({ kind: "lunch", parentId: venue, nameZh: "便當" });
    const activity = await saved({ kind: "activity", parentId: venue, nameZh: "花圈" });
    await openRegistration();

    expect(await deleteItem(headAdmin, "lunch", lunch)).toEqual({ ok: false, error: "programme_locked" });
    expect(await deleteItem(headAdmin, "activity", activity)).toEqual({ ok: false, error: "programme_locked" });
  });

  it("仍可修正文字、調整名額、換教室", async () => {
    const { session, course } = await venueWithCourse();
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "禮拜堂" });
    await openRegistration();

    const result = await save({
      kind: "course",
      id: course,
      parentId: session,
      nameZh: "家譜入門（修正）",
      capacity: "60",
      classroom: "文化廳",
    });

    expect(result).toEqual({ ok: true, id: course });
    const programme = await getProgramme(headAdmin);
    expect(programme?.venues[0].sessions[0].courses[0]).toMatchObject({
      nameZh: "家譜入門（修正）",
      capacity: 60,
      classroom: "文化廳",
    });
  });
});

describe("成對課程", () => {
  async function twoSessions() {
    const venue = await saved({ kind: "venue", region: "north", nameZh: "台北金華教堂" });
    const first = await saved({ kind: "session", parentId: venue, nameZh: "第一場", position: "10" });
    const second = await saved({ kind: "session", parentId: venue, nameZh: "第二場", position: "20" });
    return {
      venue,
      first,
      second,
      upper: await saved({ kind: "course", parentId: first, nameZh: "手冊研習（上）" }),
      other: await saved({ kind: "course", parentId: first, nameZh: "詩歌" }),
      lower: await saved({ kind: "course", parentId: second, nameZh: "手冊研習（下）" }),
      spare: await saved({ kind: "course", parentId: second, nameZh: "烹飪" }),
    };
  }

  it("同場地不同場次的兩堂可以設成一組，也可以拆開", async () => {
    const { upper, lower } = await twoSessions();

    expect(await addCoursePair(headAdmin, conferenceId!, upper, lower)).toEqual({ ok: true });
    expect((await getProgramme(headAdmin))?.coursePairs).toEqual([{ firstCourseId: upper, secondCourseId: lower }]);

    expect(await removeCoursePair(headAdmin, upper)).toEqual({ ok: true });
    expect((await getProgramme(headAdmin))?.coursePairs).toEqual([]);
  });

  it("同一場次的兩堂、或已經在別組的課不能設成一組", async () => {
    const { upper, other, lower } = await twoSessions();

    expect(await addCoursePair(headAdmin, conferenceId!, upper, other)).toEqual({
      ok: false,
      error: "course_pair_invalid",
    });
    expect(await addCoursePair(headAdmin, conferenceId!, upper, lower)).toEqual({ ok: true });
    expect(await addCoursePair(headAdmin, conferenceId!, other, lower)).toEqual({
      ok: false,
      error: "course_pair_invalid",
    });
  });

  it("兩堂要在連續的兩個場次", async () => {
    const { venue, upper, lower } = await twoSessions();
    const third = await saved({ kind: "session", parentId: venue, nameZh: "第三場", position: "30" });
    const later = await saved({ kind: "course", parentId: third, nameZh: "下午的課" });

    expect(await addCoursePair(headAdmin, conferenceId!, upper, later)).toEqual({
      ok: false,
      error: "course_pair_invalid",
    });
    expect(await addCoursePair(headAdmin, conferenceId!, lower, later)).toEqual({ ok: true });
  });

  it("已成對的兩個場次中間不能再加場次，也不能把場次排到中間", async () => {
    const { venue, upper, lower } = await twoSessions();
    const third = await saved({ kind: "session", parentId: venue, nameZh: "第三場", position: "30" });
    expect(await addCoursePair(headAdmin, conferenceId!, upper, lower)).toEqual({ ok: true });

    expect(await save({ kind: "session", parentId: venue, nameZh: "插進來的場次", position: "15" })).toEqual({
      ok: false,
      error: "course_pair_invalid",
    });
    expect(await save({ kind: "session", id: third, nameZh: "第三場", position: "15" })).toEqual({
      ok: false,
      error: "course_pair_invalid",
    });
  });

  it("不能把別的場地的場次搬進成對的兩個場次中間", async () => {
    const { venue, upper, lower } = await twoSessions();
    expect(await addCoursePair(headAdmin, conferenceId!, upper, lower)).toEqual({ ok: true });
    const other = await saved({ kind: "venue", region: "north", nameZh: "台中大雅教堂" });
    const between = await saved({ kind: "session", parentId: other, nameZh: "大雅的場次", position: "15" });
    await saved({ kind: "course", parentId: between, nameZh: "插花" });

    const { error } = await headAdmin.from("sessions").update({ venue_id: venue }).eq("id", between);

    expect(error?.message).toBe("course_pair_invalid");
  });

  it("報名開放後不能新增或拆開", async () => {
    const { upper, other, lower, spare } = await twoSessions();
    expect(await addCoursePair(headAdmin, conferenceId!, upper, lower)).toEqual({ ok: true });
    await openRegistration();

    expect(await removeCoursePair(headAdmin, upper)).toEqual({ ok: false, error: "programme_locked" });
    expect(await addCoursePair(headAdmin, conferenceId!, other, spare)).toEqual({
      ok: false,
      error: "programme_locked",
    });
  });
});

describe("教室只有後台看得到", () => {
  // 等課程的列鎖時被移出工作人員名單：權限規則讓教室刪不到也不出錯，不能只存了課程就回報成功。
  it("存課程途中失去總管理員身分時，課程與教室都不存", async () => {
    const { course } = await venueWithCourse();
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "禮拜堂" });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const headId = data.users.find((user) => user.email === "head@example.com")!.id;
    const sql = databaseClient();
    const watcher = databaseClient();
    try {
      let saving!: ReturnType<typeof save>;
      await sql.begin(async (tx) => {
        await tx`select 1 from public.courses where id = ${course} for update`;
        saving = save({ kind: "course", id: course, nameZh: "改過的課名", classroom: "" });
        for (let waited = 0; ; waited += 50) {
          const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
            select exists (
              select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ~ 'save_course'
            ) as blocked`;
          if (blocked) break;
          if (waited > 3000) throw new Error("save_course 沒有等課程的列鎖");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await tx`delete from public.staff_members where user_id = ${headId}`;
      });

      expect(await saving).toEqual({ ok: false, error: "not_admin" });
    } finally {
      await Promise.all([sql.end(), watcher.end()]);
    }
    expect(must(await admin.from("courses").select("title_zh").eq("id", course).single()).title_zh).toBe("家譜入門");
    expect(must(await admin.from("course_classrooms").select("classroom").eq("course_id", course))).toEqual([
      { classroom: "禮拜堂" },
    ]);
  });

  it("課程與教室一起存：教室存不了時，新增的課程也不留下", async () => {
    const { session } = await venueWithCourse();

    const { error } = await headAdmin.rpc("save_course", {
      p_id: null,
      p_conference_id: conferenceId,
      p_session_id: session,
      p_position: 0,
      p_title_zh: "存不了教室的課",
      p_title_en: "",
      p_description_zh: "",
      p_description_en: "",
      p_capacity: null,
      p_classroom: "   ",
    });

    expect(error).not.toBeNull();
    expect(must(await admin.from("courses").select("id").eq("title_zh", "存不了教室的課"))).toEqual([]);
  });

  it("總管理員可以填、換、清掉教室", async () => {
    const { course } = await venueWithCourse();
    const classroom = async () =>
      (await getProgramme(headAdmin))?.venues[0].sessions[0].courses[0].classroom;

    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: " 禮拜堂 " });
    expect(await classroom()).toBe("禮拜堂");
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "文化廳" });
    expect(await classroom()).toBe("文化廳");
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "" });
    expect(await classroom()).toBeNull();
  });

  it("前台訪客讀不到教室：報名表的選項不含教室，直接查也查不到", async () => {
    const { course } = await venueWithCourse();
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "秘密教室 301" });
    const visitor = anonClient();

    expect(JSON.stringify(await getRegistrationOptions(visitor, "zh"))).not.toContain("秘密教室");
    expect((await visitor.from("course_classrooms").select("classroom")).data ?? []).toEqual([]);
    expect((await visitor.from("courses").select("classroom")).error).not.toBeNull();
    expect(JSON.stringify((await visitor.from("courses").select("*")).data)).not.toContain("秘密教室");
  });

  it("課務組讀得到該區教堂的教室、讀不到別區的；報報組讀不到教室", async () => {
    const { course } = await venueWithCourse();
    await saved({ kind: "course", id: course, nameZh: "家譜入門", classroom: "北區教室 301" });
    const central = await saved({ kind: "venue", region: "central", nameZh: "台中大雅教堂" });
    const session = await saved({ kind: "session", parentId: central, nameZh: "第一場" });
    await saved({ kind: "course", parentId: session, nameZh: "插花", classroom: "中區教室 101" });

    expect(must(await courseTeam.from("course_classrooms").select("classroom"))).toEqual([{ classroom: "北區教室 301" }]);
    expect(must(await registrationTeam.from("course_classrooms").select("classroom"))).toEqual([]);
  });
});

describe("只有總管理員能編輯", () => {
  it.each([
    ["課務組", () => courseTeam],
    ["報報組", () => registrationTeam],
    ["前台訪客", () => anonClient()],
  ])("%s透過後台服務改不了", async (_, client) => {
    const { venue, course } = await venueWithCourse();

    expect(await save({ kind: "lunch", parentId: venue, nameZh: "便當" }, client())).toEqual({
      ok: false,
      error: "not_admin",
    });
    expect(await deleteItem(client(), "course", course)).toEqual({ ok: false, error: "not_admin" });
  });

  // 權限由資料庫強制（ADR 0004），直接呼叫 API 也一樣。
  it.each([
    ["課務組", () => courseTeam],
    ["報報組", () => registrationTeam],
    ["前台訪客", () => anonClient()],
  ])("%s直接呼叫 API 也新增、修改、刪除不了", async (_, client) => {
    const { venue, session, course } = await venueWithCourse();
    const lunch = await saved({ kind: "lunch", parentId: venue, nameZh: "便當" });
    const db = client();

    const inserts = await Promise.all([
      db.from("venues").insert({ region: "north", conference_id: conferenceId, name_zh: "新教堂" }),
      db.from("sessions").insert({ conference_id: conferenceId, venue_id: venue, name_zh: "新場次" }),
      db.from("courses").insert({ conference_id: conferenceId, session_id: session, title_zh: "新課" }),
      db.from("lunch_options").insert({ conference_id: conferenceId, venue_id: venue, name_zh: "新便當" }),
      db.from("afternoon_activities").insert({ conference_id: conferenceId, venue_id: venue, title_zh: "新活動" }),
      db.from("course_classrooms").insert({ course_id: course, classroom: "301" }),
    ]);
    for (const { error } of inserts) expect(error).not.toBeNull();

    await Promise.all([
      db.from("venues").update({ name_zh: "改名" }).eq("id", venue),
      db.from("courses").update({ title_zh: "改名", capacity: 999 }).eq("id", course),
      db.from("lunch_options").update({ name_zh: "改名" }).eq("id", lunch),
      db.from("courses").delete().eq("id", course),
      db.from("lunch_options").delete().eq("id", lunch),
      db.from("sessions").delete().eq("id", session),
    ]);
    expect(must(await admin.from("venues").select("name_zh").eq("id", venue).single()).name_zh).toBe("台北金華教堂");
    expect(must(await admin.from("courses").select("title_zh, capacity").eq("id", course).single())).toEqual({
      title_zh: "家譜入門",
      capacity: 20,
    });
    expect(must(await admin.from("lunch_options").select("name_zh").eq("id", lunch).single()).name_zh).toBe("便當");
    expect(must(await admin.from("course_classrooms").select("course_id"))).not.toContainEqual({ course_id: course });
  });
});
