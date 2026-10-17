import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, must, signedInClient } from "../../test/supabase";
import { getStatistics, venuesInView, type Statistics } from "./statistics";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string;
let stakeIds: string[] = [];
let jinhuaId: string;
let dayaId: string;
let taipeiStakeId: string;
let taichungStakeId: string;
let xindianWardId: string;
let banqiaoWardId: string;
let dayaWardId: string;
let morningId: string;
let dayaMorningId: string;
let quiltingId: string;
let singingId: string;
let dayaCourseId: string;
let bentoId: string;
let veganId: string;
let dayaLunchId: string;
let walkId: string;

/*
 * 每個測試都有一個報名中的 2099 年度大會：
 * - 北區金華：上午場次有拼布（容量 40）、唱歌（不限人數）兩門課；午餐便當（限量 30）、素食（不限）；午后動態散步。
 * - 中區大雅：上午場次一門課（容量 20）、一種午餐。
 * 支聯會北區台北（新店、板橋支會）、中區台中（大雅支會），以及總管理員、北區課務組、北區報報組、全區報報組。
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

  [jinhuaId, dayaId] = must(
    await admin
      .from("venues")
      .insert([
        { region: "north", conference_id: conferenceId, position: 1, name_zh: "測試金華教堂" },
        { region: "central", conference_id: conferenceId, position: 2, name_zh: "測試大雅教堂" },
      ])
      .select("id, position")
      .order("position"),
  ).map((venue) => venue.id);

  const addSession = async (venueId: string, name: string) =>
    must(
      await admin
        .from("sessions")
        .insert({ conference_id: conferenceId, venue_id: venueId, position: 1, name_zh: name })
        .select("id")
        .single(),
    ).id;
  morningId = await addSession(jinhuaId, "上午");
  dayaMorningId = await addSession(dayaId, "大雅上午");

  [quiltingId, singingId] = must(
    await admin
      .from("courses")
      .insert([
        { conference_id: conferenceId, session_id: morningId, position: 1, title_zh: "拼布", capacity: 40 },
        { conference_id: conferenceId, session_id: morningId, position: 2, title_zh: "唱歌", capacity: null },
      ])
      .select("id, position")
      .order("position"),
  ).map((course) => course.id);
  dayaCourseId = must(
    await admin
      .from("courses")
      .insert({ conference_id: conferenceId, session_id: dayaMorningId, position: 1, title_zh: "插花", capacity: 20 })
      .select("id")
      .single(),
  ).id;

  [bentoId, veganId] = must(
    await admin
      .from("lunch_options")
      .insert([
        { conference_id: conferenceId, venue_id: jinhuaId, position: 1, name_zh: "便當", capacity: 30 },
        { conference_id: conferenceId, venue_id: jinhuaId, position: 2, name_zh: "素食", capacity: null },
      ])
      .select("id, position")
      .order("position"),
  ).map((lunch) => lunch.id);
  dayaLunchId = must(
    await admin
      .from("lunch_options")
      .insert({ conference_id: conferenceId, venue_id: dayaId, position: 1, name_zh: "大雅便當" })
      .select("id")
      .single(),
  ).id;
  walkId = must(
    await admin
      .from("afternoon_activities")
      .insert({ conference_id: conferenceId, venue_id: jinhuaId, position: 1, title_zh: "散步", capacity: 10 })
      .select("id")
      .single(),
  ).id;

  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conferenceId),
  );

  [taipeiStakeId, taichungStakeId] = must(
    await admin
      .from("stakes")
      .insert([
        { position: 1, region: "north", name_zh: "測試台北支聯會" },
        { position: 2, region: "central", name_zh: "測試台中支聯會" },
      ])
      .select("id, position")
      .order("position"),
  ).map((stake) => stake.id);
  stakeIds = [taipeiStakeId, taichungStakeId];

  [xindianWardId, banqiaoWardId] = must(
    await admin
      .from("wards")
      .insert([
        { stake_id: taipeiStakeId, position: 1, name_zh: "測試新店支會" },
        { stake_id: taipeiStakeId, position: 2, name_zh: "測試板橋支會" },
      ])
      .select("id, position")
      .order("position"),
  ).map((ward) => ward.id);
  dayaWardId = must(
    await admin.from("wards").insert({ stake_id: taichungStakeId, name_zh: "測試大雅支會" }).select("id").single(),
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

type Seed = {
  venue: "jinhua" | "daya";
  ward: "xindian" | "banqiao" | "daya";
  course?: "quilting" | "singing" | "daya";
  lunch?: "bento" | "vegan" | "daya";
  walk?: boolean;
  choir?: "soprano" | "alto";
  services?: string[];
  handbook?: boolean;
  cancelled?: boolean;
};

let seeded = 0;

/** 直接寫入一筆報名（略過報名服務）。 */
async function seed(registration: Seed) {
  seeded += 1;
  const venueId = registration.venue === "jinhua" ? jinhuaId : dayaId;
  const { id } = must(
    await admin
      .from("registrations")
      .insert({
        conference_id: conferenceId,
        venue_id: venueId,
        stake_id: registration.ward === "daya" ? taichungStakeId : taipeiStakeId,
        ward_id: { xindian: xindianWardId, banqiao: banqiaoWardId, daya: dayaWardId }[registration.ward],
        name: `測試${seeded}`,
        phone: `09${String(seeded).padStart(8, "0")}`,
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
        lunch_option_id: registration.lunch
          ? { bento: bentoId, vegan: veganId, daya: dayaLunchId }[registration.lunch]
          : null,
        afternoon_activity_id: registration.walk ? walkId : null,
        choir_part: registration.choir ?? null,
        services: registration.services ?? [],
        printed_handbook: registration.handbook ?? false,
        ...(registration.cancelled ? { status: "cancelled", cancelled_at: new Date().toISOString() } : {}),
      })
      .select("id")
      .single(),
  );
  if (registration.course) {
    const courseId = { quilting: quiltingId, singing: singingId, daya: dayaCourseId }[registration.course];
    must(
      await admin.from("registration_courses").insert({
        registration_id: id,
        venue_id: venueId,
        session_id: registration.course === "daya" ? dayaMorningId : morningId,
        course_id: courseId,
      }),
    );
  }
}

