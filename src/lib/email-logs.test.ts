import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, serverClient, signedInClient } from "../../test/supabase";
import { sendConfirmationEmail, type EmailMessage, type SendEmail } from "./confirmation-email";
import { getEmailLogs, resendConfirmationEmail } from "./email-logs";
import { submitRegistration, type RegistrationInput } from "./registration";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string;
let stakeId: string;
let wardId: string;
let venueId: string;
let courseId: string;

/*
 * 每個測試都有一個報名中的 2099 年度大會：一個場地、一個場次一門課、一個支聯會一個支會，
 * 以及總管理員、北區課務組、全區報報組。測完全部刪掉、復原原本的目前年度。
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
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
  venueId = must(
    await admin
      .from("venues")
      .insert({ region: "north", conference_id: conferenceId, name_zh: "測試金華教堂", name_en: "Test Jinhua Chapel" })
      .select("id")
      .single(),
  ).id;
  const sessionId = must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: "上午", name_en: "Morning" })
      .select("id")
      .single(),
  ).id;
  courseId = must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: sessionId, position: 1, title_zh: "家譜入門", title_en: "Family history" })
      .select("id")
      .single(),
  ).id;
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conferenceId),
  );
  stakeId = must(
    await admin
      .from("stakes")
      .insert({ position: 1, region: "north", name_zh: "測試台北支聯會", name_en: "Test Taipei Stake" })
      .select("id")
      .single(),
  ).id;
  wardId = must(
    await admin
      .from("wards")
      .insert({ stake_id: stakeId, name_zh: "測試新店支會", name_en: "Test Xindian Ward" })
      .select("id")
      .single(),
  ).id;

  for (const [email, scope] of [
    ["head@example.com", { role: "admin" }],
    ["course@example.com", { role: "course_team", region: "north" }],
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
  // 刪掉年度大會時，它的場地、報名與寄信紀錄一起刪除。
  must(await admin.from("conferences").delete().eq("id", conferenceId));
  must(await admin.from("wards").delete().eq("stake_id", stakeId));
  must(await admin.from("stakes").delete().eq("id", stakeId));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

async function registered(overrides: Partial<RegistrationInput> = {}, locale: "zh" | "en" = "zh") {
  const input: RegistrationInput = {
    name: "王小美",
    phone: "0912345678",
    noPhone: false,
    email: "xiaomei@example.com",
    lineId: "",
    stakeId,
    wardId,
    venueId,
    courseIds: [courseId],
    lunchOptionId: null,
    afternoonActivityId: null,
    choirPart: null,
    services: [],
    printedHandbook: true,
    portraitConsent: true,
    ...overrides,
  };
  const result = await submitRegistration(anonClient(), input, locale);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.registration;
}

/** 不實際寄信：記下要寄的信，回傳指定的結果。 */
function fakeSender(result: Awaited<ReturnType<SendEmail>> = { ok: true, id: "resend-1" }) {
  const sent: EmailMessage[] = [];
  const send: SendEmail = async (message) => {
    sent.push(message);
    return result;
  };
  return { sent, send };
}

describe("寄信紀錄", () => {
  it("總管理員看得到一筆報名的所有寄信紀錄：類型、時間、成功或失敗，最新的在最前面", async () => {
    const registration = await registered();
    await sendConfirmationEmail(serverClient(), registration.id, "registered", fakeSender().send);
    await sendConfirmationEmail(
      serverClient(),
      registration.id,
      "updated",
      fakeSender({ ok: false, error: "422 invalid address" }).send,
    );

    const logs = await getEmailLogs(await signedInClient("head@example.com"), registration.id);

    expect(logs).toMatchObject([
      { kind: "updated", status: "failed", error: "422 invalid address", recipient: "xiaomei@example.com" },
      { kind: "registered", status: "sent", error: null, recipient: "xiaomei@example.com" },
    ]);
    expect(Date.parse(logs[0].createdAt)).toBeGreaterThanOrEqual(Date.parse(logs[1].createdAt));
  });

  it("換了目前年度之後，總管理員仍看得到舊年度報名的寄信紀錄", async () => {
    const registration = await registered();
    await sendConfirmationEmail(serverClient(), registration.id, "registered", fakeSender().send);
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId));

    expect(await getEmailLogs(await signedInClient("head@example.com"), registration.id)).toMatchObject([
      { kind: "registered", status: "sent" },
    ]);
  });

  it("沒寄過信的報名沒有寄信紀錄", async () => {
    const registration = await registered({ email: "" });
    expect(await getEmailLogs(await signedInClient("head@example.com"), registration.id)).toEqual([]);
  });

  it.each(["course@example.com", "everywhere@example.com"])("%s 不是總管理員，讀不到寄信紀錄", async (email) => {
    const registration = await registered();
    await sendConfirmationEmail(serverClient(), registration.id, "registered", fakeSender().send);

    expect(await getEmailLogs(await signedInClient(email), registration.id)).toEqual([]);
  });

  it("訪客讀不到寄信紀錄", async () => {
    const registration = await registered();
    await sendConfirmationEmail(serverClient(), registration.id, "registered", fakeSender().send);

    const { data } = await anonClient().from("email_logs").select("*").eq("registration_id", registration.id);
    expect(data ?? []).toEqual([]);
  });
});

