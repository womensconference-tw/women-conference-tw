import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { submitWhileHolding } from "../../test/hold-transaction";
import { adminClient, anonClient, must, serverClient, signedInClient } from "../../test/supabase";
import { getRegistrationOptions } from "./registration-options";
import { describeFullOptions, formatUsage, getStatistics, venuesInView } from "./statistics";
import { addCoursePair, saveItem, setRegistrationStopped, type StoppableKind } from "./programme";
import {
  changesOf,
  staffSubmitRegistration,
  staffUpdateRegistration,
  submitRegistration,
  updateRegistration,
  type Registration,
  type RegistrationChanges,
  type RegistrationInput,
} from "./registration";

/*
 * 停止報名（#33，GLOSSARY「停止報名」、ADR 0006）：總管理員單獨關閉某門課程、某個午餐或午后動態。
 * 停止的選項在送出時視同額滿；她原本已佔的位子保留。
 */

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let venueId: string;
let stakeId: string;
let wardId: string;
let headAdmin: SupabaseClient;
let headAdminId: string;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個 2099 目前年度（還沒開放，選項建好後才開放）、一個北區場地、一位總管理員、
// 一位北區課務組、一位北區報報組；測完全部刪掉、復原原本的目前年度。
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
  venueId = await addVenue("台北金華教堂");
  stakeId = must(await admin.from("stakes").insert({ region: "north", name_zh: "測試停止支聯會" }).select("id").single()).id;
  wardId = must(await admin.from("wards").insert({ stake_id: stakeId, name_zh: "測試停止支會" }).select("id").single()).id;

  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "course@example.com", role: "course_team", region: "north" },
    { email: "report@example.com", role: "registration_team", region: "north" },
  ];
  for (const { email, ...scope } of staff) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
    if (scope.role === "admin") headAdminId = user.id;
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

async function addVenue(name: string) {
  return must(
    await admin.from("venues").insert({ region: "north", conference_id: conferenceId, name_zh: name }).select("id").single(),
  ).id;
}

// 場次、課程、午餐、午后動態只能在開放報名前建立，所以先建好，再開放報名。
async function addCourse(capacity: number | null, position = 1, title = "家譜入門") {
  const session = must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venueId, position, name_zh: `第${position}場` })
      .select("id")
      .single(),
  ).id;
  return must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: session, title_zh: title, capacity })
      .select("id")
      .single(),
  ).id;
}

async function addLunch(capacity: number | null, venue = venueId, name = "葷食便當") {
  return must(
    await admin
      .from("lunch_options")
      .insert({ conference_id: conferenceId, venue_id: venue, name_zh: name, capacity })
      .select("id")
      .single(),
  ).id;
}

async function addActivity(capacity: number | null) {
  return must(
    await admin
      .from("afternoon_activities")
      .insert({ conference_id: conferenceId, venue_id: venueId, title_zh: "手作花圈", capacity })
      .select("id")
      .single(),
  ).id;
}

async function openRegistration() {
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() })
      .eq("id", conferenceId!),
  );
}

function validInput(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  return {
    name: "王小美",
    phone: "0912-345-678",
    noPhone: false,
    email: "",
    lineId: "",
    stakeId,
    wardId,
    venueId,
    courseIds: [],
    lunchOptionId: null,
    afternoonActivityId: null,
    choirPart: null,
    services: [],
    printedHandbook: false,
    portraitConsent: true,
    ...overrides,
  };
}

function submit(overrides: Partial<RegistrationInput> = {}) {
  return submitRegistration(anonClient(), validInput(overrides), "zh");
}

async function registrationCount(name: string) {
  return must(await admin.from("registrations").select("id").eq("conference_id", conferenceId!).eq("name", name))
    .length;
}

/** 總管理員停止報名；不成功就讓測試失敗。 */
async function stop(kind: StoppableKind, id: string) {
  expect(await setRegistrationStopped(headAdmin, kind, id, true)).toEqual({ ok: true });
}

async function reopen(kind: StoppableKind, id: string) {
  expect(await setRegistrationStopped(headAdmin, kind, id, false)).toEqual({ ok: true });
}