/** 金華四筆有效（含一位中區台中的姐妹）、一筆已取消；大雅兩筆有效（一位北區台北的姐妹）。 */
async function seedMix() {
  await seed({
    venue: "jinhua",
    ward: "xindian",
    course: "quilting",
    lunch: "bento",
    walk: true,
    choir: "soprano",
    services: ["setup", "reception"],
    handbook: true,
  });
  await seed({
    venue: "jinhua",
    ward: "xindian",
    course: "quilting",
    lunch: "vegan",
    choir: "alto",
    services: ["reception"],
  });
  await seed({ venue: "jinhua", ward: "banqiao", course: "singing", lunch: "bento", handbook: true });
  await seed({ venue: "jinhua", ward: "daya", services: ["translation"] });
  await seed({
    venue: "jinhua",
    ward: "banqiao",
    course: "quilting",
    lunch: "bento",
    walk: true,
    choir: "soprano",
    services: ["cleanup"],
    handbook: true,
    cancelled: true,
  });
  await seed({ venue: "daya", ward: "banqiao", course: "daya", lunch: "daya", services: ["setup"], handbook: true });
  await seed({ venue: "daya", ward: "daya", course: "daya", choir: "alto" });
}

const venue = (statistics: Statistics, id: string) => statistics.venues.find((item) => item.id === id)!;
const course = (statistics: Statistics, id: string) =>
  statistics.venues
    .flatMap((item) => item.sessions.flatMap((session) => session.courses))
    .find((item) => item.id === id)!;
const stakeCounts = (statistics: Statistics) =>
  statistics.stakes.map((stake) => [stake.name, stake.count, stake.wards.map((ward) => [ward.name, ward.count])]);

