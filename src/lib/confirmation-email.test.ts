import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, serverClient } from "../../test/supabase";
import {
  createResendSender,
  sendConfirmationEmail,
  type EmailMessage,
  type SendEmail,
} from "./confirmation-email";
import type { Locale } from "./i18n/locale";
import { submitRegistration, type RegistrationInput } from "./registration";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let stakeId: string | undefined;
let venueId: string;
let wardId: string;
let courseId: string;

// 每個測試都有一個報名中的 2099 年度大會：一個場地、一個場次一門課、一個支聯會一個支會。
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
      .insert({ region: "north", conference_id: conferenceId, name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" })
      .select("id")
      .single(),
  ).id;
  const sessionId = must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: "第一場 10:00", name_en: "Session 1, 10:00" })
      .select("id")
      .single(),
  ).id;
  courseId = must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: sessionId, title_zh: "家譜入門", title_en: "Family history basics" })
      .select("id")
      .single(),
  ).id;
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
  // 場次與課程建好之後才開放報名。
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conferenceId),
  );
});

afterEach(async () => {
  // 刪掉年度大會時，它的場地、報名與寄信紀錄一起刪除。
  if (conferenceId) must(await admin.from("conferences").delete().eq("id", conferenceId));
  conferenceId = undefined;
  if (stakeId) {
    must(await admin.from("wards").delete().eq("stake_id", stakeId));
    must(await admin.from("stakes").delete().eq("id", stakeId));
  }
  stakeId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

async function registered(overrides: Partial<RegistrationInput> = {}, locale: Locale = "zh") {
  const result = await submitRegistration(
    anonClient(),
    {
      name: "王小美",
      phone: "0912345678",
      noPhone: false,
      email: "xiaomei@example.com",
      lineId: "",
      stakeId: stakeId!,
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
    },
    locale,
  );
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

async function emailLogs(registrationId: string) {
  return must(
    await admin
      .from("email_logs")
      .select("kind, recipient, status, error, provider_message_id, finished_at")
      .eq("registration_id", registrationId)
      .order("created_at"),
  );
}

describe("寄確認信", () => {
  it("報名完成後寄一封中文確認信到她的 Email，內容含完整報名資料，寄信紀錄記下已寄出", async () => {
    const registration = await registered();
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("xiaomei@example.com");
    expect(sent[0].subject).toContain("報名完成");
    for (const text of ["王小美", "0912345678", "測試新店支會", "台北金華教堂", "第一場 10:00", "家譜入門"]) {
      expect(sent[0].html).toContain(text);
      expect(sent[0].text).toContain(text);
    }
    const [log] = await emailLogs(registration.id);
    expect(log).toMatchObject({
      kind: "registered",
      recipient: "xiaomei@example.com",
      status: "sent",
      error: null,
      provider_message_id: "resend-1",
    });
    expect(log.finished_at).not.toBeNull();
  });

  it("用英文報名的，確認信是英文", async () => {
    const registration = await registered({}, "en");
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    expect(sent[0].subject).toContain("registered");
    expect(sent[0].html).toContain("Taipei Jinhua Chapel");
    expect(sent[0].html).toContain("Family history basics");
    expect(sent[0].html).not.toContain("台北金華教堂");
  });

  async function cancel(id: string) {
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id),
    );
  }

  it.each(["updated", "cancelled"] as const)("%s 也各寄一封，依報名時的語言", async (kind) => {
    const registration = await registered({}, "en");
    if (kind === "cancelled") await cancel(registration.id);
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, kind, send);

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(kind === "updated" ? "changed" : "cancelled");
    expect(sent[0].html).toContain("Family history basics");
    expect(await emailLogs(registration.id)).toMatchObject([{ kind, status: "sent" }]);
  });

  it("報名後馬上取消，晚一步寄的報名、修改信就不寄了", async () => {
    const registration = await registered();
    await cancel(registration.id);
    const { sent, send } = fakeSender();

    expect(await sendConfirmationEmail(serverClient(), registration.id, "registered", send)).toBe("skipped");
    expect(await sendConfirmationEmail(serverClient(), registration.id, "updated", send)).toBe("skipped");

    expect(sent).toEqual([]);
  });

  it("取消信只寄一次，已取消的再按取消不會再寄", async () => {
    const registration = await registered();
    await cancel(registration.id);
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "cancelled", send);
    expect(await sendConfirmationEmail(serverClient(), registration.id, "cancelled", send)).toBe("skipped");

    expect(sent).toHaveLength(1);
  });

  it("沒有電話的報名者，信裡有報名編號", async () => {
    const registration = await registered({ phone: "", noPhone: true });
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    expect(sent[0].html).toContain(registration.registrationNumber!);
    expect(sent[0].text).toContain(registration.registrationNumber!);
  });

  it("Email 是空的就不寄，不報錯，也沒有寄信紀錄", async () => {
    const registration = await registered({ email: "" });
    const { sent, send } = fakeSender();

    await expect(
      sendConfirmationEmail(serverClient(), registration.id, "registered", send),
    ).resolves.toBe("skipped");

    expect(sent).toEqual([]);
    expect(await emailLogs(registration.id)).toEqual([]);
  });

  it("寄信失敗時不丟出錯誤，寄信紀錄記下失敗與原因", async () => {
    const registration = await registered();
    const { send } = fakeSender({ ok: false, error: "rate limited" });

    await expect(
      sendConfirmationEmail(serverClient(), registration.id, "registered", send),
    ).resolves.toBe("failed");

    expect(await emailLogs(registration.id)).toMatchObject([
      { status: "failed", error: "rate limited", recipient: "xiaomei@example.com" },
    ]);
  });

  it("寄信服務丟出例外時，寄信紀錄也記下失敗", async () => {
    const registration = await registered();
    const send: SendEmail = async () => {
      throw new Error("network down");
    };

    await expect(
      sendConfirmationEmail(serverClient(), registration.id, "registered", send),
    ).resolves.toBe("failed");

    expect(await emailLogs(registration.id)).toMatchObject([{ status: "failed", error: "network down" }]);
  });

  // ADR 0008：清除前已開始、清除後才結束的寄信，寫回時只更新寄送結果。
  it("寄信期間該年度清除了個資時，只記下失敗，不寫入含個資的錯誤回應與收件地址", async () => {
    const registration = await registered();
    const send: SendEmail = async (message) => {
      // 模擬清除個資（#26）：在信寄出、結果還沒寫回之前完成。
      must(await admin.from("registrations").update({ email: null }).eq("id", registration.id));
      must(await admin.from("email_logs").update({ recipient: null }).eq("registration_id", registration.id));
      must(
        await admin
          .from("conferences")
          .update({ personal_data_cleared_at: new Date().toISOString() })
          .eq("id", conferenceId!),
      );
      return { ok: false, error: `invalid recipient ${message.to} (王小美)` };
    };

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    const [log] = await emailLogs(registration.id);
    expect(log).toMatchObject({ status: "failed", error: null, recipient: null });
    expect(log.finished_at).not.toBeNull();
  });

  it("已清除個資的年度不再寄信", async () => {
    const registration = await registered();
    must(
      await admin
        .from("conferences")
        .update({ personal_data_cleared_at: new Date().toISOString() })
        .eq("id", conferenceId!),
    );
    const { sent, send } = fakeSender();

    await expect(
      sendConfirmationEmail(serverClient(), registration.id, "registered", send),
    ).resolves.toBe("skipped");

    expect(sent).toEqual([]);
  });

  it("姓名裡的 HTML 會被跳脫，不會變成信裡的標籤", async () => {
    const registration = await registered({ name: '<a href="https://evil.example">點我</a>' });
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    expect(sent[0].html).not.toContain('<a href="https://evil.example">');
    expect(sent[0].html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;");
  });
});