async function stoppedState(table: string, ids: string[]) {
  const rows = must(await admin.from(table).select("id, registration_stopped").in("id", ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.registration_stopped]));
}

describe("停止報名的選項，新報名送出被拒", () => {
  it("課程停止後，新報名被拒並回傳額滿，資料不寫入", async () => {
    const course = await addCourse(30);
    await openRegistration();
    await stop("course", course);

    const result = await submit({ name: "停止後報名", courseIds: [course] });

    expect(result).toEqual({ ok: false, errors: { courses: "courseFull" }, fullIds: [course] });
    expect(await registrationCount("停止後報名")).toBe(0);
  });

  it("午餐停止後，新報名被拒並回傳額滿，資料不寫入", async () => {
    const lunch = await addLunch(30);
    await openRegistration();
    await stop("lunch", lunch);

    const result = await submit({ name: "停止後報名", lunchOptionId: lunch });

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [lunch] });
    expect(await registrationCount("停止後報名")).toBe(0);
  });

  it("午后動態停止後，新報名被拒並回傳額滿，資料不寫入", async () => {
    const activity = await addActivity(30);
    await openRegistration();
    await stop("activity", activity);

    const result = await submit({ name: "停止後報名", afternoonActivityId: activity });

    expect(result).toEqual({ ok: false, errors: { afternoonActivity: "afternoonActivityFull" }, fullIds: [activity] });
    expect(await registrationCount("停止後報名")).toBe(0);
  });

  it("「不限」名額的課程、午餐、午后動態停止後同樣被拒", async () => {
    const [course, lunch, activity] = [await addCourse(null), await addLunch(null), await addActivity(null)];
    await openRegistration();
    await stop("course", course);
    await stop("lunch", lunch);
    await stop("activity", activity);

    const result = await submit({
      name: "不限也停止",
      courseIds: [course],
      lunchOptionId: lunch,
      afternoonActivityId: activity,
    });

    expect(result).toMatchObject({ ok: false, errors: { courses: "courseFull", lunch: "lunchFull" } });
    expect(!result.ok && result.fullIds?.toSorted()).toEqual([course, lunch, activity].toSorted());
    expect(await registrationCount("不限也停止")).toBe(0);
  });

  it("沒停止的選項照常可以報名", async () => {
    const [stopped, open] = [await addLunch(null, venueId, "葷食便當"), await addLunch(null, venueId, "素食便當")];
    await openRegistration();
    await stop("lunch", stopped);

    expect((await submit({ lunchOptionId: open })).ok).toBe(true);
  });

  it("A 場地的午餐停止不影響 B 場地同名的午餐", async () => {
    const other = await addVenue("台中大雅教堂");
    const [here, there] = [await addLunch(null, venueId, "葷食便當"), await addLunch(null, other, "葷食便當")];
    await openRegistration();
    await stop("lunch", here);

    expect((await submit({ name: "B 場地", venueId: other, lunchOptionId: there })).ok).toBe(true);
    expect(await stoppedState("lunch_options", [here, there])).toEqual({ [here]: true, [there]: false });
  });
});

describe("停止與名額分開", () => {
  it("重新開放後有空位就能報名", async () => {
    const course = await addCourse(30);
    await openRegistration();
    await stop("course", course);
    await reopen("course", course);

    expect((await submit({ courseIds: [course] })).ok).toBe(true);
  });

  it("重新開放後若仍額滿，仍被拒", async () => {
    const course = await addCourse(1);
    await openRegistration();
    expect((await submit({ name: "先報的", courseIds: [course] })).ok).toBe(true);
    await stop("course", course);
    await reopen("course", course);

    expect(await submit({ name: "後報的", courseIds: [course] })).toMatchObject({ ok: false, fullIds: [course] });
  });

  it("有人取消或名額調高，都不會自動重新開放", async () => {
    const course = await addCourse(1);
    await openRegistration();
    expect((await submit({ name: "先報的", courseIds: [course] })).ok).toBe(true);
    await stop("course", course);
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("name", "先報的"),
    );
    must(await admin.from("courses").update({ capacity: 100 }).eq("id", course));

    expect(await submit({ name: "後報的", courseIds: [course] })).toMatchObject({ ok: false, fullIds: [course] });
    expect(await stoppedState("courses", [course])).toEqual({ [course]: true });
  });

  it("名額調低到已報人數以下，既有報名不變，新報名被拒", async () => {
    const course = await addCourse(10);
    await openRegistration();
    const names = ["甲", "乙", "丙"];
    for (const name of names) expect((await submit({ name, courseIds: [course] })).ok).toBe(true);
    const lowered = await saveItem(headAdmin, {
      kind: "course",
      id: course,
      conferenceId: conferenceId!,
      nameZh: "家譜入門",
      capacity: "2",
    });
    expect(lowered).toMatchObject({ ok: true });

    expect(await submit({ name: "後報的", courseIds: [course] })).toMatchObject({ ok: false, fullIds: [course] });
    for (const name of names) expect(await registrationCount(name)).toBe(1);
  });
});

