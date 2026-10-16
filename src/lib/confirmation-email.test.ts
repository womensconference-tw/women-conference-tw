import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminClient, anonClient, databaseClient, must, serverClient } from "../../test/supabase";
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
let sessionId: string;
let courseId: string;
let otherCourseId: string;

// 每個測試都有一個報名中的 2099 年度大會：一個場地、一個場次兩門課、一個支聯會一個支會。
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
  sessionId = must(
    await admin
      .from("sessions")
      .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: "第一場 10:00", name_en: "Session 1, 10:00" })
      .select("id")
      .single(),
  ).id;
  courseId = must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: sessionId, position: 1, title_zh: "家譜入門", title_en: "Family history basics" })
      .select("id")
      .single(),
  ).id;
  otherCourseId = must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: sessionId, position: 2, title_zh: "插花", title_en: "Flower arranging" })
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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

      // 伺服器日誌清除個資時清不到，所以也不能有收件地址或姓名。
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("xiaomei@example.com");
      expect(logged).not.toContain("王小美");
    } finally {
      consoleError.mockRestore();
    }
    const [log] = await emailLogs(registration.id);
    expect(log).toMatchObject({ status: "failed", error: null, recipient: null });
    expect(log.finished_at).not.toBeNull();
  });

  it("開始寄信前就出錯時，伺服器日誌也不記錯誤內容", async () => {
    const failing = {
      rpc: () => ({
        abortSignal: async () => ({
          data: null,
          error: { code: "XX000", message: "xiaomei@example.com 王小美", details: "xiaomei@example.com" },
        }),
      }),
    } as unknown as SupabaseClient;
    const { sent, send } = fakeSender();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await sendConfirmationEmail(failing, "00000000-0000-0000-0000-000000000000", "registered", send)).toBe(
        "failed",
      );

      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("xiaomei@example.com");
      expect(logged).not.toContain("王小美");
      expect(logged).toContain("XX000");
    } finally {
      consoleError.mockRestore();
    }
    expect(sent).toEqual([]);
  });

  it("寫回寄送結果暫時失敗時重試，不重寄信", async () => {
    const registration = await registered();
    const server = serverClient();
    let finishCalls = 0;
    // 第一次寫回時資料庫暫時沒回應，之後正常。
    const flaky = {
      rpc: (name: string, args: object) => {
        if (name === "finish_email_log" && finishCalls++ === 0) {
          return { abortSignal: async () => ({ data: null, error: { message: "503 Service Unavailable" } }) };
        }
        return server.rpc(name, args);
      },
    } as unknown as SupabaseClient;
    const { sent, send } = fakeSender();

    expect(await sendConfirmationEmail(flaky, registration.id, "registered", send)).toBe("sent");

    expect(sent).toHaveLength(1);
    expect(finishCalls).toBe(2);
    expect(await emailLogs(registration.id)).toMatchObject([{ status: "sent" }]);
  });

  it("寄信時已經不是目前年度，信裡仍有她報名的場地與課程", async () => {
    const registration = await registered();
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceId!));
    const { sent, send } = fakeSender();

    await sendConfirmationEmail(serverClient(), registration.id, "registered", send);

    expect(sent[0].html).toContain("台北金華教堂");
    expect(sent[0].html).toContain("家譜入門");
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

/**
 * 用另一條資料庫連線開一個交易，做完 hold 後先不提交；接著執行 run，
 * 等到 run 呼叫的資料庫函式（functionName）確實被這個交易擋住，才提交交易，回傳 run 的結果。
 */