describe("後台統計", () => {
  it("只計有效報名：全體、各場地、各支聯會、各支會、課程、午餐、午后動態、服務意願、紙本手冊", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("head@example.com"), conferenceId);

    expect(statistics.total).toBe(6);
    expect(venue(statistics, jinhuaId).count).toBe(4);
    expect(venue(statistics, dayaId).count).toBe(2);
    expect(stakeCounts(statistics)).toEqual([
      [
        "測試台北支聯會",
        4,
        [
          ["測試新店支會", 2],
          ["測試板橋支會", 2],
        ],
      ],
      ["測試台中支聯會", 2, [["測試大雅支會", 2]]],
    ]);
    expect(course(statistics, quiltingId).count).toBe(2);
    expect(course(statistics, singingId).count).toBe(1);
    expect(course(statistics, dayaCourseId).count).toBe(2);
    expect(venue(statistics, jinhuaId).lunches.map((lunch) => [lunch.name, lunch.count, lunch.capacity])).toEqual([
      ["便當", 2, 30],
      ["素食", 1, null],
    ]);
    expect(venue(statistics, jinhuaId).noLunch).toBe(1);
    expect(venue(statistics, jinhuaId).activities.map((activity) => [activity.name, activity.count])).toEqual([
      ["散步", 1],
    ]);
    expect(venue(statistics, jinhuaId).noActivity).toBe(3);
    expect(statistics.choir).toEqual({ soprano: 1, alto: 2 });
    expect(statistics.services).toEqual({ setup: 2, translation: 1, reception: 2, cleanup: 0 });
    expect(statistics.printedHandbook).toBe(3);
  });

  it("課程列出容量；不限人數的課程容量是 null，課程依場次排序", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("head@example.com"), conferenceId);

    expect(
      venue(statistics, jinhuaId).sessions.map((session) => [
        session.name,
        session.courses.map((item) => [item.title, item.count, item.capacity]),
      ]),
    ).toEqual([
      [
        "上午",
        [
          ["拼布", 2, 40],
          ["唱歌", 1, null],
        ],
      ],
    ]);
  });

  it("沒有報名的年度大會全部是 0，場地與課程照樣列出", async () => {
    const statistics = await getStatistics(await signedInClient("head@example.com"), conferenceId);

    expect(statistics.total).toBe(0);
    expect(statistics.venues.map((item) => [item.name, item.count])).toEqual([
      ["測試金華教堂", 0],
      ["測試大雅教堂", 0],
    ]);
    expect(course(statistics, quiltingId).count).toBe(0);
    expect(statistics.stakes).toEqual([]);
    expect(statistics.services).toEqual({ setup: 0, translation: 0, reception: 0, cleanup: 0 });
  });

  it("課務組只計報名該區教堂的報名", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("course@example.com"), conferenceId);

    expect(statistics.total).toBe(4);
    expect(venue(statistics, jinhuaId).count).toBe(4);
    expect(venue(statistics, dayaId).count).toBe(0);
    expect(course(statistics, dayaCourseId).count).toBe(0);
    expect(stakeCounts(statistics)).toEqual([
      [
        "測試台北支聯會",
        3,
        [
          ["測試新店支會", 2],
          ["測試板橋支會", 1],
        ],
      ],
      ["測試台中支聯會", 1, [["測試大雅支會", 1]]],
    ]);
    expect(statistics.choir).toEqual({ soprano: 1, alto: 1 });
    expect(statistics.printedHandbook).toBe(2);
  });

  it("北區報報組另外算得到北區支聯會報名中區教堂的姐妹", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("report@example.com"), conferenceId);

    expect(statistics.total).toBe(5);
    expect(venue(statistics, dayaId).count).toBe(1);
    expect(course(statistics, dayaCourseId).count).toBe(1);
    expect(venue(statistics, dayaId).lunches.map((lunch) => lunch.count)).toEqual([1]);
    expect(stakeCounts(statistics)).toEqual([
      [
        "測試台北支聯會",
        4,
        [
          ["測試新店支會", 2],
          ["測試板橋支會", 2],
        ],
      ],
      ["測試台中支聯會", 1, [["測試大雅支會", 1]]],
    ]);
    expect(statistics.services.setup).toBe(2);
  });

  it("全區的報報組算全部", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("everywhere@example.com"), conferenceId);

    expect(statistics.total).toBe(6);
    expect(venue(statistics, dayaId).count).toBe(2);
  });

  it("統計數字與資料庫內的有效報名一致", async () => {
    await seedMix();
    const statistics = await getStatistics(await signedInClient("head@example.com"), conferenceId);

    const rows = must(
      await admin
        .from("registrations")
        .select("venue_id, ward_id, lunch_option_id, services, printed_handbook, registration_courses(course_id)")
        .eq("conference_id", conferenceId)
        .eq("status", "registered"),
    );
    const countWhere = (predicate: (row: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;

    expect(statistics.total).toBe(rows.length);
    for (const item of statistics.venues) {
      expect(item.count).toBe(countWhere((row) => row.venue_id === item.id));
      for (const lunch of item.lunches) expect(lunch.count).toBe(countWhere((row) => row.lunch_option_id === lunch.id));
      for (const session of item.sessions) {
        for (const each of session.courses) {
          expect(each.count).toBe(
            countWhere((row) => row.registration_courses.some((choice) => choice.course_id === each.id)),
          );
        }
      }
    }
    for (const ward of statistics.stakes.flatMap((stake) => stake.wards)) {
      expect(ward.count).toBe(countWhere((row) => row.ward_id === ward.id));
    }
    for (const [service, count] of Object.entries(statistics.services)) {
      expect(count).toBe(countWhere((row) => row.services.includes(service)));
    }
    expect(statistics.printedHandbook).toBe(countWhere((row) => row.printed_handbook));
  });

  it("不是工作人員的登入帳號算不到任何報名", async () => {
    await seedMix();
    must(await admin.auth.admin.createUser({ email: "stranger@example.com", email_confirm: true }));
    const stranger: SupabaseClient = await signedInClient("stranger@example.com");

    const rows = must(await stranger.rpc("registration_counts", { p_conference_id: conferenceId })) as {
      count: number;
    }[];
    expect(rows.every((row) => row.count === 0)).toBe(true);
  });
});

describe("統計頁列出的場地", () => {
  const venues = [
    { id: "n", region: "north" as const, count: 0 },
    { id: "c", region: "central" as const, count: 1 },
    { id: "s", region: "south" as const, count: 0 },
  ];

  it("總管理員與全區的報報組看全部場地", () => {
    expect(venuesInView(venues, { role: "admin", region: null }).map((item) => [item.id, item.partial])).toEqual([
      ["n", false],
      ["c", false],
      ["s", false],
    ]);
    expect(venuesInView(venues, { role: "registration_team", region: null }).map((item) => item.id)).toEqual([
      "n",
      "c",
      "s",
    ]);
  });

  it("課務組只看該區的場地", () => {
    expect(venuesInView(venues, { role: "course_team", region: "north" }).map((item) => item.id)).toEqual(["n"]);
  });

  it("報報組看該區的場地，加上有該區支聯會姐妹報名的別區場地，標示只計本區支聯會", () => {
    expect(
      venuesInView(venues, { role: "registration_team", region: "north" }).map((item) => [item.id, item.partial]),
    ).toEqual([
      ["n", false],
      ["c", true],
    ]);
  });
});
