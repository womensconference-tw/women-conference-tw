import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, serverClient, signedInClient } from "../../test/supabase";
import {
  changesOf,
  staffCancelRegistration,
  staffSubmitRegistration,
  staffUpdateRegistration,
  submitRegistration,
  updateRegistration,
  type RegistrationInput,
  type StaffRegistrationChanges,
  type StaffRegistrationInput,
} from "./registration";
import { getRegistrationForEdit } from "./registration-list";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string;
let stakeIds: string[] = [];
let venueId: string;
let otherVenueId: string;
let taipeiStakeId: string;
let xindianWardId: string;
let quiltingId: string;
let singingId: string;
let bentoId: string;
let walkId: string;

/*
 * 每個測試都有一個報名中的 2099 年度大會：
 * - 北區金華：上午場次有拼布（容量 1）、唱歌（不限人數）；午餐便當（限量 1）；午后動態散步（限量 1）。
 * - 中區大雅：沒有課程。
 * 支聯會北區台北（新店支會），以及總管理員、北區課務組、北區報報組、全區報報組。
 * 測完全部刪掉、復原原本的目前年度。
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
        conference_date: "2099-05-15",
        announce_at: new Date(now - 2 * DAY).toISOString(),
        // 場地與課程要在開放前建好（*_locked_after_opening），建好後才開放。
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;

  [venueId, otherVenueId] = must(
    await admin
      .from("venues")
      .insert([
        { region: "north", conference_id: conferenceId, position: 1, name_zh: "測試金華教堂" },
        { region: "central", conference_id: conferenceId, position: 2, name_zh: "測試大雅教堂" },
      ])
      .select("id, position")
      .order("position"),
  ).map((venue) => venue.id);

  const morningId = must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: "上午" })
      .select("id")
      .single(),
  ).id;
  [quiltingId, singingId] = must(
    await admin
      .from("courses")
      .insert([
        { conference_id: conferenceId, session_id: morningId, position: 1, title_zh: "拼布", capacity: 1 },
        { conference_id: conferenceId, session_id: morningId, position: 2, title_zh: "唱歌", capacity: null },
      ])
      .select("id, position")
      .order("position"),
  ).map((course) => course.id);
  bentoId = must(
    await admin
      .from("lunch_options")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: "便當", capacity: 1 })
      .select("id")
      .single(),
  ).id;
  walkId = must(
    await admin
      .from("afternoon_activities")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, title_zh: "散步", capacity: 1 })
      .select("id")
      .single(),
  ).id;

  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conferenceId),
  );

  taipeiStakeId = must(
    await admin.from("stakes").insert({ position: 1, region: "north", name_zh: "測試台北支聯會" }).select("id").single(),
  ).id;
  stakeIds = [taipeiStakeId];
  xindianWardId = must(
    await admin.from("wards").insert({ stake_id: taipeiStakeId, name_zh: "測試新店支會" }).select("id").single(),
  ).id;

  for (const [email, scope] of [
    ["head@example.com", { role: "admin" }],
    ["course@example.com", { role: "course_team", region: "north" }],
    ["report@example.com", { role: "registration_team", region: "north" }],
    ["everywhere@example.com", { role: "registration_team", region: null }],
  ] as const) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
  }
});

afterEach(async () => {
  must(await admin.from("staff_members").delete().not("user_id", "is", null));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  // 刪掉年度大會時，它的場地、課程與報名一起刪除。
  must(await admin.from("conferences").delete().eq("id", conferenceId));
  must(await admin.from("wards").delete().in("stake_id", stakeIds));
  must(await admin.from("stakes").delete().in("id", stakeIds));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

function validInput(overrides: Partial<StaffRegistrationInput> = {}): StaffRegistrationInput {
  return {
    name: "王小美",
    phone: "0912345678",
    noPhone: false,
    email: "",
    lineId: "",
    stakeId: taipeiStakeId,
    wardId: xindianWardId,
    venueId,
    courseIds: [],
    lunchOptionId: null,
    afternoonActivityId: null,
    choirPart: null,
    services: [],
    printedHandbook: false,
    portraitConsent: true,
    role: "attendee",
    ...overrides,
  };
}

function changed(overrides: Partial<StaffRegistrationChanges> = {}): StaffRegistrationChanges {
  return { ...changesOf(validInput()), role: "attendee", ...overrides };
}

/** 報名截止：把截止時間移到現在之前。 */
async function closeRegistration() {
  must(
    await admin
      .from("conferences")
      .update({ registration_closes_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", conferenceId),
  );
}

/** 以前台訪客的身分報一筆，佔掉拼布、便當、散步各一個名額；回傳 id。 */
async function publicRegistration(overrides: Partial<RegistrationInput> = {}) {
  const input: RegistrationInput = {
    ...validInput({ name: "李大華", courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId }),
    ...overrides,
  };
  const result = await submitRegistration(anonClient(), input, "zh");
  if (!result.ok) throw new Error(`報名失敗：${JSON.stringify(result.errors)}`);
  return result.registration.id;
}

/** 資料庫裡存的報名（含課程），用來確認被拒時資料沒變。 */
async function stored(id: string) {
  const row = must(
    await admin
      .from("registrations")
      .select("venue_id, role, status, email, lunch_option_id, afternoon_activity_id, printed_handbook, updated_at")
      .eq("id", id)
      .single(),
  );
  const courses = must(await admin.from("registration_courses").select("course_id").eq("registration_id", id));
  return { ...row, courseIds: courses.map((course) => course.course_id).toSorted() };
}

async function registrationCount() {
  return must(await admin.from("registrations").select("id").eq("conference_id", conferenceId)).length;
}

describe("後台新增報名", () => {
  it("總管理員新增報名，存下身分類別與所選的課程、午餐", async () => {
    const result = await staffSubmitRegistration(
      await signedInClient("head@example.com"),
      validInput({ role: "speaker", courseIds: [singingId], lunchOptionId: bentoId }),
      { confirmFull: false },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.courseIds).toEqual([singingId]);
    expect(await stored(result.registration.id)).toMatchObject({
      role: "speaker",
      status: "registered",
      lunch_option_id: bentoId,
      courseIds: [singingId],
    });
  });

  it("報名截止後仍可新增", async () => {
    await closeRegistration();

    const result = await staffSubmitRegistration(await signedInClient("head@example.com"), validInput(), {
      confirmFull: false,
    });

    expect(result.ok).toBe(true);
  });

  it("和前台同一套欄位檢查：支會不屬於所選的支聯會時被拒絕", async () => {
    const otherStakeId = must(
      await admin.from("stakes").insert({ region: "south", name_zh: "測試台南支聯會" }).select("id").single(),
    ).id;
    stakeIds.push(otherStakeId);

    const result = await staffSubmitRegistration(
      await signedInClient("head@example.com"),
      validInput({ stakeId: otherStakeId }),
      { confirmFull: false },
    );

    expect(result).toEqual({ ok: false, errors: { ward: "wardUnavailable" } });
    expect(await registrationCount()).toBe(0);
  });

  it("和前台同一套選項檢查：其他場地的課程不能選", async () => {
    const result = await staffSubmitRegistration(
      await signedInClient("head@example.com"),
      validInput({ venueId: otherVenueId, courseIds: [singingId] }),
      { confirmFull: true },
    );

    expect(result).toEqual({ ok: false, errors: { courses: "courseRequired" } });
  });

  it("超收沒有帶確認旗標時被拒絕，回傳需要確認與額滿的選項，資料不寫入", async () => {
    await publicRegistration();
    const head = await signedInClient("head@example.com");

    const result = await staffSubmitRegistration(
      head,
      validInput({ courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId }),
      { confirmFull: false },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.needsConfirmation).toBe(true);
    expect(result.fullIds?.toSorted()).toEqual([quiltingId, bentoId, walkId].toSorted());
    expect(await registrationCount()).toBe(1);
  });

  it("超收帶了確認旗標就成功，人數超過容量", async () => {
    await publicRegistration();

    const result = await staffSubmitRegistration(
      await signedInClient("head@example.com"),
      validInput({ courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId }),
      { confirmFull: true },
    );

    expect(result.ok).toBe(true);
    const quilting = must(
      await admin.from("registration_courses").select("registration_id").eq("course_id", quiltingId),
    );
    expect(quilting).toHaveLength(2);
  });

  it("身分類別不認得時被拒絕", async () => {
    const result = await staffSubmitRegistration(
      await signedInClient("head@example.com"),
      validInput({ role: "boss" }),
      { confirmFull: false },
    );

    expect(result).toEqual({ ok: false, errors: { role: "roleInvalid" } });
    expect(await registrationCount()).toBe(0);
  });

  it("不是目前年度時不能新增", async () => {
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId));

    const result = await staffSubmitRegistration(await signedInClient("head@example.com"), validInput(), {
      confirmFull: false,
    });

    expect(result).toEqual({ ok: false, errors: { venue: "venueUnavailable" } });
  });
});