async function whileHolding<T>(
  hold: (tx: TransactionSql) => Promise<unknown>,
  run: () => Promise<T>,
  functionName: string,
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
    const holderPid = await Promise.race([
      holding,
      transaction.then(() => {
        throw new Error("交易結束了卻沒有進入等待狀態");
      }),
    ]);
    const running = run();
    for (let waited = 0; ; waited += 50) {
      const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity
          where ${holderPid}::int = any(pg_blocking_pids(pid)) and query like ${`%${functionName}%`}
        ) as blocked`;
      if (blocked) break;
      if (waited > 3000) throw new Error(`${functionName} 沒有等那個交易的鎖：可能沒有上鎖`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    release();
    await transaction;
    return await running;
  } finally {
    release();
    await transaction.catch(() => {});
    await Promise.all([sql.end(), watcher.end()]);
  }
}

describe("同時進行的修改、取消與清除個資", () => {
  it("修改還沒提交時開始寄信，信裡是修改後的資料與課程，不會一半新一半舊", async () => {
    const registration = await registered();
    const { sent, send } = fakeSender();

    await whileHolding(
      async (tx) => {
        await tx`update public.registrations set line_id = 'new-line-id' where id = ${registration.id}`;
        await tx`delete from public.registration_courses where registration_id = ${registration.id}`;
        await tx`
          insert into public.registration_courses (registration_id, venue_id, session_id, course_id)
          values (${registration.id}, ${venueId}, ${sessionId}, ${otherCourseId})`;
      },
      () => sendConfirmationEmail(serverClient(), registration.id, "updated", send),
      "begin_confirmation_email",
    );

    expect(sent[0].html).toContain("new-line-id");
    expect(sent[0].html).toContain("插花");
    expect(sent[0].html).not.toContain("家譜入門");
  });

  it("同一筆的取消信同時開始寄兩次，只寄一封", async () => {
    const registration = await registered();
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", registration.id),
    );
    const { sent, send } = fakeSender();

    // 另一個寄取消信的工作已經寫下紀錄、還沒提交。
    const result = await whileHolding(
      (tx) => tx`
        insert into public.email_logs (registration_id, kind, recipient)
        values (${registration.id}, 'cancelled', 'xiaomei@example.com')`,
      () => sendConfirmationEmail(serverClient(), registration.id, "cancelled", send),
      "begin_confirmation_email",
    );

    expect(result).toBe("skipped");
    expect(sent).toEqual([]);
    expect(await emailLogs(registration.id)).toHaveLength(1);
  });

  // 清除個資（#26）在同一個交易裡清掉報名的 Email、寄信紀錄的收件地址，並記下清除時間。
  function clearPersonalData(registrationId: string) {
    return async (tx: TransactionSql) => {
      await tx`update public.registrations set email = null where id = ${registrationId}`;
      await tx`update public.email_logs set recipient = null, error = null where registration_id = ${registrationId}`;
      await tx`update public.conferences set personal_data_cleared_at = now() where id = ${conferenceId!}`;
    };
  }

  it("清除個資先拿到鎖時，開始寄信等它完成，之後就不寄", async () => {
    const registration = await registered();
    const { sent, send } = fakeSender();

    const result = await whileHolding(
      clearPersonalData(registration.id),
      () => sendConfirmationEmail(serverClient(), registration.id, "registered", send),
      "begin_confirmation_email",
    );

    expect(result).toBe("skipped");
    expect(sent).toEqual([]);
    expect(await emailLogs(registration.id)).toEqual([]);
  });

  it("寄信已開始、清除個資先拿到寄信紀錄的鎖時，寫回結果等它完成，只記下寄送結果", async () => {
    const registration = await registered();
    const begun = must(
      await serverClient().rpc("begin_confirmation_email", {
        p_registration_id: registration.id,
        p_kind: "registered",
      }),
    ) as { log_id: string };

    await whileHolding(
      clearPersonalData(registration.id),
      async () =>
        must(
          await serverClient().rpc("finish_email_log", {
            p_log_id: begun.log_id,
            p_sent: false,
            p_error: "invalid recipient xiaomei@example.com",
            p_provider_message_id: null,
          }),
        ),
      "finish_email_log",
    );

    expect(await emailLogs(registration.id)).toMatchObject([{ status: "failed", error: null, recipient: null }]);
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
