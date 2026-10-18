import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Locale } from "./i18n/locale";
import { submitWhileHolding } from "../../test/hold-transaction";
import { adminClient, anonClient, databaseClient, must, serverClient } from "../../test/supabase";
import {
  cancelRegistration,
  changesOf,
  choicesAfterVenueChange,
  choicesOf,
  chooseCourse,
  isRegistrationNumber,
  lookupRegistration,
  nextRegistrationInput,
  submitRegistration,
  updateRegistration,
  validateCourseChoices,
  validateExtraChoices,
  type CourseChoices,
  type ExtraChoices,
  type RegistrationChanges,
  type RegistrationInput,
  type SubmitResult,
} from "./registration";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let opened = false;
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
        // 一開始還沒開放：場次與課程要在開放前建好，第一次送出時才開放（見 openRegistration）。
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  );
  conferenceId = conference.id;
  opened = false;

  venueId = must(
    await admin
      .from("venues")
      .insert({ region: "north", conference_id: conferenceId, name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" })
      .select("id")
      .single(),
  ).id;

  const [taipei, taichung] = must(
    await admin
      .from("stakes")
      .insert([
        { position: 1, region: "north", name_zh: "測試台北支聯會", name_en: "Test Taipei Stake" },
        { position: 2, region: "central", name_zh: "測試台中支聯會", name_en: "Test Taichung Stake" },
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
  // 查詢猜錯的紀錄不屬於任何年度，每個測試清掉，免得累積到暫停查詢。
  must(await admin.from("lookup_failures").delete().gte("attempted_at", "-infinity"));
  must(await admin.from("lookup_locks").delete().gte("locked_until", "-infinity"));
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

/** 開放報名：把開放時間移到現在之前。開放後場次與課程就不能再增刪，所以要先建好。 */
async function openRegistration() {
  if (opened) return;
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() })
      .eq("id", conferenceId!),
  );
  opened = true;
}

/** 以前台訪客的身分送出報名；還沒開放報名的話先開放。 */
async function submit(input: RegistrationInput, locale: Locale = "zh"): Promise<SubmitResult> {
  await openRegistration();
  return submitRegistration(anonClient(), input, locale);
}

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
    lunchOptionId: null,
    choirPart: null,
    services: [],
    printedHandbook: false,
    portraitConsent: true,
    ...overrides,
  };
}