describe("修改報名時保留原位子", () => {
  async function registered(overrides: Partial<RegistrationInput> = {}): Promise<Registration> {
    const result = await submit(overrides);
    if (!result.ok) throw new Error(`報名失敗：${JSON.stringify(result.errors)}`);
    return result.registration;
  }

  function update(registration: Registration, changes: Partial<RegistrationChanges>) {
    return updateRegistration(serverClient(), {
      registrationId: registration.id,
      lookup: { name: "王小美", phoneOrNumber: "0912345678" },
      // 沒改的選擇原封不動送回去。
      changes: {
        ...changesOf(validInput()),
        courseIds: registration.courseIds,
        lunchOptionId: registration.lunchOptionId,
        afternoonActivityId: registration.afternoonActivityId,
        ...changes,
      },
    });
  }

  /** 資料庫裡存的選擇（含課程），用來確認被拒時原報名完全沒變。 */
  async function stored(id: string) {
    const row = must(
      await admin
        .from("registrations")
        .select("lunch_option_id, afternoon_activity_id, services, updated_at")
        .eq("id", id)
        .single(),
    );
    const courses = must(await admin.from("registration_courses").select("course_id").eq("registration_id", id));
    return { ...row, courseIds: courses.map((course) => course.course_id).toSorted() };
  }

  it("已選了停止的課程、午餐、午后動態的人，修改其他欄位成功，位子保留", async () => {
    const [course, lunch, activity] = [await addCourse(30), await addLunch(30), await addActivity(30)];
    await openRegistration();
    const before = await registered({ courseIds: [course], lunchOptionId: lunch, afternoonActivityId: activity });
    await stop("course", course);
    await stop("lunch", lunch);
    await stop("activity", activity);

    const result = await update(before, { services: ["setup"] });

    expect(result.ok).toBe(true);
    expect(await stored(before.id)).toMatchObject({
      courseIds: [course],
      lunch_option_id: lunch,
      afternoon_activity_id: activity,
      services: ["setup"],
    });
  });

  it("從 A 換到已停止的 B 被拒，原報名完整保留", async () => {
    const [lunchA, lunchB] = [await addLunch(30, venueId, "葷食便當"), await addLunch(30, venueId, "素食便當")];
    await openRegistration();
    const before = await registered({ lunchOptionId: lunchA });
    await stop("lunch", lunchB);
    const saved = await stored(before.id);

    const result = await update(before, { lunchOptionId: lunchB, services: ["setup"] });

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [lunchB] });
    expect(await stored(before.id)).toEqual(saved);
  });
});