describe("寄信紀錄的權限", () => {
  it("訪客讀不到寄信紀錄，也不能呼叫寄信用的資料庫函式", async () => {
    const registration = await registered();
    await sendConfirmationEmail(serverClient(), registration.id, "registered", fakeSender().send);

    const { data } = await anonClient().from("email_logs").select("*");
    expect(data ?? []).toEqual([]);
    const begin = await anonClient().rpc("begin_confirmation_email", {
      p_registration_id: registration.id,
      p_kind: "registered",
    });
    expect(begin.error).not.toBeNull();
    const finish = await anonClient().rpc("finish_email_log", {
      p_log_id: registration.id,
      p_sent: true,
      p_error: null,
      p_provider_message_id: null,
    });
    expect(finish.error).not.toBeNull();
  });
});

describe("Resend 寄信", () => {
  const message: EmailMessage = { to: "xiaomei@example.com", subject: "主旨", html: "<p>內容</p>", text: "內容" };

  it("用環境變數的 API key 與寄件人呼叫 Resend，回傳信件編號", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = createResendSender(
      { RESEND_API_KEY: "re_test", EMAIL_FROM: "台灣姐妹大會 <noreply@example.org>" },
      async (url, init) => {
        calls.push({ url: String(url), init: init! });
        return new Response(JSON.stringify({ id: "abc" }), { status: 200 });
      },
    );

    expect(await send(message)).toEqual({ ok: true, id: "abc" });
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer re_test");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      from: "台灣姐妹大會 <noreply@example.org>",
      to: ["xiaomei@example.com"],
      subject: "主旨",
      html: "<p>內容</p>",
      text: "內容",
    });
  });

  it("Resend 回應錯誤時回傳失敗與狀態", async () => {
    const send = createResendSender(
      { RESEND_API_KEY: "re_test", EMAIL_FROM: "noreply@example.org" },
      async () => new Response(JSON.stringify({ message: "Too many requests" }), { status: 429 }),
    );

    expect(await send(message)).toEqual({ ok: false, error: "429 Too many requests" });
  });

  it("沒有設定 API key 或寄件人時不呼叫 Resend，回傳失敗", async () => {
    let called = false;
    const send = createResendSender({}, async () => {
      called = true;
      return new Response("{}");
    });

    expect(await send(message)).toEqual({ ok: false, error: "RESEND_API_KEY or EMAIL_FROM not set" });
    expect(called).toBe(false);
  });
});
