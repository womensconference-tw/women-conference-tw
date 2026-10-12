import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must } from "../../test/supabase";
import { isRegistrationNumber, submitRegistration, type RegistrationInput } from "./registration";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
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
        registration_opens_at: new Date(now - DAY).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  );
  conferenceId = conference.id;

  venueId = must(
    await admin
      .from("venues")
      .insert({ conference_id: conferenceId, name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" })
      .select("id")
      .single(),
  ).id;

  const [taipei, taichung] = must(
    await admin
      .from("stakes")
      .insert([
        { position: 1, name_zh: "測試台北支聯會", name_en: "Test Taipei Stake" },
        { position: 2, name_zh: "測試台中支聯會", name_en: "Test Taichung Stake" },
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
    portraitConsent: true,
    ...overrides,
  };
}

describe("送出報名", () => {
  it("資料齊全時報名成功，回傳存下的資料", async () => {
    const result = await submitRegistration(
      anonClient(),
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
      },
    });
  });

  // 代報人用自己的電話幫家人報名。
  it("同一支電話可以報 3 位", async () => {
    const supabase = anonClient();
    const results = [];
    for (const name of ["王媽媽", "王小美", "王小華"]) {
      results.push(await submitRegistration(supabase, validInput({ name })));
    }

    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
  });

  it("沒有電話的人拿到 6 碼報名編號", async () => {
    const result = await submitRegistration(
      anonClient(),
      validInput({ phone: "", noPhone: true }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registration.phone).toBeNull();
    expect(result.registration.registrationNumber).toMatch(/^[1-9]\d{5}$/);
    expect(isRegistrationNumber(result.registration.registrationNumber!)).toBe(true);
  });

  it("沒有同意肖像權不能送出", async () => {
    const result = await submitRegistration(anonClient(), validInput({ portraitConsent: false }));

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

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { form: "notOpen" } });
  });

  it("支會不屬於所選的支聯會時被拒絕", async () => {
    const result = await submitRegistration(anonClient(), validInput({ wardId: taichungWardId }));

    expect(result).toEqual({ ok: false, errors: { ward: "wardNotInStake" } });
  });

  // 教會重新劃分後，舊單位停用；報名表上已不顯示，送出時也不接受。
  it("停用的支會不能選", async () => {
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { ward: "wardNotInStake" } });
  });

  it("停用的支聯會不能選", async () => {
    must(await admin.from("stakes").update({ is_active: false }).eq("id", taipeiStakeId));

    const result = await submitRegistration(anonClient(), validInput());

    expect(result).toEqual({ ok: false, errors: { stake: "stakeRequired" } });
  });

  it("每個有問題的欄位各自標出錯誤", async () => {
    const result = await submitRegistration(
      anonClient(),
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
    const result = await submitRegistration(anonClient(), validInput({ phone }));

    expect(result.ok && result.registration.phone).toBe(saved);
  });

  it.each(["1234", "0912-ABC-678", "09123456789012345"])("電話 %s 格式不對", async (phone) => {
    const result = await submitRegistration(anonClient(), validInput({ phone }));

    expect(result).toEqual({ ok: false, errors: { phone: "phoneInvalid" } });
  });
});

describe("報名資料表", () => {
  it("匿名訪客無法直接讀取或列舉", async () => {
    const saved = await submitRegistration(anonClient(), validInput());
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
    });

    expect(error).not.toBeNull();
  });

  it("同時存下報名當下的支聯會與支會", async () => {
    const result = await submitRegistration(anonClient(), validInput());
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