describe("成對課程兩堂一起停止", () => {
  let first: string;
  let second: string;

  /** 第一、二場是一組成對課程。 */
  async function pairedCourses(capacities: [number | null, number | null] = [null, null]) {
    first = await addCourse(capacities[0], 1, "手冊研習（上）");
    second = await addCourse(capacities[1], 2, "手冊研習（下）");
    must(
      await admin
        .from("course_pairs")
        .insert({ conference_id: conferenceId, first_course_id: first, second_course_id: second }),
    );
    await openRegistration();
  }

  it("停止其中一堂，兩堂一起停止；新報名兩堂都不能選，畫面上兩堂都是已額滿", async () => {
    await pairedCourses();

    await stop("course", second);

    expect(await stoppedState("courses", [first, second])).toEqual({ [first]: true, [second]: true });
    const result = await submit({ name: "停止後報名", courseIds: [first, second] });
    expect(result).toMatchObject({ ok: false, errors: { courses: "courseFull" } });
    expect(!result.ok && result.fullIds?.toSorted()).toEqual([first, second].toSorted());
    const options = await getRegistrationOptions(anonClient(), "zh");
    const courses = options.venues.flatMap((venue) => venue.sessions.flatMap((session) => session.courses));
    expect(courses.map((course) => course.isFull)).toEqual([true, true]);
  });

  it("重新開放後兩堂狀態一致，且各自仍要通過名額檢查", async () => {
    await pairedCourses([10, 1]);
    expect((await submit({ name: "先報的", courseIds: [first, second] })).ok).toBe(true);
    await stop("course", first);

    await reopen("course", first);

    expect(await stoppedState("courses", [first, second])).toEqual({ [first]: false, [second]: false });
    // 後一堂只有 1 個名額，已經被佔走：兩堂仍一起被拒。
    const result = await submit({ name: "後報的", courseIds: [first, second] });
    expect(!result.ok && result.fullIds?.toSorted()).toEqual([first, second].toSorted());
  });

  it("只改到其中一堂的寫入整筆被拒，兩堂都不變", async () => {
    await pairedCourses();

    // 總管理員直接呼叫 API 只改一堂：交易提交時發現兩堂不一致，整筆不算數。
    const { error } = await headAdmin.from("courses").update({ registration_stopped: true }).eq("id", first);

    expect(error?.message).toBe("course_pair_stopped_apart");
    expect(await stoppedState("courses", [first, second])).toEqual({ [first]: false, [second]: false });
  });

  it("一堂已停止、一堂沒停止的兩門課不能設成一組", async () => {
    first = await addCourse(null, 1, "手冊研習（上）");
    second = await addCourse(null, 2, "手冊研習（下）");
    await stop("course", first);

    expect(await addCoursePair(headAdmin, conferenceId!, first, second)).toEqual({
      ok: false,
      error: "course_pair_stopped_apart",
    });
    expect(must(await admin.from("course_pairs").select("first_course_id").eq("first_course_id", first))).toEqual([]);

    await stop("course", second);
    expect(await addCoursePair(headAdmin, conferenceId!, first, second)).toEqual({ ok: true });
  });

  it("已持有整組成對課程的人，停止後修改其他欄位仍成功，兩堂都保留", async () => {
    await pairedCourses();
    const before = await submit({ courseIds: [first, second] });
    if (!before.ok) throw new Error("報名失敗");
    await stop("course", first);

    const result = await updateRegistration(serverClient(), {
      registrationId: before.registration.id,
      lookup: { name: "王小美", phoneOrNumber: "0912345678" },
      changes: { ...changesOf(validInput()), courseIds: [first, second], services: ["setup"] },
    });

    expect(result.ok).toBe(true);
    const courses = must(
      await admin.from("registration_courses").select("course_id").eq("registration_id", before.registration.id),
    );
    expect(courses.map((course) => course.course_id).toSorted()).toEqual([first, second].toSorted());
  });
});

describe("前台顯示", () => {
  it("停止報名的課程、午餐、午后動態在報名表上是「已額滿」，重新開放後恢復", async () => {
    const [course, lunch, activity] = [await addCourse(null), await addLunch(null), await addActivity(null)];
    await openRegistration();
    await stop("course", course);
    await stop("lunch", lunch);
    await stop("activity", activity);

    const fullness = async () => {
      const [venue] = (await getRegistrationOptions(anonClient(), "zh")).venues;
      return [venue.sessions[0].courses[0], venue.lunchOptions[0], venue.afternoonActivities[0]].map(
        (option) => option.isFull,
      );
    };

    expect(await fullness()).toEqual([true, true, true]);
    await reopen("course", course);
    await reopen("lunch", lunch);
    await reopen("activity", activity);
    expect(await fullness()).toEqual([false, false, false]);
  });
});