describe("送出報名", () => {
  it("資料齊全時報名成功，回傳存下的資料", async () => {
    const result = await submit(
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
        lunchOptionId: null,
            choirPart: null,
        services: [],
        printedHandbook: false,
      },
    });
  });

  // 代報人用自己的電話幫家人報名。
  it("同一支電話可以報 3 位", async () => {
    const results = [];
    for (const name of ["王媽媽", "王小美", "王小華"]) {
      results.push(await submit(validInput({ name })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  // 疑似重複由後台判斷處理（#24），前台不擋。
  it("姓名、支會都和已有的報名相同時照樣報名成功", async () => {
    const first = await submit(validInput());
    const again = await submit(validInput({ phone: "0922-333-444" }));
    const samePhone = await submit(validInput());

    expect([first.ok, again.ok, samePhone.ok]).toEqual([true, true, true]);
  });

  it("沒有電話的人拿到 6 碼報名編號", async () => {
    const result = await submit(
      validInput({ phone: "", noPhone: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.phone).toBeNull();
    expect(result.registration.registrationNumber).toMatch(/^[1-9]\d{5}$/);
    expect(isRegistrationNumber(result.registration.registrationNumber!)).toBe(true);
  });

  it("沒有同意肖像權不能送出", async () => {
    const result = await submit(validInput({ portraitConsent: false }));

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

    const result = await submitRegistration(anonClient(), validInput(), "zh");

    expect(result).toEqual({ ok: false, errors: { form: "notOpen" } });
  });

  it("支會不屬於所選的支聯會時被拒絕", async () => {
    const result = await submit(validInput({ wardId: taichungWardId }));

    expect(result).toEqual({ ok: false, errors: { ward: "wardUnavailable" } });
  });

  // 教會重新劃分後，舊單位停用；報名表上已不顯示，送出時也不接受。
  it("停用的支會不能選", async () => {
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    const result = await submit(validInput());

    expect(result).toEqual({ ok: false, errors: { ward: "wardUnavailable" } });
  });

  it("停用的支聯會不能選", async () => {
    must(await admin.from("stakes").update({ is_active: false }).eq("id", taipeiStakeId));

    const result = await submit(validInput());

    expect(result).toEqual({ ok: false, errors: { stake: "stakeUnavailable" } });
  });

  // 填表時場地被刪掉（或不屬於目前年度）：請她重新選，不是說她沒選。
  it("場地已不在可選的名單中時被拒絕", async () => {
    const result = await submit(
      validInput({ venueId: crypto.randomUUID() }),
    );

    expect(result).toEqual({ ok: false, errors: { venue: "venueUnavailable" } });
  });

  it("每個有問題的欄位各自標出錯誤", async () => {
    const result = await submit(
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
    const result = await submit(validInput({ phone }));

    expect(result.ok && result.registration.phone).toBe(saved);
  });

  it.each(["1234", "0912-ABC-678", "09123456789012345"])("電話 %s 格式不對", async (phone) => {
    const result = await submit(validInput({ phone }));

    expect(result).toEqual({ ok: false, errors: { phone: "phoneInvalid" } });
  });
});

// 場次與課程只能在開放報名前建立，所以每個測試先建好，送出時才開放報名。
async function addSession(position: number, venue = venueId) {
  return must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venue, position, name_zh: `第${position}場` })
      .select("id")
      .single(),
  ).id;
}

async function addCourse(sessionId: string, capacity: number | null, title = "測試課程") {
  return must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: sessionId, title_zh: title, capacity })
      .select("id")
      .single(),
  ).id;
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

    const result = await submit(validInput({ courseIds: [first, second] }));

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
    await openRegistration();

    const second = await submitWhileHolding(
      (tx) => tx`
        select id from public.submit_registration(
          ${venueId}, ${taipeiStakeId}, ${xindianWardId}, '搶位甲', '0912345678', null, null, true, 'zh',
          ${[course]}::uuid[]
        )`,
      () => submit(validInput({ name: "搶位乙", courseIds: [course] })),
    );

    expect(second).toEqual({ ok: false, errors: { courses: "courseFull" }, fullIds: [course] });
    expect(await registrationCount("搶位甲")).toBe(1);
    expect(await registrationCount("搶位乙")).toBe(0);
  });

  // 報名依 id 順序鎖課程；管理員同一次反過來調整兩門課的名額時，兩邊互等，資料庫會中止其中一邊。
  // 被中止的是報名時，報名服務要自動重送，不能讓她看到「系統出了問題」。
  it("管理員同時調整多門課的名額時，報名照樣成功", async () => {
    const [first, second] = [
      await addCourse(await addSession(1), 10),
      await addCourse(await addSession(2), 10),
    ].sort();
    await openRegistration();

    const result = await submitWhileHolding(
      async (tx) => {
        // 資料庫偵測到互相等待時，中止哪一邊不一定；讓管理員這邊等久一點才檢查，
        // 先發現的一定是報名，被中止的就是報名，才測得到自動重送。
        await tx`set local deadlock_timeout = '10s'`;
        await tx`update public.courses set capacity = 20 where id = ${second}`;
      },
      () => submit(validInput({ name: "調名額時報名", courseIds: [first, second] })),
      (tx) => tx`update public.courses set capacity = 20 where id = ${first}`,
    );

    expect(result.ok).toBe(true);
    expect(await registrationCount("調名額時報名")).toBe(1);
  });

  it("任一門額滿則整筆不寫入，只回傳額滿的那門", async () => {
    const full = await addCourse(await addSession(1), 1);
    const open = await addCourse(await addSession(2), 10);
    expect((await submit(validInput({ name: "先報的", courseIds: [full, open] }))).ok).toBe(true);

    const result = await submit(
      validInput({ name: "後報的", courseIds: [full, open] }),
    );

    expect(result).toEqual({ ok: false, errors: { courses: "courseFull" }, fullIds: [full] });
    expect(await registrationCount("後報的")).toBe(0);
  });

  it("不限人數的課程不會額滿", async () => {
    const course = await addCourse(await addSession(1), null);

    const results = [];
    for (const name of ["甲", "乙", "丙", "丁", "戊"]) {
      results.push(await submit(validInput({ name, courseIds: [course] })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true, true, true]);
  });

  it("已取消的報名不佔名額", async () => {
    const course = await addCourse(await addSession(1), 1);
    const first = await submit(validInput({ courseIds: [course] }));
    if (!first.ok) throw new Error("報名失敗");
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", first.registration.id),
    );

    const result = await submit(validInput({ courseIds: [course] }));

    expect(result.ok).toBe(true);
  });

  // 有的姐妹不是每個時段都上課：沒存課程的場次就是「不選課」。
  it("有場次不選課也能報名，只存選了的課", async () => {
    const first = await addCourse(await addSession(1), null);
    await addCourse(await addSession(2), null);

    const result = await submit(validInput({ courseIds: [first] }));

    expect(result.ok && result.registration.courseIds).toEqual([first]);
  });

  it("每個場次都不選課也能報名", async () => {
    await addCourse(await addSession(1), null);

    const result = await submit(validInput({ courseIds: [] }));

    expect(result.ok).toBe(true);
  });

  it("同一場次選兩門課時被拒絕", async () => {
    const session = await addSession(1);
    const a = await addCourse(session, null, "甲課");
    const b = await addCourse(session, null, "乙課");

    const result = await submit(validInput({ courseIds: [a, b] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("其他場地的課程不能選", async () => {
    await addCourse(await addSession(1), null);
    const otherVenue = must(
      await admin
        .from("venues")
        .insert({ region: "north", conference_id: conferenceId, name_zh: "台中大雅教堂" })
        .select("id")
        .single(),
    ).id;
    const otherCourse = await addCourse(await addSession(1, otherVenue), null);

    const result = await submit(validInput({ courseIds: [otherCourse] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("課程數量多到不合理時直接擋下", async () => {
    const courseIds = Array.from({ length: 21 }, () => crypto.randomUUID());

    const result = await submit(validInput({ courseIds }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("課程編號格式不對時標在課程旁", async () => {
    const result = await submit(validInput({ courseIds: ["abc"] }));

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });
});

/** 把兩堂課設成成對課程；和場次、課程一樣只能在開放報名前設定。 */
async function addPair(first: string, second: string) {
  must(
    await admin
      .from("course_pairs")
      .insert({ conference_id: conferenceId, first_course_id: first, second_course_id: second }),
  );
}

// 成對課程跨越連續兩個場次，兩堂一起選、一起判斷名額。
describe("成對課程", () => {
  let first: string;
  let second: string;

  /** 第一、二場是一組成對課程，第一場另有一門一般的課。 */
  async function pairedCourses(capacities: [number | null, number | null] = [null, null]) {
    const firstSession = await addSession(1);
    first = await addCourse(firstSession, capacities[0], "手冊研習（上）");
    second = await addCourse(await addSession(2), capacities[1], "手冊研習（下）");
    await addPair(first, second);
    return firstSession;
  }

  it("兩堂都選時報名成功，兩堂都記下", async () => {
    await pairedCourses();

    const result = await submit(validInput({ courseIds: [first, second] }));

    expect(result.ok && result.registration.courseIds.toSorted()).toEqual([first, second].toSorted());
  });

  it.each([
    ["只選前一堂", () => [first]],
    ["只選後一堂", () => [second]],
  ])("%s時被拒絕，不可能只報到其中一堂", async (_, courseIds) => {
    await pairedCourses();

    const result = await submit(validInput({ name: "只報一堂", courseIds: courseIds() }));

    expect(result).toEqual({ ok: false, errors: { courses: "coursePairRequired" } });
    const rows = must(
      await admin.from("registrations").select("id").eq("conference_id", conferenceId!).eq("name", "只報一堂"),
    );
    expect(rows).toEqual([]);
  });

  it("其中一堂額滿時兩堂都不能選，送出被拒絕，兩堂都列為額滿", async () => {
    await pairedCourses([10, 1]);
    expect((await submit(validInput({ name: "先報的", courseIds: [first, second] }))).ok).toBe(true);

    const result = await submit(validInput({ name: "後報的", courseIds: [first, second] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({ courses: "courseFull" });
    expect(result.fullIds?.toSorted()).toEqual([first, second].toSorted());
  });

  it("其中一堂額滿時，選課畫面兩堂都標成已額滿", async () => {
    await pairedCourses([1, null]);
    expect((await submit(validInput({ courseIds: [first, second] }))).ok).toBe(true);

    const { data, error } = await anonClient().rpc("full_courses");

    expect(error).toBeNull();
    expect((data as string[]).filter((id) => [first, second].includes(id)).toSorted()).toEqual(
      [first, second].toSorted(),
    );
  });

  it("修改時拿掉其中一堂、留著另一堂被拒絕，原報名不變", async () => {
    const firstSession = await pairedCourses();
    const other = await addCourse(firstSession, null, "一般的課");
    const saved = await submit(validInput({ courseIds: [first, second] }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await updateRegistration(serverClient(), {
      registrationId: saved.registration.id,
      lookup: { name: "王小美", phoneOrNumber: "0912345678" },
      changes: { ...changesOf(validInput()), courseIds: [other, second] },
    });

    expect(result).toEqual({ ok: false, errors: { courses: "coursePairRequired" } });
    const kept = must(
      await admin.from("registration_courses").select("course_id").eq("registration_id", saved.registration.id),
    );
    expect(kept.map((row) => row.course_id).toSorted()).toEqual([first, second].toSorted());
  });

  it("修改時原本的兩堂額滿了照樣保留", async () => {
    await pairedCourses([1, 1]);
    const saved = await submit(validInput({ courseIds: [first, second] }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await updateRegistration(serverClient(), {
      registrationId: saved.registration.id,
      lookup: { name: "王小美", phoneOrNumber: "0912345678" },
      changes: { ...changesOf(validInput()), courseIds: [first, second], email: "mei@example.com" },
    });

    expect(result.ok).toBe(true);
  });

  it("前台讀得到目前年度的成對關係，但不能新增", async () => {
    await pairedCourses();

    const read = await anonClient().from("course_pairs").select("first_course_id, second_course_id");
    const write = await anonClient()
      .from("course_pairs")
      .insert({ conference_id: conferenceId, first_course_id: second, second_course_id: first });

    expect(read.data).toContainEqual({ first_course_id: first, second_course_id: second });
    expect(write.error).not.toBeNull();
  });

  describe("成對關係的規則", () => {
    it.each<[string, () => Promise<[string, string]>]>([
      ["同一場次的兩堂", async () => {
        const session = await addSession(1);
        return [await addCourse(session, null, "甲課"), await addCourse(session, null, "乙課")];
      }],
      ["不同場地的兩堂", async () => [
        await addCourse(await addSession(1), null),
        await addCourse(await addSession(2, await addVenue()), null),
      ]],
    ])("%s不能成對", async (_, courses) => {
      const [a, b] = await courses();

      const { error } = await admin
        .from("course_pairs")
        .insert({ conference_id: conferenceId, first_course_id: a, second_course_id: b });

      expect(error?.message).toBe("course_pair_invalid");
    });

    it("一堂課只能屬於一組", async () => {
      await pairedCourses();
      const third = await addCourse(await addSession(3), null);

      const { error } = await admin
        .from("course_pairs")
        .insert({ conference_id: conferenceId, first_course_id: second, second_course_id: third });

      expect(error?.message).toBe("course_pair_invalid");
    });

    it("成對後把其中一堂移到另一堂的場次被拒絕", async () => {
      await pairedCourses();
      const secondSession = must(await admin.from("courses").select("session_id").eq("id", second).single());

      const { error } = await admin.from("courses").update({ session_id: secondSession.session_id }).eq("id", first);

      expect(error?.message).toBe("course_pair_invalid");
    });

    /**
     * 兩個管理員同時修改：甲的檢查已經做完、還沒提交時，乙也做檢查。
     * 平常檢查在提交時才做，這裡用 SET CONSTRAINTS 讓檢查提早，才能讓兩邊的檢查重疊。
     * 有排隊時乙會等甲提交，看到甲的修改後被拒絕；沒排隊的話兩邊都會成功。回傳乙的錯誤訊息。
     */
    async function concurrently(
      first: (tx: TransactionSql) => Promise<unknown>,
      second: (tx: TransactionSql) => Promise<unknown>,
    ): Promise<string | undefined> {
      const [a, b, watcher] = [databaseClient(), databaseClient(), databaseClient()];
      let release!: () => void;
      const mayCommit = new Promise<void>((resolve) => (release = resolve));
      let checked!: (pid: number) => void;
      const firstChecked = new Promise<number>((resolve) => (checked = resolve));
      const firstDone = a.begin(async (tx) => {
        await first(tx);
        await tx`set constraints all immediate`;
        const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
        checked(pid);
        await mayCommit;
      });
      try {
        const firstPid = await firstChecked;
        let secondChecked = false;
        const secondDone = b
          .begin(async (tx) => {
            await second(tx);
            await tx`set constraints all immediate`;
            secondChecked = true;
          })
          .then(
            () => undefined,
            (error: Error) => error.message,
          );
        // 乙在等甲（有排隊），或乙的檢查已經做完（沒排隊），才讓甲提交。
        for (let waited = 0; !secondChecked; waited += 50) {
          const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
            select exists (
              select 1 from pg_stat_activity where ${firstPid}::int = any(pg_blocking_pids(pid))
            ) as blocked`;
          if (blocked) break;
          if (waited > 3000) throw new Error("乙沒有在等，也沒有做完檢查");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        release();
        await firstDone;
        return await secondDone;
      } finally {
        release();
        await firstDone.catch(() => {});
        await Promise.all([a.end(), b.end(), watcher.end()]);
      }
    }

    it("兩人同時把同一堂課設進兩組，後提交的被拒絕", async () => {
      const a = await addCourse(await addSession(1), null);
      const b = await addCourse(await addSession(2), null);
      const c = await addCourse(await addSession(3), null);

      const error = await concurrently(
        (tx) => tx`insert into public.course_pairs (conference_id, first_course_id, second_course_id)
          values (${conferenceId!}, ${a}, ${b})`,
        (tx) => tx`insert into public.course_pairs (conference_id, first_course_id, second_course_id)
          values (${conferenceId!}, ${b}, ${c})`,
      );

      expect(error).toBe("course_pair_invalid");
      const pairs = must(await admin.from("course_pairs").select("first_course_id").eq("conference_id", conferenceId!));
      expect(pairs).toEqual([{ first_course_id: a }]);
    });

    it("兩人同時把成對的兩堂移到同一個場次，後提交的被拒絕", async () => {
      await pairedCourses();
      const third = await addSession(3);

      const error = await concurrently(
        (tx) => tx`update public.courses set session_id = ${third} where id = ${first}`,
        (tx) => tx`update public.courses set session_id = ${third} where id = ${second}`,
      );

      expect(error).toBe("course_pair_invalid");
      const moved = must(await admin.from("courses").select("id").eq("session_id", third));
      expect(moved).toEqual([{ id: first }]);
    });

    // 一次設定兩個年度的成對課程（順序相反）時，排隊的鎖不能讓兩邊互相等待而被資料庫中止。
    it("兩人同時以相反順序設定兩個年度的成對課程，兩邊都成功", async () => {
      const x = conferenceId!;
      const y = must(
        await admin
          .from("conferences")
          .insert({ year: 2098, conference_date: "2098-05-15", registration_opens_at: new Date(Date.now() + DAY).toISOString() })
          .select("id")
          .single(),
      ).id;
      const coursesIn = async (conference: string) => {
        const venue = must(
          await admin.from("venues").insert({ region: "north", conference_id: conference, name_zh: "測試教堂" }).select("id").single(),
        ).id;
        const ids = [];
        for (const position of [1, 2, 3, 4]) {
          const session = must(
            await admin
              .from("sessions")
              .insert({ conference_id: conference, venue_id: venue, position, name_zh: `第${position}場` })
              .select("id")
              .single(),
          ).id;
          ids.push(
            must(
              await admin
                .from("courses")
                .insert({ conference_id: conference, session_id: session, title_zh: "測試課程" })
                .select("id")
                .single(),
            ).id,
          );
        }
        return ids;
      };
      const pair = (tx: TransactionSql, conference: string, a: string, b: string) =>
        tx`insert into public.course_pairs (conference_id, first_course_id, second_course_id)
          values (${conference}, ${a}, ${b})`;
      const [a, b, watcher] = [databaseClient(), databaseClient(), databaseClient()];
      try {
        const [x1, x2, x3, x4] = await coursesIn(x);
        const [y1, y2, y3, y4] = await coursesIn(y);
        let releaseFirst!: () => void;
        const firstMayGo = new Promise<void>((resolve) => (releaseFirst = resolve));
        let firstChecked!: (pid: number) => void;
        const firstPid = new Promise<number>((resolve) => (firstChecked = resolve));
        // 甲先設定 X 並做完檢查（拿到鎖），等乙也開始後，才設定 Y 並提交。
        const first = a.begin(async (tx) => {
          await pair(tx, x, x1, x2);
          await tx`set constraints all immediate`;
          const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
          firstChecked(pid);
          await firstMayGo;
          await pair(tx, y, y1, y2);
        });
        const pid = await firstPid;
        let secondChecked = false;
        let releaseSecond!: () => void;
        const secondMayGo = new Promise<void>((resolve) => (releaseSecond = resolve));
        // 乙先設定 Y 並做檢查，再設定 X 並提交。
        const second = b.begin(async (tx) => {
          await pair(tx, y, y3, y4);
          await tx`set constraints all immediate`;
          secondChecked = true;
          await secondMayGo;
          await pair(tx, x, x3, x4);
        });
        for (let waited = 0; !secondChecked; waited += 50) {
          const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
            select exists (select 1 from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))) as blocked`;
          if (blocked) break;
          if (waited > 3000) throw new Error("乙沒有在等，也沒有做完檢查");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        releaseFirst();
        releaseSecond();
        const results = await Promise.allSettled([first, second]);

        expect(results.map((result) => (result.status === "rejected" ? String(result.reason) : "ok"))).toEqual([
          "ok",
          "ok",
        ]);
      } finally {
        await Promise.all([a.end(), b.end(), watcher.end()]);
        must(await admin.from("conferences").delete().eq("id", y));
      }
    });

    // 排隊等鎖時跨過了開放時間：拿到鎖之後要再看一次時間，不能用排隊前的判斷。
    it("開放前送出、排隊等到開放後才檢查的新增成對被拒絕", async () => {
      const a = await addCourse(await addSession(1), null);
      const b = await addCourse(await addSession(2), null);
      const [holder, sql, watcher] = [databaseClient(), databaseClient(), databaseClient()];
      let release!: () => void;
      const mayRelease = new Promise<void>((resolve) => (release = resolve));
      let locked!: () => void;
      const holding = new Promise<void>((resolve) => (locked = resolve));
      const held = holder.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('course_pairs_valid', 0))`;
        locked();
        await mayRelease;
      });
      try {
        await holding;
        const opensAt = Date.now() + 1500;
        must(
          await admin
            .from("conferences")
            .update({ registration_opens_at: new Date(opensAt).toISOString() })
            .eq("id", conferenceId!),
        );
        const inserted = sql`insert into public.course_pairs (conference_id, first_course_id, second_course_id)
          values (${conferenceId!}, ${a}, ${b})`.then(
          () => undefined,
          (error: Error) => error.message,
        );
        for (let waited = 0; ; waited += 50) {
          const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
            select exists (
              select 1 from pg_stat_activity where query ~ 'insert into public.course_pairs' and wait_event = 'advisory'
            ) as blocked`;
          if (blocked) break;
          if (waited > 3000) throw new Error("新增成對沒有在等鎖");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        expect(Date.now()).toBeLessThan(opensAt);
        await new Promise((resolve) => setTimeout(resolve, opensAt - Date.now() + 200));
        release();

        expect(await inserted).toBe("programme_locked");
      } finally {
        release();
        await held.catch(() => {});
        await Promise.all([holder.end(), sql.end(), watcher.end()]);
      }
    });

    it("報名開放後重新存一次課程或場次（沒有換場次、場地）不受成對規則影響", async () => {
      const session = await pairedCourses();
      await openRegistration();

      const results = [
        await admin.from("courses").update({ session_id: session, title_zh: "改正的課名" }).eq("id", first),
        await admin.from("sessions").update({ venue_id: venueId, name_zh: "第一場 10:00" }).eq("id", session),
      ];

      expect(results.map((result) => result.error)).toEqual([null, null]);
    });

    it.each<[string, () => PromiseLike<{ error: { message: string } | null }>]>([
      ["新增成對", async () => {
        const [a, b] = [await addCourse(await addSession(3), null), await addCourse(await addSession(4), null)];
        await openRegistration();
        return admin.from("course_pairs").insert({ conference_id: conferenceId, first_course_id: a, second_course_id: b });
      }],
      ["取消成對", async () => {
        await pairedCourses();
        await openRegistration();
        return admin.from("course_pairs").delete().eq("first_course_id", first);
      }],
    ])("報名開放後%s被拒絕", async (_, change) => {
      const { error } = await change();

      expect(error?.message).toBe("programme_locked");
    });

    it("刪除整個年度大會時一起刪掉", async () => {
      await pairedCourses();
      await openRegistration();

      must(await admin.from("conferences").delete().eq("id", conferenceId!));
      conferenceId = undefined;

      const rows = must(await admin.from("course_pairs").select("first_course_id").eq("first_course_id", first));
      expect(rows).toEqual([]);
    });
  });
});

// 午餐屬於場地；和場次、課程一樣只能在開放報名前建立（ADR 0004），所以每個測試先建好，送出時才開放報名。
async function addLunch(capacity: number | null, venue = venueId, name = "葷食便當") {
  return must(
    await admin
      .from("lunch_options")
      .insert({ conference_id: conferenceId, venue_id: venue, name_zh: name, capacity })
      .select("id")
      .single(),
  ).id;
}

async function addVenue(name = "台中大雅教堂") {
  return must(
    await admin.from("venues").insert({ region: "north", conference_id: conferenceId, name_zh: name }).select("id").single(),
  ).id;
}

describe("午餐、服務意願與紙本手冊", () => {
  async function savedRegistration(name: string) {
    return must(
      await admin
        .from("registrations")
        .select("lunch_option_id, choir_part, services, printed_handbook")
        .eq("conference_id", conferenceId!)
        .eq("name", name),
    );
  }

  it("存下所選的午餐、服務意願與紙本手冊，並回傳", async () => {
    const lunch = await addLunch(30);

    const result = await submit(
      validInput({
        name: "全部都選",
        lunchOptionId: lunch,
        choirPart: "alto",
        services: ["reception", "setup", "reception"],
        printedHandbook: true,
      }),
    );

    expect(result.ok && result.registration).toMatchObject({
      lunchOptionId: lunch,
      choirPart: "alto",
      services: ["setup", "reception"],
      printedHandbook: true,
    });
    expect(await savedRegistration("全部都選")).toEqual([
      {
        lunch_option_id: lunch,
        choir_part: "alto",
        services: ["setup", "reception"],
        printed_handbook: true,
      },
    ]);
  });

  it("午餐不需要、沒有服務意願也能報名", async () => {
    await addLunch(30);

    const result = await submit(validInput({ name: "都不需要" }));

    expect(result.ok).toBe(true);
    expect(await savedRegistration("都不需要")).toEqual([
      {
        lunch_option_id: null,
        choir_part: null,
        services: [],
        printed_handbook: false,
      },
    ]);
  });

  it("限量午餐額滿時送出被拒絕，資料不寫入", async () => {
    const lunch = await addLunch(1);
    expect((await submit(validInput({ name: "先訂的", lunchOptionId: lunch }))).ok).toBe(true);

    const result = await submit(validInput({ name: "後訂的", lunchOptionId: lunch }));

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [lunch] });
    expect(await savedRegistration("後訂的")).toEqual([]);
  });

  it("課程、午餐同時額滿時，一次列出全部", async () => {
    const course = await addCourse(await addSession(1), 1);
    const lunch = await addLunch(1);
    const everything = { courseIds: [course], lunchOptionId: lunch };
    expect((await submit(validInput({ name: "先報的", ...everything }))).ok).toBe(true);

    const result = await submit(validInput({ name: "後報的", ...everything }));

    expect(result).toEqual({
      ok: false,
      errors: { courses: "courseFull", lunch: "lunchFull" },
      fullIds: expect.arrayContaining([course, lunch]),
    });
    expect(await savedRegistration("後報的")).toEqual([]);
  });

  // 和課程一樣：讓甲寫到一半、交易還沒結束時乙送出；有鎖住午餐，乙才會等甲寫完、數到已滿。
  it("最後一份午餐兩人同時送出，只有一人成功", async () => {
    const lunch = await addLunch(1);
    await openRegistration();

    const second = await submitWhileHolding(
      (tx) => tx`
        select id from public.submit_registration(
          ${venueId}, ${taipeiStakeId}, ${xindianWardId}, '搶午餐甲', '0912345678', null, null, true, 'zh',
          '{}'::uuid[], ${lunch}::uuid
        )`,
      () => submit(validInput({ name: "搶午餐乙", lunchOptionId: lunch })),
    );

    expect(second).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [lunch] });
    expect(await savedRegistration("搶午餐甲")).toHaveLength(1);
    expect(await savedRegistration("搶午餐乙")).toEqual([]);
  });

  it("不限數量的午餐不會額滿", async () => {
    const lunch = await addLunch(null);

    const results = [];
    for (const name of ["甲", "乙", "丙"]) {
      results.push(await submit(validInput({ name, lunchOptionId: lunch })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  it("已取消的報名不佔午餐", async () => {
    const lunch = await addLunch(1);
    const first = await submit(validInput({ lunchOptionId: lunch }));
    if (!first.ok) throw new Error("報名失敗");
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", first.registration.id),
    );

    const result = await submit(validInput({ lunchOptionId: lunch }));

    expect(result.ok).toBe(true);
  });

  // 每個場地有各自的午餐。
  it("其他場地的午餐不能選", async () => {
    const otherLunch = await addLunch(null, await addVenue());

    const result = await submit(validInput({ lunchOptionId: otherLunch }));

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchUnavailable" } });
  });

  it("A 場地的午餐額滿不影響 B 場地", async () => {
    await addLunch(1);
    const otherVenue = await addVenue();
    const otherLunch = await addLunch(1, otherVenue);
    const [jinhuaLunch] = must(
      await admin.from("lunch_options").select("id").eq("venue_id", venueId),
    );
    expect((await submit(validInput({ name: "金華", lunchOptionId: jinhuaLunch.id }))).ok).toBe(true);

    const result = await submit(validInput({ name: "大雅", venueId: otherVenue, lunchOptionId: otherLunch }));

    expect(result.ok).toBe(true);
  });

  it.each([
    { what: "不認得的服務意願", input: { services: ["dancing"] } },
    { what: "不認得的聲部", input: { choirPart: "tenor" } },
  ])("$what被拒絕", async ({ input }) => {
    const result = await submit(validInput(input));

    expect(result).toEqual({ ok: false, errors: { services: "servicesInvalid" } });
  });

  // 報名表上一定要選要或不要；直接送來沒選的，報名服務也要擋下，不能默默當成不要。
  it("沒有選要不要紙本手冊時被拒絕", async () => {
    const result = await submit(validInput({ printedHandbook: null }));

    expect(result).toEqual({ ok: false, errors: { printedHandbook: "printedHandbookRequired" } });
  });

  it("午餐編號格式不對時標在旁邊", async () => {
    const result = await submit(validInput({ lunchOptionId: "abc" }));

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchUnavailable" } });
  });

  it("有人選過的午餐不能直接刪除", async () => {
    const lunch = await addLunch(10);
    expect((await submit(validInput({ lunchOptionId: lunch }))).ok).toBe(true);

    const { error } = await admin.from("lunch_options").delete().eq("id", lunch);

    // 報名開放後刪除也會被擋（programme_locked），這裡要確認擋下的是報名的外鍵。
    expect(error?.code).toBe("23503");
  });
});

// 午餐、紙本手冊在報名表上要明確選一個（包括「不需要」），免得漏看。
describe("午餐與服務步驟的檢查", () => {
  const lunchA = "00000000-0000-4000-8000-00000000000a";
  const venue = { lunchOptions: [{ id: lunchA }] };
  const bare = { lunchOptions: [] };

  it.each<{ what: string; choices: ExtraChoices; venue: typeof venue; errors: object }>([
    {
      what: "都選了",
      choices: { lunch: lunchA, printedHandbook: true },
      venue,
      errors: {},
    },
    {
      what: "選了不需要、不要手冊",
      choices: { lunch: null, printedHandbook: false },
      venue,
      errors: {},
    },
    {
      what: "都還沒選",
      choices: {},
      venue,
      errors: { lunch: "lunchRequired", printedHandbook: "printedHandbookRequired" },
    },
    // 場地沒有午餐時，不問午餐。
    { what: "場地沒有午餐", choices: { printedHandbook: false }, venue: bare, errors: {} },
    // 換了場地，或選項被刪掉之後，原本的選擇不算數。
    {
      what: "選的午餐已不在這個場地",
      choices: { lunch: "other", printedHandbook: true },
      venue,
      errors: { lunch: "lunchRequired" },
    },
  ])("$what", ({ choices, venue, errors }) => {
    expect(validateExtraChoices(choices, venue)).toEqual(errors);
  });
});

// 課程與時段在開放報名前定案；開放後只能修正文字、調整名額與排序（GLOSSARY「報名開放」）。
describe("開放報名後的場次與課程", () => {
  let sessionId: string;
  let otherSessionId: string;
  let courseId: string;
  let otherVenueId: string;

  beforeEach(async () => {
    sessionId = await addSession(1);
    otherSessionId = await addSession(2);
    courseId = await addCourse(sessionId, 10);
    otherVenueId = await addVenue();
    await openRegistration();
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
    ["換掉課程的編號", () => admin.from("courses").update({ id: crypto.randomUUID() }).eq("id", courseId)],
    ["換掉場次的編號", () => admin.from("sessions").update({ id: crypto.randomUUID() }).eq("id", otherSessionId)],
    ["刪除場次", () => admin.from("sessions").delete().eq("id", sessionId)],
    [
      "把課程移到別的場次",
      () => admin.from("courses").update({ session_id: otherSessionId }).eq("id", courseId),
    ],
    [
      "把場次移到別的場地",
      () => admin.from("sessions").update({ venue_id: otherVenueId }).eq("id", sessionId),
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

  // 將來後台帳號不一定看得到每個年度；看不到也不能被當成還沒開放而放行。
  it("看不到那個年度的人，也判斷得出已經開放", async () => {
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));

    const { data } = await anonClient().rpc("registration_opened", { p_conference_id: conferenceId });

    expect(data).toBe(true);
  });

  // 不然把開放時間改到未來，就能改課程再改回來，繞過這條規則。
  it.each([
    ["改到未來", new Date(Date.now() + DAY / 2).toISOString()],
    ["改到更早", new Date(Date.now() - 1.5 * DAY).toISOString()],
  ])("開放時間到了之後不能再%s", async (_, opensAt) => {
    const { error } = await admin
      .from("conferences")
      .update({ registration_opens_at: opensAt })
      .eq("id", conferenceId!);

    expect(error?.message).toBe("registration_opens_at_locked");
  });

  it("開放時間到了之後不能清空", async () => {
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));

    const { error } = await admin
      .from("conferences")
      .update({ registration_opens_at: null })
      .eq("id", conferenceId!);

    expect(error?.message).toBe("registration_opens_at_locked");
  });

  // 刪除整個年度大會時，場次與課程跟著刪除，不受這條規則限制（每個測試結束時也靠這個清掉資料）。
  it("刪除整個年度大會時一起刪掉", async () => {
    const { error } = await admin.from("conferences").delete().eq("id", conferenceId!);
    conferenceId = undefined;

    expect(error).toBeNull();
  });
});

// 開放前就開始、開放後才確定的修改也要擋下：要用確定當下的時間判斷，不是交易開始的時間。
describe("跨過開放時間的修改", () => {
  // 在開放前新增場次，等開放時間過了才確定：檢查要在確定那一刻、用當下的時間做，才擋得下來。
  it("開放前新增場次，開放後才確定，整個修改不算數", async () => {
    const sql = databaseClient();
    try {
      const attempt = sql.begin(async (tx) => {
        const [{ started }] = await tx<{ started: Date }[]>`select now() as started`;
        // 交易開始之後才把開放時間設在一秒後，確保新增場次時還沒開放。
        const opensAt = new Date(Date.now() + 1000);
        must(
          await admin
            .from("conferences")
            .update({ registration_opens_at: opensAt.toISOString() })
            .eq("id", conferenceId!),
        );
        await tx`
          insert into public.sessions (conference_id, venue_id, name_zh)
          values (${conferenceId!}, ${venueId}, '開放後才確定的場次')`;
        const [{ inserted }] = await tx<{ inserted: Date }[]>`select clock_timestamp() as inserted`;
        expect(started.getTime()).toBeLessThan(opensAt.getTime());
        expect(inserted.getTime()).toBeLessThan(opensAt.getTime());
        await new Promise((resolve) => setTimeout(resolve, 2000));
      });

      await expect(attempt).rejects.toThrow("programme_locked");
      expect(must(await admin.from("sessions").select("id").eq("name_zh", "開放後才確定的場次"))).toEqual([]);
    } finally {
      await sql.end();
    }
  });

  // 延後開放時間的修改還沒確定時，原定時間到了，別人已經看到開放並報名成功；
  // 這時延後不能生效，一起做的課程修改也不算數。
  it("開放前開始延後開放時間，原定時間過了才確定，整個修改不算數", async () => {
    const opensAt = new Date(Date.now() + 1000);
    must(
      await admin
        .from("conferences")
        .update({ registration_opens_at: opensAt.toISOString() })
        .eq("id", conferenceId!),
    );
    opened = true;
    const sql = databaseClient();
    try {
      let visitor: SubmitResult | undefined;
      const attempt = sql.begin(async (tx) => {
        await tx`
          update public.conferences
          set registration_opens_at = ${new Date(Date.now() + DAY / 2)}
          where id = ${conferenceId!}`;
        await tx`
          insert into public.sessions (conference_id, venue_id, name_zh)
          values (${conferenceId!}, ${venueId}, '延後時偷加的場次')`;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        visitor = await submitRegistration(anonClient(), validInput({ name: "原定時間報名" }), "zh");
      });

      await expect(attempt).rejects.toThrow(/registration_opens_at_locked|programme_locked/);
      expect(visitor?.ok).toBe(true);
      const [conference] = must(
        await admin.from("conferences").select("registration_opens_at").eq("id", conferenceId!),
      );
      expect(new Date(conference.registration_opens_at).getTime()).toBe(opensAt.getTime());
      const sessions = must(
        await admin.from("sessions").select("id").eq("name_zh", "延後時偷加的場次"),
      );
      expect(sessions).toEqual([]);
    } finally {
      await sql.end();
    }
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

// 成對課程在選課畫面上一起選、一起取消。
describe("成對課程的選課", () => {
  const sessions = [
    { id: "s1", courses: [{ id: "a1", pairedWith: { sessionId: "s2", courseId: "a2" } }, { id: "x1" }] },
    {
      id: "s2",
      courses: [
        { id: "a2", pairedWith: { sessionId: "s1", courseId: "a1" } },
        { id: "b2", pairedWith: { sessionId: "s3", courseId: "b3" } },
        { id: "x2" },
      ],
    },
    { id: "s3", courses: [{ id: "b3", pairedWith: { sessionId: "s2", courseId: "b2" } }, { id: "x3" }] },
  ];

  it.each<{ what: string; before: CourseChoices; session: string; course: string | null; after: CourseChoices }>([
    { what: "選前一堂時自動選後一堂", before: {}, session: "s1", course: "a1", after: { s1: "a1", s2: "a2" } },
    { what: "選後一堂時自動選前一堂", before: { s1: null }, session: "s2", course: "a2", after: { s1: "a1", s2: "a2" } },
    {
      what: "換成別的課時另一堂也取消，要重選那個場次",
      before: { s1: "a1", s2: "a2", s3: "x3" },
      session: "s1",
      course: "x1",
      after: { s1: "x1", s3: "x3" },
    },
    {
      what: "改成不選課時另一堂也取消",
      before: { s1: "a1", s2: "a2" },
      session: "s2",
      course: null,
      after: { s2: null },
    },
    {
      what: "自動選的那堂換掉了另一組的一堂時，那一組的另一堂也取消",
      before: { s1: "x1", s2: "b2", s3: "b3" },
      session: "s1",
      course: "a1",
      after: { s1: "a1", s2: "a2" },
    },
    { what: "一般的課不影響其他場次", before: { s2: "x2" }, session: "s1", course: "x1", after: { s1: "x1", s2: "x2" } },
  ])("$what", ({ before, session, course, after }) => {
    expect(chooseCourse(before, sessions, session, course)).toEqual(after);
  });

  it("只選到其中一堂時，選課步驟不能過", () => {
    const choices = { s1: "a1", s2: "x2", s3: null };

    expect(validateCourseChoices(choices, sessions)).toEqual({ courses: "coursePairRequired" });
    expect(validateCourseChoices({ s1: "a1", s2: "a2", s3: null }, sessions)).toEqual({});
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
    const result = await submit(validInput(input));

    expect(result).toEqual({ ok: false, errors });
  });

  it("前後的看不見空白會去掉", async () => {
    const result = await submit(
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
  async function callDirectly(overrides: Record<string, unknown> = {}) {
    await openRegistration();
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
        p_locale: "zh",
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

  it.each([null, "fr"])("報名語言是 %s 時被拒絕", async (locale) => {
    const { error } = await callDirectly({ p_locale: locale });

    expect(error).not.toBeNull();
  });
});

describe("報名語言", () => {
  async function storedLocale(id: string) {
    return must(await admin.from("registrations").select("locale").eq("id", id).single()).locale;
  }

  it.each(["zh", "en"] as const)("送出時記下畫面語言 %s", async (locale) => {
    const result = await submit(validInput(), locale);
    if (!result.ok) throw new Error(JSON.stringify(result));

    expect(await storedLocale(result.registration.id)).toBe(locale);
  });
});

// 代報人沒有帳號，只在每筆報名記下送出時使用的電話（ADR 0003）。
describe("代報", () => {
  async function submittedPhone(id: string) {
    return must(await admin.from("registrations").select("submitted_phone").eq("id", id).single())
      .submitted_phone;
  }

  it("連續代報多位，每位都是獨立的報名，各自用姓名和電話查得到", async () => {
    const ids = [];
    for (const name of ["王媽媽", "王小美", "王小華"]) {
      const result = await submit(validInput({ name }));
      if (!result.ok) throw new Error(JSON.stringify(result));
      ids.push(result.registration.id);
    }

    expect(new Set(ids).size).toBe(3);
    for (const [index, name] of ["王媽媽", "王小美", "王小華"].entries()) {
      const found = await lookupRegistration(serverClient(), { name, phoneOrNumber: "0912345678" }, "zh");
      expect(found.ok && found.registrations.map((registration) => registration.id)).toEqual([ids[index]]);
    }
  });

  it("報名記下送出時使用的電話，之後改了電話也不變", async () => {
    const saved = await submit(validInput({ phone: "0912-345-678" }));
    if (!saved.ok) throw new Error(JSON.stringify(saved));

    const updated = await updateRegistration(serverClient(), {
      registrationId: saved.registration.id,
      lookup: { name: "王小美", phoneOrNumber: "0912345678" },
      changes: { ...changesOf(validInput()), phone: "0223456789" },
    });

    expect(updated.ok && updated.registration.phone).toBe("0223456789");
    expect(await submittedPhone(saved.registration.id)).toBe("0912345678");
  });

  it("沒有電話的報名，送出時使用的電話是空的", async () => {
    const saved = await submit(validInput({ phone: "", noPhone: true }));
    if (!saved.ok) throw new Error(JSON.stringify(saved));

    expect(await submittedPhone(saved.registration.id)).toBeNull();
  });

  it("直接寫入資料表時不能自己指定送出時使用的電話", async () => {
    await openRegistration();
    const row = must(
      await admin
        .from("registrations")
        .insert({
          conference_id: conferenceId,
          venue_id: venueId,
          stake_id: taipeiStakeId,
          ward_id: xindianWardId,
          name: "王小美",
          phone: "0912345678",
          submitted_phone: "0987654321",
          portrait_consented_at: new Date().toISOString(),
          locale: "zh",
        })
        .select("submitted_phone")
        .single(),
    );

    expect(row.submitted_phone).toBe("0912345678");
  });

  it("再幫一位報名：帶入電話、Email、支聯會、支會、場地，其他清空", () => {
    const previous = validInput({
      name: "王媽媽",
      email: "mei@example.com",
      lineId: "mama123",
      courseIds: ["00000000-0000-4000-8000-00000000000a"],
      lunchOptionId: "00000000-0000-4000-8000-00000000000b",
      choirPart: "alto",
      services: ["reception"],
      printedHandbook: true,
    });

    expect(nextRegistrationInput(previous)).toEqual({
      name: "",
      phone: "0912-345-678",
      noPhone: false,
      email: "mei@example.com",
      lineId: "",
      stakeId: taipeiStakeId,
      wardId: xindianWardId,
      venueId,
      courseIds: [],
      lunchOptionId: null,
        choirPart: null,
      services: [],
      printedHandbook: null,
      portraitConsent: false,
    });
  });

  it("再幫一位報名：上一位沒有電話時，下一位也先勾著沒有電話", () => {
    const next = nextRegistrationInput(validInput({ phone: "", noPhone: true }));

    expect({ phone: next.phone, noPhone: next.noPhone }).toEqual({ phone: "", noPhone: true });
  });
});

describe("報名資料表", () => {
  it("匿名訪客無法直接讀取或列舉", async () => {
    const saved = await submit(validInput());
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
      locale: "zh",
    });

    expect(error).not.toBeNull();
  });

  it("同時存下報名當下的支聯會與支會", async () => {
    const result = await submit(validInput());
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


describe("查詢報名", () => {
  /** 以前台訪客的身分查詢。 */
  function lookUp(name: string, phoneOrNumber: string) {
    return lookupRegistration(serverClient(), { name, phoneOrNumber }, "zh");
  }

  it("用姓名和電話查得到，顯示完整的報名資料", async () => {
    const saved = await submit(validInput({ email: "mei@example.com", lineId: "mei123" }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await lookUp("王小美", "0912-345-678");

    expect(result).toEqual({
      ok: true,
      registrations: [
        {
          ...saved.registration,
          status: "registered",
          stakeName: "測試台北支聯會",
          wardName: "測試新店支會",
        },
      ],
    });
  });

  // 不透露是哪一項不對：兩種情況是同一個訊息。
  it.each([
    { wrong: "姓名", name: "王小華", phone: "0912345678" },
    { wrong: "電話", name: "王小美", phone: "0912345679" },
  ])("只有$wrong不對時查不到，給同一個溫和的訊息", async ({ name, phone }) => {
    expect((await submit(validInput())).ok).toBe(true);

    const result = await lookUp(name, phone);

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  it("沒有電話的人用姓名和報名編號查得到", async () => {
    const saved = await submit(validInput({ phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await lookUp("王小美", saved.registration.registrationNumber!);

    expect(result.ok && result.registrations.map((found) => found.id)).toEqual([saved.registration.id]);
  });

  it("報名編號對、姓名不對時查不到", async () => {
    const saved = await submit(validInput({ phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await lookUp("王小華", saved.registration.registrationNumber!);

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  // 代報人用自己的電話幫家人報名，每個人查到的是自己那一筆。
  it("同一支電話報了 3 位，各自查到自己的報名", async () => {
    const ids: Record<string, string> = {};
    for (const name of ["王媽媽", "王小美", "王小華"]) {
      const saved = await submit(validInput({ name }));
      if (!saved.ok) throw new Error("報名失敗");
      ids[name] = saved.registration.id;
    }

    for (const name of ["王媽媽", "王小美", "王小華"]) {
      const result = await lookUp(name, "0912345678");
      expect(result.ok && result.registrations.map((found) => [found.name, found.id])).toEqual([
        [name, ids[name]],
      ]);
    }
  });

  it("姓名前後多了空白、英文大小寫不同也查得到", async () => {
    expect((await submit(validInput({ name: "Mary Wang" }))).ok).toBe(true);

    const result = await lookUp("  mary wang ", "0912 345 678");

    expect(result.ok && result.registrations.map((found) => found.name)).toEqual(["Mary Wang"]);
  });

  // 不提供模糊搜尋：只打姓名的一部分查不到。
  it("只對姓名的一部分查不到", async () => {
    expect((await submit(validInput())).ok).toBe(true);

    const result = await lookUp("小美", "0912345678");

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  it("姓名或電話沒填時，請她補填，不去查詢", async () => {
    expect(await lookUp(" ", "")).toEqual({
      ok: false,
      errors: { name: "nameRequired", phoneOrNumber: "phoneOrNumberRequired" },
    });
    expect(await lookUp("王小美", "12-34")).toEqual({
      ok: false,
      errors: { phoneOrNumber: "phoneOrNumberInvalid" },
    });
  });

  // 資料庫函式自己也要擋：少了任何一項都不能回傳報名。
  it.each([
    { missing: "電話與報名編號", args: { p_name: "王小美", p_phone: null, p_registration_number: null } },
    { missing: "姓名", args: { p_name: "", p_phone: "0912345678", p_registration_number: null } },
    { missing: "姓名（null）", args: { p_name: null, p_phone: "0912345678", p_registration_number: null } },
  ])("直接呼叫資料庫函式時，少了$missing就查不到任何報名", async ({ args }) => {
    expect((await submit(validInput())).ok).toBe(true);

    const { data, error } = await serverClient().rpc("lookup_registration", args);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("已截止後仍可查詢", async () => {
    const saved = await submit(validInput());
    if (!saved.ok) throw new Error("報名失敗");
    must(
      await admin
        .from("conferences")
        .update({ registration_closes_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", conferenceId!),
    );

    const result = await lookUp("王小美", "0912345678");

    expect(result.ok && result.registrations.map((found) => found.id)).toEqual([saved.registration.id]);
  });

  it("查得到所選的課程與午餐", async () => {
    const course = await addCourse(await addSession(1), null);
    const lunch = must(
      await admin
        .from("lunch_options")
        .insert({ conference_id: conferenceId, venue_id: venueId, name_zh: "素食便當" })
        .select("id")
        .single(),
    ).id;
    const saved = await submit(validInput({ courseIds: [course], lunchOptionId: lunch }));
    if (!saved.ok) throw new Error("報名失敗");

    const result = await lookUp("王小美", "0912345678");

    expect(result.ok && result.registrations[0]).toMatchObject({
      courseIds: [course],
      lunchOptionId: lunch,
    });
  });

  // 報名後支會被停用（教會重新劃分），查詢時仍顯示她報名當下的支聯會與支會。
  it("支會停用後，查詢仍顯示報名當下的支聯會與支會", async () => {
    expect((await submit(validInput())).ok).toBe(true);
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    const result = await lookUp("王小美", "0912345678");

    expect(result.ok && result.registrations[0]).toMatchObject({
      stakeName: "測試台北支聯會",
      wardName: "測試新店支會",
    });
  });

  it("英文畫面顯示支聯會與支會的英文名稱", async () => {
    expect((await submit(validInput())).ok).toBe(true);

    const result = await lookupRegistration(
      serverClient(),
      { name: "王小美", phoneOrNumber: "0912345678" },
      "en",
    );

    expect(result.ok && result.registrations[0]).toMatchObject({
      stakeName: "Test Taipei Stake",
      wardName: "Test Xindian Ward",
    });
  });

  it("已取消的報名也查得到，並標出已取消", async () => {
    const saved = await submit(validInput());
    if (!saved.ok) throw new Error("報名失敗");
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", saved.registration.id),
    );

    const result = await lookUp("王小美", "0912345678");

    expect(result.ok && result.registrations.map((found) => found.status)).toEqual(["cancelled"]);
  });

  it("不是目前年度的報名查不到", async () => {
    expect((await submit(validInput())).ok).toBe(true);
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));

    const result = await lookUp("王小美", "0912345678");

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  // 報名編號只有 6 碼：知道姓名的人不能一直猜下去。
  it("同一個姓名短時間內猜錯太多次後，暫停查詢，資料正確也一樣", async () => {
    const saved = await submit(validInput({ name: "陳猜猜", phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");
    const number = saved.registration.registrationNumber!;
    const wrong = number === "100000" ? "100001" : "100000";
    expect((await submit(validInput())).ok).toBe(true);
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(await lookUp("陳猜猜", wrong)).toEqual({ ok: false, errors: { form: "notFound" } });
    }

    expect(await lookUp(" 陳猜猜 ", number)).toEqual({
      ok: false,
      errors: { form: "tooManyAttempts" },
    });
    // 其他姓名不受影響。
    expect((await lookUp("王小美", "0912345678")).ok).toBe(true);
  });

  it("姓名中間的空白數量不同也查得到", async () => {
    expect((await submit(validInput({ name: "Mary  Wang" }))).ok).toBe(true);

    const result = await lookUp("mary wang", "0912345678");

    expect(result.ok && result.registrations.map((found) => found.name)).toEqual(["Mary  Wang"]);
  });

  it("同時送出很多次錯誤查詢，也只有 10 次會被比對", async () => {
    const saved = await submit(validInput({ name: "陳猜猜", phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");
    const wrong = saved.registration.registrationNumber === "100000" ? "100001" : "100000";

    const results = await Promise.all(Array.from({ length: 40 }, () => lookUp("陳猜猜", wrong)));

    const notFound = results.filter((result) => !result.ok && result.errors.form === "notFound");
    expect(notFound).toHaveLength(10);
  });

  // 前 9 次是快一小時前猜的，第 10 次是現在：暫停要從第 10 次起算一整個小時。
  it("暫停查詢從第 10 次猜錯起算一小時，不會因為較早的紀錄過期就解除", async () => {
    const saved = await submit(validInput({ name: "陳猜猜", phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");
    const number = saved.registration.registrationNumber!;
    const wrong = number === "100000" ? "100001" : "100000";
    for (let attempt = 0; attempt < 10; attempt++) await lookUp("陳猜猜", wrong);
    // 讓這些猜錯的紀錄都變成一小時多以前的。
    must(
      await admin
        .from("lookup_failures")
        .update({ attempted_at: new Date(Date.now() - 61 * 60 * 1000).toISOString() })
        .gte("attempted_at", "-infinity"),
    );

    expect(await lookUp("陳猜猜", number)).toEqual({ ok: false, errors: { form: "tooManyAttempts" } });
  });
});

// 報名中可以修改；走和送出同一套名額檢查，她原本已佔的名額仍算她的（ADR 0006）。
describe("修改報名", () => {
  const credentials = { name: "王小美", phoneOrNumber: "0912345678" };

  /** 先用送出報名建立一筆，回傳它的 id。 */
  async function registered(overrides: Partial<RegistrationInput> = {}) {
    const saved = await submit(validInput(overrides));
    if (!saved.ok) throw new Error(`報名失敗：${JSON.stringify(saved.errors)}`);
    return saved.registration;
  }

  /** 修改用的內容：沿用 validInput 的值，再套上要改的地方。 */
  function changed(overrides: Partial<RegistrationChanges> = {}): RegistrationChanges {
    return { ...changesOf(validInput()), ...overrides };
  }

  function update(registrationId: string, overrides: Partial<RegistrationChanges> = {}, lookup = credentials) {
    return updateRegistration(serverClient(), { registrationId, lookup, changes: changed(overrides) });
  }

  /** 資料庫裡存的報名（含課程），用來確認被拒時原報名完全沒變。 */
  async function stored(id: string) {
    const row = must(
      await admin
        .from("registrations")
        .select("venue_id, phone, email, line_id, lunch_option_id, choir_part, services, printed_handbook, updated_at")
        .eq("id", id)
        .single(),
    );
    const courses = must(
      await admin.from("registration_courses").select("course_id").eq("registration_id", id),
    );
    return { ...row, courseIds: courses.map((course) => course.course_id).toSorted() };
  }

  it("可以修改場地以外的選擇與聯絡資料，回傳存下的資料", async () => {
    const lunch = await addLunch(null);
    const before = await registered();

    const result = await update(before.id, {
      phone: "02-2345-6789",
      email: "mei@example.com",
      lineId: "mei123",
      lunchOptionId: lunch,
      choirPart: "alto",
      services: ["reception"],
      printedHandbook: true,
    });

    expect(result).toEqual({
      ok: true,
      registration: {
        ...before,
        phone: "0223456789",
        email: "mei@example.com",
        lineId: "mei123",
        lunchOptionId: lunch,
        choirPart: "alto",
        services: ["reception"],
        printedHandbook: true,
      },
    });
    // 改了電話之後，用新的電話查得到。
    const found = await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: "0223456789" }, "zh");
    expect(found.ok && found.registrations.map((registration) => registration.id)).toEqual([before.id]);
  });

  it("修改其他欄位時，保有原本已額滿的課程與午餐", async () => {
    const course = await addCourse(await addSession(1), 1);
    const lunch = await addLunch(1);
    const before = await registered({ courseIds: [course], lunchOptionId: lunch });

    const result = await update(before.id, { courseIds: [course], lunchOptionId: lunch, services: ["setup"] });

    expect(result.ok).toBe(true);
    expect(await stored(before.id)).toMatchObject({
      courseIds: [course],
      lunch_option_id: lunch,
      services: ["setup"],
    });
    // 名額仍是她的：別人報不進來。
    expect(await submit(validInput({ name: "後報的", courseIds: [course] }))).toMatchObject({
      ok: false,
      fullIds: [course],
    });
  });

  it("換掉原本的課，空出來的名額別人可以報", async () => {
    const session = await addSession(1);
    const full = await addCourse(session, 1, "甲課");
    const other = await addCourse(session, null, "乙課");
    const before = await registered({ courseIds: [full] });

    expect((await update(before.id, { courseIds: [other] })).ok).toBe(true);

    expect((await submit(validInput({ name: "後報的", courseIds: [full] }))).ok).toBe(true);
  });

  it("換場地時，存下新場地的課程，舊場地的課程清掉", async () => {
    const oldCourse = await addCourse(await addSession(1), 1);
    const otherVenue = await addVenue();
    const newCourse = await addCourse(await addSession(1, otherVenue), null);
    const lunch = await addLunch(null);
    const before = await registered({ courseIds: [oldCourse], lunchOptionId: lunch });

    const result = await update(before.id, { venueId: otherVenue, courseIds: [newCourse] });

    expect(result.ok && result.registration).toMatchObject({
      venueId: otherVenue,
      courseIds: [newCourse],
      lunchOptionId: null,
    });
    expect(await stored(before.id)).toMatchObject({ venue_id: otherVenue, courseIds: [newCourse] });
  });

  it("換場地但送出舊場地的課程時被拒絕，原報名不變", async () => {
    const oldCourse = await addCourse(await addSession(1), null);
    const otherVenue = await addVenue();
    await addCourse(await addSession(1, otherVenue), null);
    const before = await registered({ courseIds: [oldCourse] });
    const saved = await stored(before.id);

    const result = await update(before.id, { venueId: otherVenue, courseIds: [oldCourse] });

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
    expect(await stored(before.id)).toEqual(saved);
  });

  it("換場地時課程、午餐被清空，沒重選不能送出", () => {
    const [a, b, lunchA, lunchB] = [1, 2, 3, 4].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
    const venueA = { sessions: [{ id: "a1", courses: [{ id: a }] }], lunchOptions: [{ id: lunchA }] };
    const venueB = { sessions: [{ id: "b1", courses: [{ id: b }] }], lunchOptions: [{ id: lunchB }] };
    const before = choicesOf({ courseIds: [a], lunchOptionId: lunchA, printedHandbook: true }, venueA);
    expect(before).toEqual({ courses: { a1: a }, extras: { lunch: lunchA, printedHandbook: true } });

    const after = choicesAfterVenueChange(before);

    expect(after).toEqual({ courses: {}, extras: { printedHandbook: true } });
    expect(validateCourseChoices(after.courses, venueB.sessions)).toEqual({ courses: "courseRequired" });
    expect(validateExtraChoices(after.extras, venueB)).toEqual({ lunch: "lunchRequired" });
  });

  it("原本沒選課的場次，一開始就是「不選課」", () => {
    const a = "00000000-0000-4000-8000-00000000000a";
    const venue = {
      sessions: [
        { id: "s1", courses: [{ id: a }] },
        { id: "s2", courses: [{ id: "00000000-0000-4000-8000-00000000000b" }] },
        { id: "s3", courses: [] },
      ],
    };

    const { courses } = choicesOf({ courseIds: [a], lunchOptionId: null, printedHandbook: false }, venue);

    expect(courses).toEqual({ s1: a, s2: null });
    expect(validateCourseChoices(courses, venue.sessions)).toEqual({});
  });

  it("新選的課額滿時整筆不寫入，原報名不變", async () => {
    const session = await addSession(1);
    const mine = await addCourse(session, null, "原本的課");
    const full = await addCourse(session, 1, "熱門課");
    const lunch = await addLunch(null);
    expect((await submit(validInput({ name: "先報的", courseIds: [full] }))).ok).toBe(true);
    const before = await registered({ courseIds: [mine] });
    const saved = await stored(before.id);

    const result = await update(before.id, { courseIds: [full], lunchOptionId: lunch, email: "mei@example.com" });

    expect(result).toEqual({ ok: false, errors: { courses: "courseFull" }, fullIds: [full] });
    expect(await stored(before.id)).toEqual(saved);
  });

  it("新選的午餐額滿時整筆不寫入，原報名不變", async () => {
    const lunch = await addLunch(1);
    expect((await submit(validInput({ name: "先報的", lunchOptionId: lunch }))).ok).toBe(true);
    const before = await registered();
    const saved = await stored(before.id);

    const result = await update(before.id, { lunchOptionId: lunch, services: ["setup"] });

    expect(result).toEqual({ ok: false, errors: { lunch: "lunchFull" }, fullIds: [lunch] });
    expect(await stored(before.id)).toEqual(saved);
  });

  // 修改和新報名搶同一把鎖：別人的報名寫到一半時她要改成同一門課，會等對方寫完才數到已滿。
  it("和別人同時搶最後一個名額時，等對方寫完才數，不會超收", async () => {
    const session = await addSession(1);
    const mine = await addCourse(session, null, "原本的課");
    const last = await addCourse(session, 1, "剩一個名額");
    const before = await registered({ courseIds: [mine] });

    const result = await submitWhileHolding(
      (tx) => tx`
        select id from public.submit_registration(
          ${venueId}, ${taipeiStakeId}, ${xindianWardId}, '搶位甲', '0987654321', null, null, true, 'zh',
          ${[last]}::uuid[]
        )`,
      () => update(before.id, { courseIds: [last] }),
    );

    expect(result).toEqual({ ok: false, errors: { courses: "courseFull" }, fullIds: [last] });
    expect((await stored(before.id)).courseIds).toEqual([mine]);
  });

  it("已截止時修改被拒絕，原報名不變", async () => {
    const before = await registered();
    const saved = await stored(before.id);
    must(
      await admin
        .from("conferences")
        .update({ registration_closes_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", conferenceId!),
    );

    const result = await update(before.id, { email: "mei@example.com" });

    expect(result).toEqual({ ok: false, errors: { form: "notOpen" } });
    expect(await stored(before.id)).toEqual(saved);
  });

  // 報名開放前不會有前台的報名；這裡用管理員直接寫入一筆（例如後台先建的籌備委員）。
  it("報名開放前修改被拒絕", async () => {
    const { id } = must(
      await admin
        .from("registrations")
        .insert({
          conference_id: conferenceId,
          venue_id: venueId,
          stake_id: taipeiStakeId,
          ward_id: xindianWardId,
          name: "王小美",
          phone: "0912345678",
          portrait_consented_at: new Date().toISOString(),
          locale: "zh",
        })
        .select("id")
        .single(),
    );
    const saved = await stored(id);

    const result = await updateRegistration(serverClient(), {
      registrationId: id,
      lookup: credentials,
      changes: changed({ email: "mei@example.com" }),
    });

    expect(result).toEqual({ ok: false, errors: { form: "notOpen" } });
    expect(await stored(id)).toEqual(saved);
  });

  // 修改內容裡的電話也會拿來比對（見「改了電話卻沒收到結果」），所以猜的人改的電話也是猜的那支。
  it.each([
    { wrong: "姓名", lookup: { name: "王小華", phoneOrNumber: "0912345678" } },
    { wrong: "電話", lookup: { name: "王小美", phoneOrNumber: "0912345679" } },
  ])("$wrong不對時不能修改", async ({ lookup }) => {
    const before = await registered();
    const saved = await stored(before.id);

    const result = await update(before.id, { phone: lookup.phoneOrNumber, email: "mei@example.com" }, lookup);

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
    expect(await stored(before.id)).toEqual(saved);
  });

  // 同一支電話報了好幾位：用媽媽的姓名和電話，不能改到女兒那一筆。
  it("姓名和電話對，但報名不是她的，不能修改", async () => {
    await registered({ name: "王媽媽" });
    const daughter = await registered();

    const result = await update(daughter.id, { email: "mei@example.com" }, { name: "王媽媽", phoneOrNumber: "0912345678" });

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  it("已取消的報名不能修改", async () => {
    const before = await registered();
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", before.id),
    );

    const result = await update(before.id, { email: "mei@example.com" });

    expect(result).toEqual({ ok: false, errors: { form: "cancelled" } });
  });

  // 她在一個分頁取消了，另一個分頁還開著修改表單：姓名電話都對，不算猜錯，不會因此被暫停查詢。
  it("同一個姓名已經猜錯 9 次時，修改已取消的報名不多記猜錯，之後照樣查得到", async () => {
    const before = await registered();
    expect(await cancelRegistration(serverClient(), { registrationId: before.id, lookup: credentials })).toEqual({
      ok: true,
    });
    for (let attempt = 0; attempt < 9; attempt++) {
      await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: `09000000${attempt}0` }, "zh");
    }

    expect(await update(before.id, { email: "mei@example.com" })).toEqual({
      ok: false,
      errors: { form: "cancelled" },
    });

    expect(must(await admin.from("lookup_failures").select("name_hash"))).toHaveLength(9);
    expect((await lookupRegistration(serverClient(), credentials, "zh")).ok).toBe(true);
  });

  it("沒有電話的人用姓名和報名編號修改，報名編號不變", async () => {
    const before = await registered({ phone: "", noPhone: true });

    const result = await update(
      before.id,
      { phone: "", noPhone: true, email: "mei@example.com" },
      { name: "王小美", phoneOrNumber: before.registrationNumber! },
    );

    expect(result.ok && result.registration).toMatchObject({
      phone: null,
      registrationNumber: before.registrationNumber,
      email: "mei@example.com",
    });
  });

  // 報名編號是查詢用的；有沒有電話在報名時就決定了，要改請找管理員。
  it.each([
    { what: "沒有電話的人不能改成有電話", registration: { phone: "", noPhone: true }, changes: { phone: "0912345678", noPhone: false } },
    { what: "有電話的人不能改成沒有電話", registration: {}, changes: { phone: "", noPhone: true } },
  ])("$what", async ({ registration, changes }) => {
    const before = await registered(registration);
    const lookup = { name: "王小美", phoneOrNumber: before.registrationNumber ?? "0912345678" };

    const result = await update(before.id, changes, lookup);

    expect(result).toEqual({ ok: false, errors: { phone: "phoneInvalid" } });
  });

  // 和查詢共用猜錯次數：知道報名 id 的人，也不能用修改一直猜電話或報名編號。
  it("修改時姓名電話不符也算猜錯，同一個姓名猜錯 10 次後暫停，資料正確也一樣", async () => {
    const before = await registered();
    for (let attempt = 0; attempt < 10; attempt++) {
      const guess = `09000000${attempt}0`;
      expect(await update(before.id, { phone: guess }, { name: "王小美", phoneOrNumber: guess })).toEqual({
        ok: false,
        errors: { form: "notFound" },
      });
    }

    expect(await update(before.id, { email: "mei@example.com" })).toEqual({
      ok: false,
      errors: { form: "tooManyAttempts" },
    });
    expect(
      await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: "0912345678" }, "zh"),
    ).toEqual({ ok: false, errors: { form: "tooManyAttempts" } });
  });

  // 改電話的修改已經存下，但回應在路上斷掉：她再按一次送出時，用原本的電話已經對不上了。
  it("改了電話卻沒收到結果，同樣的修改再送一次仍然成功", async () => {
    const before = await registered();
    expect((await update(before.id, { phone: "0987654321" })).ok).toBe(true);

    const again = await update(before.id, { phone: "0987654321" });

    expect(again.ok && again.registration.phone).toBe("0987654321");
  });

  // 原本的電話和改成的電話在同一次比對，重送只算一次嘗試，不會自己多記一次猜錯。
  it("同一個姓名已經猜錯 9 次時，改了電話再送一次仍然成功，也不多記猜錯", async () => {
    const before = await registered();
    expect((await update(before.id, { phone: "0987654321" })).ok).toBe(true);
    for (let attempt = 0; attempt < 9; attempt++) {
      await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: `09000000${attempt}0` }, "zh");
    }

    const again = await update(before.id, { phone: "0987654321" });

    expect(again.ok).toBe(true);
    expect(must(await admin.from("lookup_failures").select("name_hash"))).toHaveLength(9);
  });

  it("格式不對的欄位各自標出錯誤，不去資料庫", async () => {
    const before = await registered();

    const result = await update(before.id, { phone: "123", email: "mei", printedHandbook: null });

    expect(result).toEqual({
      ok: false,
      errors: { phone: "phoneInvalid", email: "emailInvalid", printedHandbook: "printedHandbookRequired" },
    });
  });
});

describe("取消報名", () => {
  const credentials = { name: "王小美", phoneOrNumber: "0912345678" };

  async function registered(overrides: Partial<RegistrationInput> = {}) {
    const saved = await submit(validInput(overrides));
    if (!saved.ok) throw new Error(`報名失敗：${JSON.stringify(saved.errors)}`);
    return saved.registration;
  }

  function cancel(registrationId: string, lookup = credentials) {
    return cancelRegistration(serverClient(), { registrationId, lookup });
  }

  it("取消後狀態為已取消、有取消時間、紀錄仍在，名額釋出", async () => {
    const course = await addCourse(await addSession(1), 1);
    const lunch = await addLunch(1);
    const before = await registered({ courseIds: [course], lunchOptionId: lunch });

    const result = await cancel(before.id);

    expect(result).toEqual({ ok: true });
    const found = await lookupRegistration(serverClient(), credentials, "zh");
    expect(found.ok && found.registrations).toEqual([
      expect.objectContaining({
        id: before.id,
        status: "cancelled",
        courseIds: [course],
        lunchOptionId: lunch,
      }),
    ]);
    const { cancelled_at } = must(
      await admin.from("registrations").select("cancelled_at").eq("id", before.id).single(),
    );
    expect(Math.abs(Date.parse(cancelled_at!) - Date.now())).toBeLessThan(60_000);
  });

  it("已取消的報名不佔名額，之後別人可以報到課程與午餐", async () => {
    const course = await addCourse(await addSession(1), 1);
    const lunch = await addLunch(1);
    const choices = { courseIds: [course], lunchOptionId: lunch };
    const before = await registered(choices);
    expect(await submit(validInput({ name: "後報的", ...choices }))).toMatchObject({ ok: false });

    expect(await cancel(before.id)).toEqual({ ok: true });

    expect((await submit(validInput({ name: "後報的", ...choices }))).ok).toBe(true);
  });

  it("已截止時取消被拒絕，報名照舊", async () => {
    const before = await registered();
    must(
      await admin
        .from("conferences")
        .update({ registration_closes_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", conferenceId!),
    );

    expect(await cancel(before.id)).toEqual({ ok: false, error: "notOpen" });

    const found = await lookupRegistration(serverClient(), credentials, "zh");
    expect(found.ok && found.registrations.map((registration) => registration.status)).toEqual(["registered"]);
  });

  // 取消在截止前開始、排隊等修改放開這一筆的鎖，等到時已經截止：要用拿到鎖當下的時間判斷。
  it("等鎖期間跨過截止的取消被拒絕，報名照舊", async () => {
    const before = await registered();
    const closesAt = Date.now() + 1500;
    must(
      await admin
        .from("conferences")
        .update({ registration_closes_at: new Date(closesAt).toISOString() })
        .eq("id", conferenceId!),
    );

    const result = await submitWhileHolding(
      (tx) => tx`select id from public.registrations where id = ${before.id} for update`,
      () => cancel(before.id),
      () => new Promise((resolve) => setTimeout(resolve, closesAt - Date.now() + 200)),
    );

    expect(result).toEqual({ ok: false, error: "notOpen" });
    const { status } = must(await admin.from("registrations").select("status").eq("id", before.id).single());
    expect(status).toBe("registered");
  });

  it.each([
    { wrong: "姓名", lookup: { name: "王小華", phoneOrNumber: "0912345678" } },
    { wrong: "電話", lookup: { name: "王小美", phoneOrNumber: "0912345679" } },
  ])("$wrong不對時不能取消", async ({ lookup }) => {
    const before = await registered();

    expect(await cancel(before.id, lookup)).toEqual({ ok: false, error: "notFound" });

    const found = await lookupRegistration(serverClient(), credentials, "zh");
    expect(found.ok && found.registrations.map((registration) => registration.status)).toEqual(["registered"]);
  });

  // 同一支電話報了好幾位：用媽媽的姓名和電話，不能取消女兒那一筆。
  it("姓名和電話對，但報名不是她的，不能取消", async () => {
    await registered({ name: "王媽媽" });
    const daughter = await registered();

    expect(await cancel(daughter.id, { name: "王媽媽", phoneOrNumber: "0912345678" })).toEqual({
      ok: false,
      error: "notFound",
    });
  });

  it("沒有電話的人用姓名和報名編號取消", async () => {
    const before = await registered({ phone: "", noPhone: true });
    const lookup = { name: "王小美", phoneOrNumber: before.registrationNumber! };

    expect(await cancel(before.id, lookup)).toEqual({ ok: true });

    const found = await lookupRegistration(serverClient(), lookup, "zh");
    expect(found.ok && found.registrations.map((registration) => registration.status)).toEqual(["cancelled"]);
  });

  // 取消已經存下，但回應在路上斷掉：她再按一次，照樣顯示已取消，取消時間不變。
  it("已取消的報名再取消一次照樣成功，取消時間不變", async () => {
    const before = await registered();
    expect(await cancel(before.id)).toEqual({ ok: true });
    const cancelledAt = async () =>
      must(await admin.from("registrations").select("cancelled_at").eq("id", before.id).single()).cancelled_at;
    const first = await cancelledAt();

    expect(await cancel(before.id)).toEqual({ ok: true });

    expect(await cancelledAt()).toBe(first);
  });

  it("取消後不能再修改", async () => {
    const before = await registered();
    await cancel(before.id);

    const result = await updateRegistration(serverClient(), {
      registrationId: before.id,
      lookup: credentials,
      changes: changesOf(validInput({ email: "mei@example.com" })),
    });

    expect(result).toEqual({ ok: false, errors: { form: "cancelled" } });
  });

  // 和查詢、修改共用猜錯次數：知道報名 id 的人，也不能用取消一直猜電話。
  it("取消時姓名電話不符也算猜錯，同一個姓名猜錯 10 次後暫停，資料正確也一樣", async () => {
    const before = await registered();
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(await cancel(before.id, { name: "王小美", phoneOrNumber: `09000000${attempt}0` })).toEqual({
        ok: false,
        error: "notFound",
      });
    }

    expect(await cancel(before.id)).toEqual({ ok: false, error: "tooManyAttempts" });
    expect(await lookupRegistration(serverClient(), credentials, "zh")).toEqual({
      ok: false,
      errors: { form: "tooManyAttempts" },
    });
  });
});

// 訪客能直接呼叫查詢、修改、取消時，可以對回傳值同時加篩選與轉型（?pgrst_scalar=eq.[]&select=pgrst_scalar::boolean）：
// 猜錯的呼叫出錯、猜錯紀錄跟著撤銷，猜對的卻正常回應，就能不計次數一直猜。所以這三個函式只開放給網站伺服器（ADR 0009）。
describe("直接呼叫查詢、修改、取消函式", () => {
  const wrongNumber = (number: string, attempt: number) => String(((Number(number) - 100000 + attempt + 1) % 900000) + 100000);

  async function registeredWithNumber() {
    const saved = await submit(validInput({ phone: "", noPhone: true }));
    if (!saved.ok) throw new Error("報名失敗");
    return saved.registration;
  }

  const calls: { fn: string; args: (id: string, number: string) => Record<string, unknown> }[] = [
    {
      fn: "lookup_registration",
      args: (_id, number) => ({ p_name: "王小美", p_phone: null, p_registration_number: number }),
    },
    {
      fn: "update_registration",
      args: (id, number) => ({
        p_registration_id: id,
        p_lookup_name: "王小美",
        p_lookup_phone: null,
        p_lookup_registration_number: number,
        p_phone: null,
        p_email: "changed@example.com",
        p_line_id: null,
        p_venue_id: venueId,
      }),
    },
    {
      fn: "cancel_registration",
      args: (id, number) => ({
        p_registration_id: id,
        p_lookup_name: "王小美",
        p_lookup_phone: null,
        p_lookup_registration_number: number,
      }),
    },
  ];
  const ways: { how: string; call: (fn: string, args: Record<string, unknown>) => PromiseLike<{ status: number; data: unknown; error: unknown }> }[] = [
    { how: "照常呼叫", call: (fn, args) => anonClient().rpc(fn, args) },
    { how: "用 GET", call: (fn, args) => anonClient().rpc(fn, args, { get: true }) },
    {
      how: "加篩選與轉型",
      call: (fn, args) =>
        anonClient()
          .rpc(fn, args)
          .select("pgrst_scalar::boolean")
          .eq("pgrst_scalar", fn === "lookup_registration" ? "[]" : "{}"),
    },
  ];

  it.each(calls.flatMap((target) => ways.map((way) => ({ ...target, ...way }))))(
    "訪客$how $fn 一律被拒絕，猜對和猜錯的回應一模一樣，什麼都沒改",
    async ({ fn, args, call }) => {
      const registration = await registeredWithNumber();
      const number = registration.registrationNumber!;
      const response = async (candidate: string) => {
        const { status, data, error } = await call(fn, args(registration.id, candidate));
        return { status, data, error };
      };

      const wrong = await response(wrongNumber(number, 0));
      const correct = await response(number);

      expect(correct).toEqual(wrong);
      expect(correct.error).toMatchObject({ code: "42501" });
      const found = await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: number }, "zh");
      expect(found.ok && found.registrations).toEqual([
        expect.objectContaining({ status: "registered", email: null }),
      ]);
    },
  );

  async function failureCount() {
    return must(await admin.from("lookup_failures").select("name_hash")).length;
  }

  // 一次呼叫帶了幾組不同的電話或報名編號，就算猜了幾次：剛好兩次，不多也不少。
  it("修改時原本的電話與改成的電話是兩支不同的猜測，比對不到就算兩次", async () => {
    const saved = await submit(validInput());
    if (!saved.ok) throw new Error("報名失敗");
    for (let attempt = 0; attempt < 5; attempt++) {
      await updateRegistration(serverClient(), {
        registrationId: saved.registration.id,
        lookup: { name: "王小美", phoneOrNumber: `09000000${attempt}0` },
        changes: { ...changesOf(validInput()), phone: `09000000${attempt}1` },
      });
      expect(await failureCount()).toBe(2 * (attempt + 1));
    }

    expect(await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: "0912345678" }, "zh")).toEqual({
      ok: false,
      errors: { form: "tooManyAttempts" },
    });
  });

  it("查詢時同時帶電話和報名編號，比對不到就算兩次", async () => {
    const registration = await registeredWithNumber();
    const number = registration.registrationNumber!;
    for (let attempt = 0; attempt < 5; attempt++) {
      await serverClient().rpc("lookup_registration", {
        p_name: "王小美",
        p_phone: `09000000${attempt}0`,
        p_registration_number: wrongNumber(number, attempt),
      });
      expect(await failureCount()).toBe(2 * (attempt + 1));
      // 還沒到 10 次之前，資料正確照樣查得到。
      if (attempt === 3) {
        const found = await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: number }, "zh");
        expect(found.ok).toBe(true);
      }
    }

    expect(await lookupRegistration(serverClient(), { name: "王小美", phoneOrNumber: number }, "zh")).toEqual({
      ok: false,
      errors: { form: "tooManyAttempts" },
    });
  });
});


describe("回應斷掉後重送", () => {
  const credentials = { name: "王小美", phoneOrNumber: "0912345678" };

  async function registrationCount() {
    return must(await admin.from("registrations").select("id").eq("conference_id", conferenceId!)).length;
  }

  async function submitWithKey(input: RegistrationInput, key: string) {
    await openRegistration();
    return submitRegistration(anonClient(), input, "zh", key);
  }

  function updateWithKey(registrationId: string, overrides: Partial<RegistrationChanges>, key: string, lookup = credentials) {
    return updateRegistration(serverClient(), {
      registrationId,
      lookup,
      changes: { ...changesOf(validInput()), ...overrides },
      submissionKey: key,
    });
  }

  it("同一個送出編號送兩次，只有一筆報名，第二次回傳和第一次相同的報名", async () => {
    const key = crypto.randomUUID();
    const first = await submitWithKey(validInput({ phone: "", noPhone: true }), key);
    const again = await submitWithKey(validInput({ phone: "", noPhone: true }), key);

    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    expect(await registrationCount()).toBe(1);
  });

  it("同一個送出編號同時送兩次，也只有一筆報名", async () => {
    const key = crypto.randomUUID();
    await openRegistration();
    const results = await Promise.all([submitWithKey(validInput(), key), submitWithKey(validInput(), key)]);

    expect(results[1]).toEqual(results[0]);
    expect(results[0].ok).toBe(true);
    expect(await registrationCount()).toBe(1);
  });

  // 代報、「再幫一位報名」：每次送出各自有新的送出編號。
  it("不同的送出編號照常各自新增，內容一樣也是", async () => {
    const first = await submitWithKey(validInput(), crypto.randomUUID());
    const second = await submitWithKey(validInput(), crypto.randomUUID());

    expect([first.ok, second.ok]).toEqual([true, true]);
    expect(first.ok && second.ok && first.registration.id !== second.registration.id).toBe(true);
    expect(await registrationCount()).toBe(2);
  });

  it("沒有存下的送出（例如額滿被拒）不佔用送出編號，改好再送照樣成功", async () => {
    const course = await addCourse(await addSession(1), 1);
    await submit(validInput({ name: "陳小華", courseIds: [course] }));
    const key = crypto.randomUUID();

    const rejected = await submitWithKey(validInput({ courseIds: [course] }), key);
    const retried = await submitWithKey(validInput(), key);

    expect(rejected.ok).toBe(false);
    expect(retried.ok).toBe(true);
  });

  it("別人的送出編號拿不到她的報名，也不會新增", async () => {
    const key = crypto.randomUUID();
    await submitWithKey(validInput({ phone: "", noPhone: true }), key);

    const other = await submitWithKey(validInput({ name: "陳小華", phone: "", noPhone: true }), key);

    expect(other).toEqual({ ok: false, errors: { form: "unknown" } });
    expect(await registrationCount()).toBe(1);
  });

  it("修改報名用同一個送出編號送兩次，只改一次，第二次回傳相同的報名", async () => {
    const saved = await submit(validInput());
    if (!saved.ok) throw new Error("報名失敗");
    const key = crypto.randomUUID();

    const first = await updateWithKey(saved.registration.id, { email: "mei@example.com" }, key);
    const { updated_at } = must(
      await admin.from("registrations").select("updated_at").eq("id", saved.registration.id).single(),
    );
    const again = await updateWithKey(saved.registration.id, { email: "mei@example.com" }, key);

    expect(first.ok).toBe(true);
    expect(again).toEqual(first);
    const after = must(await admin.from("registrations").select("updated_at").eq("id", saved.registration.id).single());
    expect(after.updated_at).toBe(updated_at);
  });

  it("新增報名的送出編號不能拿來修改報名，修改另一筆報名的也不行", async () => {
    const submitKey = crypto.randomUUID();
    const mine = await submitWithKey(validInput(), submitKey);
    const sister = await submit(validInput({ name: "王小華" }));
    if (!mine.ok || !sister.ok) throw new Error("報名失敗");
    const updateKey = crypto.randomUUID();
    await updateWithKey(sister.registration.id, { email: "hua@example.com" }, updateKey, {
      name: "王小華",
      phoneOrNumber: "0912345678",
    });

    const withSubmitKey = await updateWithKey(mine.registration.id, { email: "mei@example.com" }, submitKey);
    const withSistersKey = await updateWithKey(mine.registration.id, { email: "hua@example.com" }, updateKey);

    expect(withSubmitKey).toEqual({ ok: false, errors: { form: "unknown" } });
    expect(withSistersKey).toEqual({ ok: false, errors: { form: "unknown" } });
    const stored = must(await admin.from("registrations").select("email").eq("id", mine.registration.id).single());
    expect(stored.email).toBeNull();
  });

  // 拿到她原本的送出內容與編號的人，不能用舊電話繞過查詢，讀到她改過的聯絡資料。
  it("報名之後改過內容，用原本的送出內容與編號重送，讀不到改過的資料", async () => {
    const key = crypto.randomUUID();
    const saved = await submitWithKey(validInput(), key);
    if (!saved.ok) throw new Error("報名失敗");
    const changedResult = await updateWithKey(
      saved.registration.id,
      { phone: "0922333444", email: "new@example.com" },
      crypto.randomUUID(),
    );
    expect(changedResult.ok).toBe(true);

    const again = await submitWithKey(validInput(), key);

    expect(again).toEqual({ ok: false, errors: { form: "unknown" } });
    expect(await registrationCount()).toBe(1);
  });

  it("報名之後取消了，用原本的送出內容與編號重送，也讀不到", async () => {
    const key = crypto.randomUUID();
    const saved = await submitWithKey(validInput(), key);
    if (!saved.ok) throw new Error("報名失敗");
    expect(await cancelRegistration(serverClient(), { registrationId: saved.registration.id, lookup: credentials })).toEqual({ ok: true });

    expect(await submitWithKey(validInput(), key)).toEqual({ ok: false, errors: { form: "unknown" } });
  });

  it("重送前切換了畫面語言，仍回傳上次存下的報名", async () => {
    const key = crypto.randomUUID();
    await openRegistration();
    const first = await submitRegistration(anonClient(), validInput(), "zh", key);
    const again = await submitRegistration(anonClient(), validInput(), "en", key);

    expect(again).toEqual(first);
    expect(await registrationCount()).toBe(1);
  });

  // 紀錄裡有送出內容的雜湊，不留太久（見 20261103000000_submission_keys.sql）。
  it("一天以前的送出編號紀錄，之後有人送出時刪掉", async () => {
    const oldKey = crypto.randomUUID();
    await submitWithKey(validInput(), oldKey);
    must(
      await admin
        .from("submissions")
        .update({ created_at: new Date(Date.now() - 2 * DAY).toISOString() })
        .eq("key", oldKey),
    );

    await submitWithKey(validInput({ name: "陳小華" }), crypto.randomUUID());

    expect(must(await admin.from("submissions").select("key").eq("key", oldKey))).toEqual([]);
  });

  it("訪客讀不到送出編號的紀錄", async () => {
    await submitWithKey(validInput(), crypto.randomUUID());

    const { data, error } = await anonClient().from("submissions").select("*");

    expect(data ?? []).toEqual([]);
    expect(error === null || error.code === "42501").toBe(true);
  });
});
