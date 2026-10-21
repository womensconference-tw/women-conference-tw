import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { allowedExports, exportStaffCsv, type StaffExportKind } from "./staff-export";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string;
let stakeIds: string[] = [];
let quiltingId: string;

// 這個測試在報名開放前多建 1001 門課（開放後不能新增課程），其他測試不用。
const MANY_COURSES = "課程、報名都超過一次能讀的 1000 筆時，每一位選的課程與教室都讀得到";
const FILLER_COUNT = 1001;
let fillerCourseIds: string[] = [];
let dayaMorningId: string;

/*
 * 2099 年度大會（報名中）：
 * - 北區金華：上午（拼布在 201 教室、唱歌沒填教室）、下午（插花在 301 教室）；午餐便當。
 * - 中區大雅：上午（烘焙在 A1 教室）。
 * 支聯會北區台北（新店支會）、中區台中（大雅支會）。
 * 報名：王一（金華、新店，拼布＋插花、便當、要手冊）、王二（金華、中區大雅支會，唱歌、跨區）、
 * 王三（大雅、北區新店支會，烘焙、跨區）、王四（大雅、大雅支會，沒選課）、王五（金華、新店，已取消）。
 * 工作人員：總管理員、北區課務組、北區報報組、全區報報組。
 */
beforeEach(async ({ task }) => {
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

  const [jinhuaId, dayaId] = must(
    await admin
      .from("venues")
      .insert([
        { region: "north", conference_id: conferenceId, position: 1, name_zh: "測試金華教堂" },
        { region: "central", conference_id: conferenceId, position: 2, name_zh: "測試大雅教堂" },
      ])
      .select("id, position")
      .order("position"),
  ).map((venue) => venue.id);

  const addSession = async (venueId: string, position: number, name: string) =>
    must(
      await admin
        .from("sessions")
        .insert({ conference_id: conferenceId, venue_id: venueId, position, name_zh: name })
        .select("id")
        .single(),
    ).id;
  const morningId = await addSession(jinhuaId, 1, "上午 10:00");
  const afternoonId = await addSession(jinhuaId, 2, "下午 13:30");
  dayaMorningId = await addSession(dayaId, 1, "大雅上午 10:00");

  const addCourse = async (sessionId: string, position: number, title: string, classroom?: string) => {
    const { id } = must(
      await admin
        .from("courses")
        .insert({ conference_id: conferenceId, session_id: sessionId, position, title_zh: title })
        .select("id")
        .single(),
    );
    if (classroom) must(await admin.from("course_classrooms").insert({ course_id: id, classroom }));
    return id;
  };
  quiltingId = await addCourse(morningId, 1, "拼布", "201");
  const singingId = await addCourse(morningId, 2, "唱歌");
  const flowersId = await addCourse(afternoonId, 1, "插花", "301");
  const bakingId = await addCourse(dayaMorningId, 1, "烘焙", "A1");
  fillerCourseIds = [];
  if (task.name === MANY_COURSES) {
    // 編號自己產生：一次新增上千筆時不必讀回傳（回傳也受 1000 筆上限）。
    fillerCourseIds = Array.from({ length: FILLER_COUNT }, () => crypto.randomUUID());
    must(
      await admin.from("courses").insert(
        fillerCourseIds.map((id, index) => ({
          id,
          conference_id: conferenceId,
          session_id: dayaMorningId,
          position: 10 + index,
          title_zh: `填充課程 ${index}`,
        })),
      ),
    );
    must(
      await admin
        .from("course_classrooms")
        .insert(fillerCourseIds.map((id, index) => ({ course_id: id, classroom: `R${index}` }))),
    );
  }

  const bentoId = must(
    await admin
      .from("lunch_options")
      .insert({ conference_id: conferenceId, venue_id: jinhuaId, position: 1, name_zh: "便當" })
      .select("id")
      .single(),
  ).id;
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conferenceId),
  );

  const [taipeiStakeId, taichungStakeId] = must(
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
  const xindianWardId = must(
    await admin.from("wards").insert({ stake_id: taipeiStakeId, name_zh: "測試新店支會" }).select("id").single(),
  ).id;
  const dayaWardId = must(
    await admin.from("wards").insert({ stake_id: taichungStakeId, name_zh: "測試大雅支會" }).select("id").single(),
  ).id;

  const seed = async (
    name: string,
    venueId: string,
    north: boolean,
    courses: [string, string][],
    extra: Record<string, unknown> = {},
  ) => {
    const { id } = must(
      await admin
        .from("registrations")
        .insert({
          conference_id: conferenceId,
          venue_id: venueId,
          stake_id: north ? taipeiStakeId : taichungStakeId,
          ward_id: north ? xindianWardId : dayaWardId,
          name,
          phone: "0912345678",
          portrait_consented_at: new Date().toISOString(),
          locale: "zh",
          ...extra,
        })
        .select("id")
        .single(),
    );
    for (const [sessionId, courseId] of courses) {
      must(
        await admin
          .from("registration_courses")
          .insert({ registration_id: id, venue_id: venueId, session_id: sessionId, course_id: courseId }),
      );
    }
  };
  await seed(
    "王一",
    jinhuaId,
    true,
    [
      [morningId, quiltingId],
      [afternoonId, flowersId],
    ],
    {
      lunch_option_id: bentoId,
      printed_handbook: true,
      email: "one@example.com",
      choir_part: "soprano",
      services: ["setup"],
    },
  );
  await seed("王二", jinhuaId, false, [[morningId, singingId]], { role: "speaker" });
  await seed("王三", dayaId, true, [[dayaMorningId, bakingId]]);
  await seed("王四", dayaId, false, []);
  await seed("王五", jinhuaId, true, [], { status: "cancelled", cancelled_at: new Date().toISOString() });

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

async function rowsFor(email: string, kind: StaffExportKind) {
  const result = await exportStaffCsv(await signedInClient(email), kind, 2099);
  if (!result.ok) throw new Error(result.error);
  return result.rows;
}

/** 表頭以外每一列的姓名。 */
const names = (rows: string[][]) => rows.slice(1).map((row) => row[0]);

/** 把一列和表頭配成 { 欄名: 值 }，方便看。 */
function byHeader(rows: string[][], name: string) {
  const row = rows.find((item) => item[0] === name)!;
  return Object.fromEntries(rows[0].map((header, index) => [header, row[index]]));
}

describe("名牌 CSV", () => {
  it("正面姓名、身分類別，背面場地、每個場次的課程與教室、午餐、手冊；只列有效報名，依場地排序", async () => {
    const rows = await rowsFor("head@example.com", "badges");
    expect(rows[0]).toEqual([
      "姓名",
      "身分類別",
      "參加教堂",
      "第一場次",
      "第一場次課程",
      "第一場次教室",
      "第二場次",
      "第二場次課程",
      "第二場次教室",
      "午餐",
      "紙本手冊",
    ]);
    expect(rows.slice(1)).toEqual([
      ["王一", "與會姐妹", "測試金華教堂", "上午 10:00", "拼布", "201", "下午 13:30", "插花", "301", "便當", "需要"],
      ["王二", "講師", "測試金華教堂", "上午 10:00", "唱歌", "", "下午 13:30", "不選課", "", "不需要", "不需要"],
      ["王三", "與會姐妹", "測試大雅教堂", "大雅上午 10:00", "烘焙", "A1", "", "", "", "不需要", "不需要"],
      ["王四", "與會姐妹", "測試大雅教堂", "大雅上午 10:00", "不選課", "", "", "", "", "不需要", "不需要"],
    ]);
  });

  it("教室是換過之後最新的", async () => {
    must(await admin.from("course_classrooms").update({ classroom: "大禮堂" }).eq("course_id", quiltingId));
    expect(byHeader(await rowsFor("head@example.com", "badges"), "王一")["第一場次教室"]).toBe("大禮堂");
  });

  it("課務組只匯出報名該區教堂的", async () => {
    const rows = await rowsFor("course@example.com", "badges");
    expect(names(rows)).toEqual(["王一", "王二"]);
    expect(byHeader(rows, "王一")["第一場次教室"]).toBe("201");
  });

  it("報報組看不到教室，不能匯出名牌", async () => {
    for (const email of ["report@example.com", "everywhere@example.com"]) {
      expect(await exportStaffCsv(await signedInClient(email), "badges", 2099)).toEqual({
        ok: false,
        error: "not_allowed",
      });
    }
  });
});

describe("範圍內名單 CSV", () => {
  it("課務組：報名該區教堂的，已取消的也列出並標示狀態", async () => {
    const rows = await rowsFor("course@example.com", "roster");
    expect(names(rows)).toEqual(["王一", "王五", "王二"]);
    expect(byHeader(rows, "王五")["狀態"]).toBe("已取消");
    expect(byHeader(rows, "王一")["狀態"]).toBe("有效");
  });

  it("單區報報組：報名該區教堂的，加上該區支聯會報名別區教堂的", async () => {
    expect(names(await rowsFor("report@example.com", "roster"))).toEqual(["王一", "王五", "王二", "王三"]);
  });

  it("全區報報組：全部", async () => {
    expect(names(await rowsFor("everywhere@example.com", "roster"))).toEqual(["王一", "王五", "王二", "王三", "王四"]);
  });

  it("有聯絡電話、支聯會支會、跨區與各場次課程，沒有 Email 等完整名單才有的欄位", async () => {
    const rows = await rowsFor("report@example.com", "roster");
    expect(byHeader(rows, "王三")).toMatchObject({
      電話: "0912345678",
      參加教堂: "測試大雅教堂",
      支聯會: "測試台北支聯會",
      支會: "測試新店支會",
      跨區: "是",
      第一場次課程: "烘焙",
      第二場次課程: "不適用",
    });
    expect(rows[0]).not.toContain("Email");
  });
});

describe("完整名單與支聯會簡表", () => {
  it("總管理員匯出的完整名單有全部報名與 Email、服務意願", async () => {
    const rows = await rowsFor("head@example.com", "full_roster");
    expect(names(rows)).toEqual(["王一", "王五", "王二", "王三", "王四"]);
    expect(byHeader(rows, "王一")).toMatchObject({ Email: "one@example.com", 即席唱詩班: "女高音", 事前準備志工: "是" });
  });

  it("支聯會簡表：每個支會各場地的有效報名人數，加上小計與總計", async () => {
    expect(await rowsFor("head@example.com", "stake_summary")).toEqual([
      ["區", "支聯會", "支會", "測試金華教堂", "測試大雅教堂", "合計"],
      ["北區", "測試台北支聯會", "測試新店支會", "1", "1", "2"],
      ["北區", "測試台北支聯會", "小計", "1", "1", "2"],
      ["中區", "測試台中支聯會", "測試大雅支會", "1", "1", "2"],
      ["中區", "測試台中支聯會", "小計", "1", "1", "2"],
      ["", "總計", "", "2", "2", "4"],
    ]);
  });

  it("不是總管理員（包括全區報報組）不能匯出完整名單與支聯會簡表", async () => {
    for (const email of ["course@example.com", "report@example.com", "everywhere@example.com"]) {
      const supabase = await signedInClient(email);
      for (const kind of ["full_roster", "stake_summary"] as const) {
        expect(await exportStaffCsv(supabase, kind, 2099)).toEqual({ ok: false, error: "not_allowed" });
      }
    }
  });
});

describe("分批讀取", () => {
  it(MANY_COURSES, async () => {
    // 每一門填充課程各有一位報名者選：只要有任何一門課或任何一筆報名沒讀到，那一位的課程就不對。
    const daya = must(await admin.from("registrations").select("venue_id, stake_id, ward_id").eq("name", "王四").single());
    const registrationIds = fillerCourseIds.map(() => crypto.randomUUID());
    must(
      await admin.from("registrations").insert(
        registrationIds.map((id, index) => ({
          id,
          conference_id: conferenceId,
          ...daya,
          name: `填充${index}`,
          phone: "0912345678",
          portrait_consented_at: new Date().toISOString(),
          locale: "zh",
        })),
      ),
    );
    must(
      await admin.from("registration_courses").insert(
        registrationIds.map((id, index) => ({
          registration_id: id,
          venue_id: daya.venue_id,
          session_id: dayaMorningId,
          course_id: fillerCourseIds[index],
        })),
      ),
    );

    const rows = await rowsFor("head@example.com", "badges");
    const [name, course, classroom] = ["姓名", "第一場次課程", "第一場次教室"].map((header) => rows[0].indexOf(header));
    const fillers = rows.filter((row) => row[name].startsWith("填充"));
    expect(fillers).toHaveLength(FILLER_COUNT);
    const wrong = fillers.filter((row) => {
      const index = row[name].slice("填充".length);
      return row[course] !== `填充課程 ${index}` || row[classroom] !== `R${index}`;
    });
    expect(wrong).toEqual([]);
  });

  it("讀到一半有人被刪掉（或改到範圍外），後面沒變動的報名一筆都不少", async () => {
    const supabase = await signedInClient("head@example.com");
    let removed: string | undefined;
    const result = await exportStaffCsv(supabase, "full_roster", 2099, {
      pageSize: 2,
      afterPage: async (ids) => {
        if (removed) return;
        const row = must(await admin.from("registrations").select("name").eq("id", ids[0]).single());
        removed = row.name;
        must(await admin.from("registrations").delete().eq("id", ids[0]));
      },
    });
    if (!result.ok) throw new Error(result.error);
    // 被刪掉的那位在第一批已經讀到，所以還在；其他四位都要在。
    expect(names(result.rows).toSorted()).toEqual(["王一", "王二", "王三", "王四", "王五"].toSorted());
    expect(removed).toBeDefined();
  });

  it("同一毫秒內報名的兩筆，依微秒排先後，不受編號影響", async () => {
    // 王一、王五都在金華、新店支會：編號小的那筆時間比較晚，只比到毫秒時會排錯。
    const pair = must(await admin.from("registrations").select("id, name").in("name", ["王一", "王五"]).order("id"));
    must(await admin.from("registrations").update({ created_at: "2099-01-01T00:00:00.000900Z" }).eq("id", pair[0].id));
    must(await admin.from("registrations").update({ created_at: "2099-01-01T00:00:00.000100Z" }).eq("id", pair[1].id));

    const rows = await rowsFor("head@example.com", "full_roster");
    expect(names(rows).filter((name) => name === "王一" || name === "王五")).toEqual([pair[1].name, pair[0].name]);
  });

  it("場地的顯示順序相同時依名稱排，每次匯出的欄位順序一樣", async () => {
    // 名稱和原本的順序相反：金華（原本第一）改成 Z，大雅改成 A。
    must(await admin.from("venues").update({ position: 0 }).eq("conference_id", conferenceId));
    must(await admin.from("venues").update({ name_zh: "A教堂" }).eq("name_zh", "測試大雅教堂"));
    must(await admin.from("venues").update({ name_zh: "Z教堂" }).eq("name_zh", "測試金華教堂"));
    const rows = await rowsFor("head@example.com", "stake_summary");
    expect(rows[0]).toEqual(["區", "支聯會", "支會", "A教堂", "Z教堂", "合計"]);
  });
});

describe("檢查", () => {
  it("畫面上依角色顯示的下載按鈕", () => {
    expect(allowedExports("admin")).toEqual(["badges", "full_roster", "stake_summary"]);
    expect(allowedExports("course_team")).toEqual(["badges", "roster"]);
    expect(allowedExports("registration_team")).toEqual(["roster"]);
  });

  it("總管理員的範圍就是全部，用完整名單，不另外匯出範圍內名單", async () => {
    expect(await exportStaffCsv(await signedInClient("head@example.com"), "roster", 2099)).toEqual({
      ok: false,
      error: "not_allowed",
    });
  });

  it("沒登入不能匯出任何東西", async () => {
    const supabase: SupabaseClient = anonClient();
    for (const kind of ["badges", "roster", "full_roster", "stake_summary"] as const) {
      expect(await exportStaffCsv(supabase, kind, 2099)).toEqual({ ok: false, error: "not_allowed" });
    }
  });

  it("沒有這個年度", async () => {
    expect(await exportStaffCsv(await signedInClient("head@example.com"), "full_roster", 1999)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
