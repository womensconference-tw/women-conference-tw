import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { getRegistrationOptions, searchWards, type StakeOption } from "./registration-options";

const admin = adminClient();
let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let stakeIds: string[] = [];

beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));
  conferenceId = must(
    await admin
      .from("conferences")
      .insert({
        year: 2099,
        conference_date: "2099-05-15",
        announce_at: "2099-03-01T09:00:00+08:00",
        registration_opens_at: "2099-04-01T09:00:00+08:00",
        registration_closes_at: "2099-05-01T00:00:00+08:00",
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
});

afterEach(async () => {
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

async function addStake(stake: { position: number; name_zh: string; name_en?: string; is_active?: boolean }) {
  const { id } = must(await admin.from("stakes").insert({ region: "north", ...stake }).select("id").single());
  stakeIds.push(id);
  return id;
}

async function addWard(ward: {
  stake_id: string;
  position: number;
  name_zh: string;
  name_en?: string;
  is_active?: boolean;
}) {
  must(await admin.from("wards").insert(ward));
}

/** 不經過報名服務，直接佔一個課程名額。 */
async function takeSeat(venueId: string, sessionId: string, courseId: string) {
  const stake = await addStake({ position: 99, name_zh: "測試佔位支聯會" });
  const ward = must(
    await admin.from("wards").insert({ stake_id: stake, name_zh: "測試佔位支會" }).select("id").single(),
  );
  const registration = must(
    await admin
      .from("registrations")
      .insert({
        conference_id: conferenceId,
        venue_id: venueId,
        stake_id: stake,
        ward_id: ward.id,
        name: "佔位",
        phone: "0912345678",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      })
      .select("id")
      .single(),
  );
  must(
    await admin.from("registration_courses").insert({
      registration_id: registration.id,
      venue_id: venueId,
      session_id: sessionId,
      course_id: courseId,
    }),
  );
}

/** 不經過報名服務，直接佔一份午餐。 */
async function takeLunch(venueId: string, lunchId: string) {
  const stake = await addStake({ position: 99, name_zh: "測試佔位支聯會" });
  const ward = must(
    await admin.from("wards").insert({ stake_id: stake, name_zh: "測試佔位支會" }).select("id").single(),
  );
  must(
    await admin.from("registrations").insert({
      conference_id: conferenceId,
      venue_id: venueId,
      stake_id: stake,
      ward_id: ward.id,
      name: "佔位",
      phone: "0912345678",
      portrait_consented_at: new Date().toISOString(),
      locale: "zh",
      lunch_option_id: lunchId,
    }),
  );
}

/** 只看測試建立的支聯會，不受 seed 資料影響。 */
function fixtureStakes(stakes: StakeOption[]) {
  return stakes
    .filter((stake) => stakeIds.includes(stake.id))
    .map((stake) => ({ name: stake.name, wards: stake.wards.map((ward) => ward.name) }));
}

describe("報名表的選項", () => {
  it("列出目前年度的場地，依排序", async () => {
    must(
      await admin.from("venues").insert([
        { region: "north", conference_id: conferenceId, position: 2, name_zh: "高雄鳥松教堂", name_en: "" },
        { region: "north", conference_id: conferenceId, position: 1, name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" },
      ]),
    );

    const options = await getRegistrationOptions(anonClient(), "en");

    expect(options.venues.map((venue) => venue.name)).toEqual(["Taipei Jinhua Chapel", "高雄鳥松教堂"]);
  });

  it("每個場地帶著自己的場次與課程，依排序，標出已額滿", async () => {
    const [jinhua, daya] = must(
      await admin
        .from("venues")
        .insert([
          { region: "north", conference_id: conferenceId, position: 1, name_zh: "台北金華教堂" },
          { region: "north", conference_id: conferenceId, position: 2, name_zh: "台中大雅教堂" },
        ])
        .select("id, position")
        .order("position"),
    );
    const [second, first, dayaSession] = must(
      await admin
        .from("sessions")
        .insert([
          { conference_id: conferenceId, venue_id: jinhua.id, position: 2, name_zh: "第二場", name_en: "Session 2" },
          { conference_id: conferenceId, venue_id: jinhua.id, position: 1, name_zh: "第一場", name_en: "" },
          { conference_id: conferenceId, venue_id: daya.id, position: 1, name_zh: "大雅第一場" },
          // 還沒開課的場次不列出。
          { conference_id: conferenceId, venue_id: daya.id, position: 2, name_zh: "大雅第二場" },
        ], { defaultToNull: false })
        .select("id"),
    );
    const [full, , unlimited] = must(
      await admin
        .from("courses")
        .insert([
          { conference_id: conferenceId, session_id: first.id, position: 1, title_zh: "家譜", title_en: "Family history", capacity: 1 },
          { conference_id: conferenceId, session_id: first.id, position: 2, title_zh: "音樂", description_zh: "王老師", capacity: 20 },
          { conference_id: conferenceId, session_id: second.id, position: 1, title_zh: "烹飪", capacity: null },
          { conference_id: conferenceId, session_id: dayaSession.id, position: 1, title_zh: "插花", capacity: 5 },
        ], { defaultToNull: false })
        .select("id"),
    );
    await takeSeat(jinhua.id, first.id, full.id);
    await takeSeat(jinhua.id, second.id, unlimited.id);

    const options = await getRegistrationOptions(anonClient(), "en");

    expect(options.venues.map((venue) => venue.sessions)).toEqual([
      [
        {
          id: first.id,
          name: "第一場",
          courses: [
            { id: full.id, name: "Family history", description: "", isFull: true, pairedWith: null },
            { id: expect.any(String), name: "音樂", description: "王老師", isFull: false, pairedWith: null },
          ],
        },
        {
          id: second.id,
          name: "Session 2",
          courses: [{ id: unlimited.id, name: "烹飪", description: "", isFull: false, pairedWith: null }],
        },
      ],
      [
        {
          id: dayaSession.id,
          name: "大雅第一場",
          courses: [{ id: expect.any(String), name: "插花", description: "", isFull: false, pairedWith: null }],
        },
      ],
    ]);
  });

  it("成對課程帶著另一堂的場次與課程，其中一堂額滿時兩堂都標出已額滿", async () => {
    const venue = must(
      await admin.from("venues").insert({ region: "north", conference_id: conferenceId, name_zh: "台北金華教堂" }).select("id").single(),
    );
    const [first, second] = must(
      await admin
        .from("sessions")
        .insert([
          { conference_id: conferenceId, venue_id: venue.id, position: 1, name_zh: "第一場" },
          { conference_id: conferenceId, venue_id: venue.id, position: 2, name_zh: "第二場" },
        ])
        .select("id, position")
        .order("position"),
    );
    const course = async (sessionId: string, title_zh: string, capacity: number) =>
      must(
        await admin
          .from("courses")
          .insert({ conference_id: conferenceId, session_id: sessionId, title_zh, capacity })
          .select("id")
          .single(),
      );
    const upper = await course(first.id, "手冊研習（上）", 1);
    const lower = await course(second.id, "手冊研習（下）", 30);
    must(
      await admin
        .from("course_pairs")
        .insert({ conference_id: conferenceId, first_course_id: upper.id, second_course_id: lower.id }),
    );
    await takeSeat(venue.id, first.id, upper.id);

    const options = await getRegistrationOptions(anonClient(), "zh");

    expect(options.venues[0].sessions.map((session) => session.courses)).toEqual([
      [expect.objectContaining({ id: upper.id, isFull: true, pairedWith: { sessionId: second.id, courseId: lower.id } })],
      [expect.objectContaining({ id: lower.id, isFull: true, pairedWith: { sessionId: first.id, courseId: upper.id } })],
    ]);
  });

  it("每個場地帶著自己的午餐，依排序，標出已額滿", async () => {
    const [jinhua, daya] = must(
      await admin
        .from("venues")
        .insert([
          { region: "north", conference_id: conferenceId, position: 1, name_zh: "台北金華教堂" },
          { region: "north", conference_id: conferenceId, position: 2, name_zh: "台中大雅教堂" },
        ])
        .select("id, position")
        .order("position"),
    );
    const [vegetarian, meat, dayaLunch] = must(
      await admin
        .from("lunch_options")
        .insert([
          { conference_id: conferenceId, venue_id: jinhua.id, position: 2, name_zh: "素食便當", name_en: "Vegetarian", capacity: 1 },
          { conference_id: conferenceId, venue_id: jinhua.id, position: 1, name_zh: "葷食便當", description_zh: "附飲料", capacity: null },
          { conference_id: conferenceId, venue_id: daya.id, position: 1, name_zh: "大雅便當", capacity: 1 },
        ], { defaultToNull: false })
        .select("id"),
    );
    await takeLunch(jinhua.id, vegetarian.id);

    const options = await getRegistrationOptions(anonClient(), "en");

    expect(options.venues.map(({ lunchOptions }) => ({ lunchOptions }))).toEqual([
      {
        lunchOptions: [
          { id: meat.id, name: "葷食便當", description: "附飲料", isFull: false },
          { id: vegetarian.id, name: "Vegetarian", description: "", isFull: true },
        ],
      },
      // A 場地的午餐額滿不影響 B 場地。
      { lunchOptions: [{ id: dayaLunch.id, name: "大雅便當", description: "", isFull: false }] },
    ]);
  });

  it("支聯會依排序列出，各自帶著自己的支會", async () => {
    const taichung = await addStake({ position: 2, name_zh: "測試台中支聯會" });
    const taipei = await addStake({ position: 1, name_zh: "測試台北支聯會" });
    await addWard({ stake_id: taipei, position: 2, name_zh: "測試景美支會" });
    await addWard({ stake_id: taipei, position: 1, name_zh: "測試新店支會" });
    await addWard({ stake_id: taichung, position: 1, name_zh: "測試大雅支會" });

    const options = await getRegistrationOptions(anonClient(), "zh");

    expect(fixtureStakes(options.stakes)).toEqual([
      { name: "測試台北支聯會", wards: ["測試新店支會", "測試景美支會"] },
      { name: "測試台中支聯會", wards: ["測試大雅支會"] },
    ]);
  });

  it("停用的支聯會、支會，以及沒有支會可選的支聯會不出現", async () => {
    const active = await addStake({ position: 1, name_zh: "測試台北支聯會" });
    const retired = await addStake({ position: 2, name_zh: "測試舊支聯會", is_active: false });
    await addWard({ stake_id: active, position: 1, name_zh: "測試新店支會" });
    await addWard({ stake_id: active, position: 2, name_zh: "測試舊支會", is_active: false });
    await addWard({ stake_id: retired, position: 1, name_zh: "測試舊支聯會的支會" });
    const emptied = await addStake({ position: 3, name_zh: "測試支會全停用的支聯會" });
    await addWard({ stake_id: emptied, position: 1, name_zh: "測試停用支會", is_active: false });

    const options = await getRegistrationOptions(anonClient(), "zh");

    expect(fixtureStakes(options.stakes)).toEqual([
      { name: "測試台北支聯會", wards: ["測試新店支會"] },
    ]);
  });

  // 工作人員讀得到停用的單位（後台名單要顯示舊報名的支聯會與支會），但登入著打開報名表時也不能列出來。
  it("工作人員登入著打開報名表，也不會出現停用的支聯會、支會", async () => {
    const active = await addStake({ position: 1, name_zh: "測試台北支聯會" });
    const retired = await addStake({ position: 2, name_zh: "測試舊支聯會", is_active: false });
    await addWard({ stake_id: active, position: 1, name_zh: "測試新店支會" });
    await addWard({ stake_id: active, position: 2, name_zh: "測試舊支會", is_active: false });
    await addWard({ stake_id: retired, position: 1, name_zh: "測試舊支聯會的支會" });
    const userIds: string[] = [];
    try {
      for (const [email, scope] of [
        ["head@example.com", { role: "admin" }],
        ["report@example.com", { role: "registration_team", region: "north" }],
      ] as const) {
        const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
        userIds.push(user.id);
        must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));

        const options = await getRegistrationOptions(await signedInClient(email), "zh");

        expect(fixtureStakes(options.stakes)).toEqual([{ name: "測試台北支聯會", wards: ["測試新店支會"] }]);
      }
    } finally {
      must(await admin.from("staff_members").delete().in("user_id", userIds));
      for (const id of userIds) must(await admin.auth.admin.deleteUser(id));
    }
  });

  // 不經過支聯會，直接查支會資料表也一樣。
  it("直接查支會時，停用的支聯會底下的支會也查不到", async () => {
    const retired = await addStake({ position: 1, name_zh: "測試舊支聯會", is_active: false });
    await addWard({ stake_id: retired, position: 1, name_zh: "測試舊支聯會的支會" });

    const { data } = await anonClient().from("wards").select("id").eq("stake_id", retired);

    expect(data ?? []).toEqual([]);
  });
});

describe("不知道支聯會，直接找支會", () => {
  const stakes: StakeOption[] = [
    {
      id: "taipei",
      name: "台北支聯會",
      wards: [
        { id: "xindian", name: "新店支會", nameZh: "新店支會", nameEn: "Xindian Ward" },
        { id: "jingmei", name: "景美支會", nameZh: "景美支會", nameEn: "Jingmei Ward" },
      ],
    },
    {
      id: "taichung",
      name: "台中支聯會",
      wards: [{ id: "daya", name: "大雅支會", nameZh: "大雅支會", nameEn: "Daya Ward" }],
    },
  ];

  it("輸入部分中文名稱，列出符合的支會與所屬支聯會", () => {
    expect(searchWards(stakes, "新店")).toEqual([
      { stakeId: "taipei", stakeName: "台北支聯會", wardId: "xindian", wardName: "新店支會" },
    ]);
  });

  it("英文名稱不分大小寫也能找到", () => {
    expect(searchWards(stakes, " daya ").map((match) => match.wardId)).toEqual(["daya"]);
  });

  it("符合多個時全部列出", () => {
    expect(searchWards(stakes, "ward").map((match) => match.wardId)).toEqual([
      "xindian",
      "jingmei",
      "daya",
    ]);
  });

  it("沒輸入時不列出", () => {
    expect(searchWards(stakes, "  ")).toEqual([]);
  });
});