describe("停止、調整名額和送出報名搶同一把鎖", () => {
  type Kind = { kind: StoppableKind; add: () => Promise<string>; choice: (id: string) => Partial<RegistrationInput> };
  const kinds: [string, Kind][] = [
    ["課程", { kind: "course", add: () => addCourse(30), choice: (id) => ({ courseIds: [id] }) }],
    ["午餐", { kind: "lunch", add: () => addLunch(30), choice: (id) => ({ lunchOptionId: id }) }],
    ["午后動態", { kind: "activity", add: () => addActivity(30), choice: (id) => ({ afternoonActivityId: id }) }],
  ];
  const tables: Record<StoppableKind, string> = {
    course: "courses",
    lunch: "lunch_options",
    activity: "afternoon_activities",
  };

  /** 在直接連線的交易裡以總管理員的身分停止報名（和後台呼叫的是同一個函式）。 */
  function stopInTransaction(kind: StoppableKind, id: string) {
    return async (tx: TransactionSql) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: headAdminId, role: "authenticated" })}, true)`;
      await tx`select public.set_registration_stopped(${kind}, ${id}, true)`;
    };
  }

  /** 在直接連線的交易裡送出一筆報名，交易結束前一直佔著所選選項的鎖。 */
  function submitInTransaction(name: string, choice: Partial<RegistrationInput>) {
    return (tx: TransactionSql) => tx`
      select id from public.submit_registration(
        ${venueId}, ${stakeId}, ${wardId}, ${name}, '0912345678', null, null, true, 'zh',
        p_course_ids => ${choice.courseIds ?? []}::uuid[],
        p_lunch_option_id => ${choice.lunchOptionId ?? null}::uuid,
        p_afternoon_activity_id => ${choice.afternoonActivityId ?? null}::uuid
      )`;
  }

  it.each(kinds)("%s：停止先完成時，等待中的送出被拒", async (_, { kind, add, choice }) => {
    const id = await add();
    await openRegistration();

    const result = await submitWhileHolding(stopInTransaction(kind, id), () =>
      submit({ name: "等鎖的", ...choice(id) }),
    );

    expect(result).toMatchObject({ ok: false, fullIds: [id] });
    expect(await registrationCount("等鎖的")).toBe(0);
  });

  it.each(kinds)("%s：送出先拿到鎖時照常寫入，停止之後她仍保留位子", async (_, { kind, add, choice }) => {
    const id = await add();
    await openRegistration();

    const stopped = await submitWhileHolding(
      submitInTransaction("先拿到鎖", choice(id)),
      () => setRegistrationStopped(headAdmin, kind, id, true),
      undefined,
      "set_registration_stopped",
    );

    expect(stopped).toEqual({ ok: true });
    expect(await registrationCount("先拿到鎖")).toBe(1);
    expect(await stoppedState(tables[kind], [id])).toEqual({ [id]: true });
  });

  it("調低名額先完成時，等待中的送出被拒", async () => {
    const course = await addCourse(30);
    await openRegistration();
    expect((await submit({ name: "先報的", courseIds: [course] })).ok).toBe(true);

    const result = await submitWhileHolding(
      (tx) => tx`update public.courses set capacity = 1 where id = ${course}`,
      () => submit({ name: "等鎖的", courseIds: [course] }),
    );

    expect(result).toMatchObject({ ok: false, fullIds: [course] });
    expect(await registrationCount("等鎖的")).toBe(0);
  });

  it("送出先拿到鎖時照常寫入，之後才調低名額", async () => {
    const course = await addCourse(30);
    await openRegistration();

    const lowered = await submitWhileHolding(
      submitInTransaction("先拿到鎖", { courseIds: [course] }),
      () => saveItem(headAdmin, { kind: "course", id: course, conferenceId: conferenceId!, nameZh: "家譜入門", capacity: "1" }),
      undefined,
      "save_course",
    );

    expect(lowered).toMatchObject({ ok: true });
    expect(await registrationCount("先拿到鎖")).toBe(1);
  });
});

describe("後台把人加進已停止的選項", () => {
  it("新增報名選了已停止的課程：沒帶確認旗標被拒並回傳需要確認，帶了就成功", async () => {
    const course = await addCourse(30);
    await openRegistration();
    await stop("course", course);
    const input = { ...validInput({ name: "後台加的", courseIds: [course] }), role: "attendee" };

    expect(await staffSubmitRegistration(headAdmin, input, { confirmFull: false })).toEqual({
      ok: false,
      errors: { courses: "courseFull" },
      fullIds: [course],
      needsConfirmation: true,
    });
    expect(await registrationCount("後台加的")).toBe(0);

    expect((await staffSubmitRegistration(headAdmin, input, { confirmFull: true })).ok).toBe(true);
    expect(await registrationCount("後台加的")).toBe(1);
  });

  it("修改報名換到已停止的午餐：沒帶確認旗標被拒並回傳需要確認，帶了就成功", async () => {
    const [open, stopped] = [await addLunch(30, venueId, "葷食便當"), await addLunch(30, venueId, "素食便當")];
    await openRegistration();
    const before = await submit({ lunchOptionId: open });
    if (!before.ok) throw new Error("報名失敗");
    await stop("lunch", stopped);
    const changes = { ...changesOf(validInput()), lunchOptionId: stopped, role: "attendee" };

    expect(
      await staffUpdateRegistration(headAdmin, { registrationId: before.registration.id, changes, confirmFull: false }),
    ).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [stopped], needsConfirmation: true });

    const confirmed = await staffUpdateRegistration(headAdmin, {
      registrationId: before.registration.id,
      changes,
      confirmFull: true,
    });
    expect(confirmed.ok && confirmed.registration.lunchOptionId).toBe(stopped);
  });

  it("確認提示寫出這個選項已停止報名", async () => {
    const [course, lunch] = [await addCourse(30), await addLunch(null)];
    await openRegistration();
    await stop("course", course);
    await stop("lunch", lunch);

    const statistics = await getStatistics(headAdmin, conferenceId!);

    expect(describeFullOptions(statistics, [course, lunch])).toEqual([
      "課程「家譜入門」：已停止報名，名額 30 人，目前已報 0 人，加入後變成 1 人",
      "午餐「葷食便當」：已停止報名，名額不限，目前已報 0 人",
    ]);
  });
});

describe("只有總管理員能停止、重新開放、調名額、換教室", () => {
  const viewers: [string, () => SupabaseClient][] = [
    ["課務組", () => courseTeam],
    ["報報組", () => registrationTeam],
    ["未登入者", () => anonClient()],
  ];

  it.each(viewers)("%s透過後台服務停止、重新開放不了", async (_, client) => {
    const [course, lunch, activity] = [await addCourse(30), await addLunch(30), await addActivity(30)];
    await openRegistration();
    await stop("lunch", lunch);

    for (const [kind, id, stopped] of [
      ["course", course, true],
      ["lunch", lunch, false],
      ["activity", activity, true],
    ] as const) {
      expect(await setRegistrationStopped(client(), kind, id, stopped)).toEqual({ ok: false, error: "not_admin" });
    }
    expect(await stoppedState("courses", [course])).toEqual({ [course]: false });
    expect(await stoppedState("lunch_options", [lunch])).toEqual({ [lunch]: true });
    expect(await stoppedState("afternoon_activities", [activity])).toEqual({ [activity]: false });
  });

  // 權限由資料庫強制（ADR 0004），直接呼叫 API 也一樣。
  it.each(viewers)("%s直接呼叫 API 也停止、調名額、換教室不了", async (_, client) => {
    const [course, lunch, activity] = [await addCourse(30), await addLunch(30), await addActivity(30)];
    must(await admin.from("course_classrooms").insert({ course_id: course, classroom: "101" }));
    await openRegistration();
    const db = client();

    const { error } = await db.rpc("set_registration_stopped", { p_kind: "course", p_id: course, p_stopped: true });
    expect(error).not.toBeNull();
    await Promise.all([
      db.from("courses").update({ registration_stopped: true, capacity: 999 }).eq("id", course),
      db.from("lunch_options").update({ registration_stopped: true, capacity: 999 }).eq("id", lunch),
      db.from("afternoon_activities").update({ registration_stopped: true, capacity: 999 }).eq("id", activity),
      db.from("course_classrooms").update({ classroom: "大教室" }).eq("course_id", course),
      db.rpc("save_course", {
        p_id: course,
        p_conference_id: conferenceId,
        p_session_id: null,
        p_position: 0,
        p_title_zh: "家譜入門",
        p_title_en: "",
        p_description_zh: "",
        p_description_en: "",
        p_capacity: 999,
        p_classroom: "大教室",
      }),
    ]);

    for (const [table, id] of [
      ["courses", course],
      ["lunch_options", lunch],
      ["afternoon_activities", activity],
    ]) {
      expect(must(await admin.from(table).select("registration_stopped, capacity").eq("id", id).single())).toEqual({
        registration_stopped: false,
        capacity: 30,
      });
    }
    expect(must(await admin.from("course_classrooms").select("classroom").eq("course_id", course).single())).toEqual({
      classroom: "101",
    });
  });

  it.each(viewers)("%s直接呼叫後台的送出、修改並帶確認旗標，加入已停止的選項，一律被拒且整筆不寫入", async (_, client) => {
    const [course, lunch] = [await addCourse(30), await addLunch(30)];
    await openRegistration();
    const before = await submit();
    if (!before.ok) throw new Error("報名失敗");
    await stop("course", course);
    await stop("lunch", lunch);
    const choices = { courseIds: [course], lunchOptionId: lunch };

    const added = await staffSubmitRegistration(
      client(),
      { ...validInput({ name: "硬加的", ...choices }), role: "attendee" },
      { confirmFull: true },
    );
    const changed = await staffUpdateRegistration(client(), {
      registrationId: before.registration.id,
      changes: { ...changesOf(validInput()), ...choices, role: "attendee" },
      confirmFull: true,
    });

    expect(added.ok).toBe(false);
    expect(changed.ok).toBe(false);
    expect(await registrationCount("硬加的")).toBe(0);
    expect(
      must(await admin.from("registration_courses").select("course_id").eq("registration_id", before.registration.id)),
    ).toEqual([]);
    expect(
      must(await admin.from("registrations").select("lunch_option_id").eq("id", before.registration.id).single()),
    ).toEqual({ lunch_option_id: null });
  });

  it("前台的送出函式不接受確認旗標", async () => {
    const course = await addCourse(30);
    await openRegistration();
    await stop("course", course);

    const { error } = await anonClient().rpc("submit_registration", {
      p_venue_id: venueId,
      p_stake_id: stakeId,
      p_ward_id: wardId,
      p_name: "帶旗標的",
      p_phone: "0912345678",
      p_email: null,
      p_line_id: null,
      p_portrait_consent: true,
      p_locale: "zh",
      p_course_ids: [course],
      p_confirm_full: true,
    });

    expect(error).not.toBeNull();
    expect(await registrationCount("帶旗標的")).toBe(0);
  });
});

describe("後台監控各選項的報名狀況", () => {
  it("列出每個選項的已報／名額與是否停止報名；課務組看得到該區場地的，別區的看不到", async () => {
    const southVenue = must(
      await admin
        .from("venues")
        .insert({ region: "south", conference_id: conferenceId, name_zh: "高雄教堂" })
        .select("id")
        .single(),
    ).id;
    const [course, lunch] = [await addCourse(30), await addLunch(null)];
    await addLunch(10, southVenue, "南區便當");
    await openRegistration();
    expect((await submit({ courseIds: [course], lunchOptionId: lunch })).ok).toBe(true);
    await stop("course", course);

    const statistics = await getStatistics(courseTeam, conferenceId!);
    const venues = venuesInView(statistics.venues, { role: "course_team", region: "north" });

    expect(venues.map((venue) => venue.name)).toEqual(["台北金華教堂"]);
    const [venue] = venues;
    const [shown] = venue.sessions[0].courses;
    expect({ usage: formatUsage(shown, venue.partial), stopped: shown.stopped }).toEqual({
      usage: "1／30",
      stopped: true,
    });
    expect(venue.lunches.map((option) => [formatUsage(option, venue.partial), option.stopped])).toEqual([
      ["1（不限）", false],
    ]);
  });
});