describe("後台修改報名", () => {
  // 修改畫面一開始照讀到的課程填好；讀不到課程的話，存檔時會把她的課全部拿掉。
  it("修改畫面讀得到她選的課程、午餐、午后動態", async () => {
    const id = await publicRegistration();

    const registration = await getRegistrationForEdit(await signedInClient("head@example.com"), id);

    expect(registration).toMatchObject({ courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId });
  });

  it("總管理員可以修改選擇、聯絡資料與身分類別，報名截止後也可以", async () => {
    const id = await publicRegistration({ courseIds: [], lunchOptionId: null, afternoonActivityId: null });
    await closeRegistration();

    const result = await staffUpdateRegistration(await signedInClient("head@example.com"), {
      registrationId: id,
      changes: changed({ role: "committee", email: "mei@example.com", courseIds: [singingId], printedHandbook: true }),
      confirmFull: false,
    });

    expect(result.ok).toBe(true);
    expect(await stored(id)).toMatchObject({
      role: "committee",
      email: "mei@example.com",
      printed_handbook: true,
      courseIds: [singingId],
    });
  });

  it("保有她原本已額滿的選項，不必確認", async () => {
    const id = await publicRegistration();

    const result = await staffUpdateRegistration(await signedInClient("head@example.com"), {
      registrationId: id,
      changes: changed({
        role: "team",
        courseIds: [quiltingId],
        lunchOptionId: bentoId,
        afternoonActivityId: walkId,
      }),
      confirmFull: false,
    });

    expect(result.ok).toBe(true);
  });

  it("改到額滿的課程沒帶確認旗標時被拒絕並回傳需要確認，原報名不變；帶旗標就成功", async () => {
    await publicRegistration();
    const id = await publicRegistration({
      name: "陳小玉",
      courseIds: [singingId],
      lunchOptionId: null,
      afternoonActivityId: null,
    });
    const before = await stored(id);
    const head = await signedInClient("head@example.com");
    const update = (confirmFull: boolean) =>
      staffUpdateRegistration(head, {
        registrationId: id,
        changes: changed({ courseIds: [quiltingId] }),
        confirmFull,
      });

    const rejected = await update(false);
    expect(rejected).toMatchObject({ ok: false, needsConfirmation: true, fullIds: [quiltingId] });
    expect(await stored(id)).toEqual(before);

    const confirmed = await update(true);
    expect(confirmed.ok).toBe(true);
    expect((await stored(id)).courseIds).toEqual([quiltingId]);
  });

  it("已取消的報名不能修改", async () => {
    const id = await publicRegistration();
    const head = await signedInClient("head@example.com");
    expect(await staffCancelRegistration(head, id)).toEqual({ ok: true });

    const result = await staffUpdateRegistration(head, {
      registrationId: id,
      changes: changed(),
      confirmFull: false,
    });

    expect(result).toEqual({ ok: false, errors: { form: "cancelled" } });
  });

  it("找不到的報名回傳找不到", async () => {
    const result = await staffUpdateRegistration(await signedInClient("head@example.com"), {
      registrationId: "00000000-0000-4000-8000-000000000000",
      changes: changed(),
      confirmFull: false,
    });

    expect(result).toEqual({ ok: false, errors: { form: "notFound" } });
  });

  it("沒有電話的報名不能改成有電話", async () => {
    const id = await publicRegistration({ phone: "", noPhone: true });

    const result = await staffUpdateRegistration(await signedInClient("head@example.com"), {
      registrationId: id,
      changes: changed({ courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId }),
      confirmFull: false,
    });

    expect(result).toEqual({ ok: false, errors: { phone: "phoneInvalid" } });
  });
});