describe("重寄確認信", () => {
  it("總管理員重寄：寄出目前內容的確認信，用報名語言，新增一筆重寄的寄信紀錄", async () => {
    const registration = await registered({}, "en");
    const { sent, send } = fakeSender();

    const result = await resendConfirmationEmail(
      await signedInClient("head@example.com"),
      serverClient(),
      registration.id,
      send,
    );

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("xiaomei@example.com");
    expect(sent[0].text).toContain("Family history");
    expect(sent[0].subject).toContain("Taiwan Women's Conference");
    const logs = await getEmailLogs(await signedInClient("head@example.com"), registration.id);
    expect(logs).toMatchObject([{ kind: "resent", status: "sent" }]);
  });

  it("重寄的是目前的 Email：報名後改了 Email，寄到新的地址", async () => {
    const registration = await registered();
    must(await admin.from("registrations").update({ email: "new@example.com" }).eq("id", registration.id));
    const { sent, send } = fakeSender();

    await resendConfirmationEmail(await signedInClient("head@example.com"), serverClient(), registration.id, send);

    expect(sent.map((message) => message.to)).toEqual(["new@example.com"]);
  });

  it("可以重寄好幾次，每次各記一筆", async () => {
    const registration = await registered();
    const staff = await signedInClient("head@example.com");
    await resendConfirmationEmail(staff, serverClient(), registration.id, fakeSender().send);
    await resendConfirmationEmail(staff, serverClient(), registration.id, fakeSender().send);

    expect(await getEmailLogs(staff, registration.id)).toMatchObject([{ kind: "resent" }, { kind: "resent" }]);
  });

  it("寄信失敗時回傳失敗，寄信紀錄記下失敗", async () => {
    const registration = await registered();
    const staff = await signedInClient("head@example.com");

    const result = await resendConfirmationEmail(
      staff,
      serverClient(),
      registration.id,
      fakeSender({ ok: false, error: "500 server error" }).send,
    );

    expect(result).toEqual({ ok: false, error: "failed" });
    expect(await getEmailLogs(staff, registration.id)).toMatchObject([{ kind: "resent", status: "failed" }]);
  });

  it("Email 是空的不寄，回傳沒有 Email，也沒有寄信紀錄", async () => {
    const registration = await registered({ email: "" });
    const { sent, send } = fakeSender();
    const staff = await signedInClient("head@example.com");

    const result = await resendConfirmationEmail(staff, serverClient(), registration.id, send);

    expect(result).toEqual({ ok: false, error: "noEmail" });
    expect(sent).toEqual([]);
    expect(await getEmailLogs(staff, registration.id)).toEqual([]);
  });

  it("已取消的報名不重寄", async () => {
    const registration = await registered();
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", registration.id),
    );
    const { sent, send } = fakeSender();

    const result = await resendConfirmationEmail(
      await signedInClient("head@example.com"),
      serverClient(),
      registration.id,
      send,
    );

    expect(result).toEqual({ ok: false, error: "cancelled" });
    expect(sent).toEqual([]);
  });

  it.each(["course@example.com", "everywhere@example.com"])("%s 不是總管理員，不能重寄", async (email) => {
    const registration = await registered();
    const { sent, send } = fakeSender();

    const result = await resendConfirmationEmail(await signedInClient(email), serverClient(), registration.id, send);

    expect(result).toEqual({ ok: false, error: "notAllowed" });
    expect(sent).toEqual([]);
    expect(must(await admin.from("email_logs").select("id").eq("registration_id", registration.id))).toEqual([]);
  });

  it("訪客不能重寄", async () => {
    const registration = await registered();
    const { sent, send } = fakeSender();

    const result = await resendConfirmationEmail(anonClient(), serverClient(), registration.id, send);

    expect(result).toEqual({ ok: false, error: "notAllowed" });
    expect(sent).toEqual([]);
  });

  it("不是目前年度的報名、或找不到的報名不重寄", async () => {
    const registration = await registered();
    const staff = await signedInClient("head@example.com");
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId));
    const { sent, send } = fakeSender();

    expect(await resendConfirmationEmail(staff, serverClient(), registration.id, send)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(await resendConfirmationEmail(staff, serverClient(), "not-a-uuid", send)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(sent).toEqual([]);
  });
});