describe("後台取消報名", () => {
  it("總管理員取消報名，截止後也可以，名額釋出；再取消一次照樣成功", async () => {
    const id = await publicRegistration();
    await closeRegistration();
    const head = await signedInClient("head@example.com");

    expect(await staffCancelRegistration(head, id)).toEqual({ ok: true });
    expect(await staffCancelRegistration(head, id)).toEqual({ ok: true });

    const row = must(await admin.from("registrations").select("status, cancelled_at").eq("id", id).single());
    expect(row.status).toBe("cancelled");
    expect(row.cancelled_at).not.toBeNull();
    const result = await staffSubmitRegistration(
      head,
      validInput({ courseIds: [quiltingId], lunchOptionId: bentoId, afternoonActivityId: walkId }),
      { confirmFull: false },
    );
    expect(result.ok).toBe(true);
  });

  it("找不到的報名回傳找不到", async () => {
    const result = await staffCancelRegistration(
      await signedInClient("head@example.com"),
      "00000000-0000-4000-8000-000000000000",
    );

    expect(result).toEqual({ ok: false, error: "notFound" });
  });
});

describe("只有總管理員能新增、修改、取消報名", () => {
  const viewers = ["course@example.com", "report@example.com", "everywhere@example.com"];

  it.each(viewers)("%s 不能新增報名，帶確認旗標也一樣", async (email) => {
    const client = await signedInClient(email);

    for (const confirmFull of [false, true]) {
      const result = await staffSubmitRegistration(client, validInput(), { confirmFull });
      expect(result).toEqual({ ok: false, errors: { form: "notAllowed" } });
    }
    expect(await registrationCount()).toBe(0);
  });

  it.each(viewers)("%s 不能修改報名或身分類別，帶確認旗標也一樣", async (email) => {
    const id = await publicRegistration();
    const before = await stored(id);
    const client = await signedInClient(email);

    for (const confirmFull of [false, true]) {
      const result = await staffUpdateRegistration(client, {
        registrationId: id,
        changes: changed({ role: "speaker", courseIds: [singingId] }),
        confirmFull,
      });
      expect(result).toEqual({ ok: false, errors: { form: "notAllowed" } });
    }
    expect(await stored(id)).toEqual(before);
  });

  it.each(viewers)("%s 不能取消報名", async (email) => {
    const id = await publicRegistration();

    const result = await staffCancelRegistration(await signedInClient(email), id);

    expect(result).toEqual({ ok: false, error: "notAllowed" });
    expect((await stored(id)).status).toBe("registered");
  });

  it.each(viewers)("%s 直接寫入報名資料表也被拒", async (email) => {
    const id = await publicRegistration();
    const before = await stored(id);
    const client = await signedInClient(email);

    await client.from("registrations").update({ role: "speaker", status: "cancelled" }).eq("id", id);
    await client.from("registration_courses").delete().eq("registration_id", id);

    expect(await stored(id)).toEqual(before);
  });

  it("未登入的訪客不能呼叫後台的函式", async () => {
    const id = await publicRegistration();
    const before = await stored(id);
    const anon = anonClient();

    expect((await staffSubmitRegistration(anon, validInput(), { confirmFull: true })).ok).toBe(false);
    expect((await staffUpdateRegistration(anon, { registrationId: id, changes: changed(), confirmFull: true })).ok).toBe(
      false,
    );
    expect((await staffCancelRegistration(anon, id)).ok).toBe(false);
    const { error } = await anon.rpc("staff_cancel_registration", { p_registration_id: id });
    expect(error).not.toBeNull();
    expect(await stored(id)).toEqual(before);
    expect(await registrationCount()).toBe(1);
  });
});

describe("身分類別", () => {
  async function roleOf(id: string) {
    return (await stored(id)).role;
  }

  it("前台報名一律是與會姐妹", async () => {
    expect(await roleOf(await publicRegistration())).toBe("attendee");
  });

  it("前台修改報名不會改掉總管理員設定的身分類別", async () => {
    const id = await publicRegistration({ courseIds: [], lunchOptionId: null, afternoonActivityId: null });
    const head: SupabaseClient = await signedInClient("head@example.com");
    const staffResult = await staffUpdateRegistration(head, {
      registrationId: id,
      changes: changed({ role: "volunteer" }),
      confirmFull: false,
    });
    expect(staffResult.ok).toBe(true);

    const result = await updateRegistration(serverClient(), {
      registrationId: id,
      lookup: { name: "李大華", phoneOrNumber: "0912345678" },
      changes: { ...changesOf(validInput()), email: "hua@example.com" },
    });

    expect(result.ok).toBe(true);
    expect(await roleOf(id)).toBe("volunteer");
  });
});
