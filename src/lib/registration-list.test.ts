import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { getRegistrationForEdit, listRegistrations } from "./registration-list";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceIds: string[] = [];
let stakeIds: string[] = [];
let jinhuaId: string;
let dayaId: string;
let taipeiStakeId: string;
let taichungStakeId: string;
let xindianWardId: string;
let dayaWardId: string;

/*
 * 每個測試都有一個報名中的 2099 年度大會，兩個場地（北區金華、中區大雅）、兩個支聯會（北區台北、中區台中）各一個支會，
 * 以及四位工作人員：總管理員、北區課務組、北區報報組、全區報報組。測完全部刪掉、復原原本的目前年度。
 */
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
        // 場地要在開放前建好（venues_locked_after_opening），建好後才開放。
        registration_opens_at: new Date(now + DAY / 2).toISOString(),
        registration_closes_at: new Date(now + DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  );
  conferenceIds = [conference.id];

  [jinhuaId, dayaId] = must(
    await admin
      .from("venues")
      .insert([
        { region: "north", conference_id: conference.id, position: 1, name_zh: "測試金華教堂" },
        { region: "central", conference_id: conference.id, position: 2, name_zh: "測試大雅教堂" },
      ])
      .select("id, position")
      .order("position"),
  ).map((venue) => venue.id);
  must(
    await admin
      .from("conferences")
      .update({ registration_opens_at: new Date(now - DAY).toISOString() })
      .eq("id", conference.id),
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

  xindianWardId = must(
    await admin.from("wards").insert({ stake_id: taipeiStakeId, name_zh: "測試新店支會" }).select("id").single(),
  ).id;
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
  // 刪掉年度大會時，它的場地與報名一起刪除。
  if (conferenceIds.length > 0) must(await admin.from("conferences").delete().in("id", conferenceIds));
  conferenceIds = [];
  if (stakeIds.length > 0) {
    must(await admin.from("wards").delete().in("stake_id", stakeIds));
    must(await admin.from("stakes").delete().in("id", stakeIds));
  }
  stakeIds = [];
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

type Seed = { name: string; venue: "jinhua" | "daya"; stake: "taipei" | "taichung"; phone?: string; number?: string };

/** 直接寫入一筆報名（略過報名服務），回傳 id。 */
async function seed({ name, venue, stake, phone, number }: Seed): Promise<string> {
  return must(
    await admin
      .from("registrations")
      .insert({
        conference_id: conferenceIds[0],
        venue_id: venue === "jinhua" ? jinhuaId : dayaId,
        stake_id: stake === "taipei" ? taipeiStakeId : taichungStakeId,
        ward_id: stake === "taipei" ? xindianWardId : dayaWardId,
        name,
        phone: number ? null : (phone ?? "0912345678"),
        registration_number: number ?? null,
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      })
      .select("id")
      .single(),
  ).id;
}

/** 四筆報名：場地 × 支聯會 各一筆。 */
async function seedGrid() {
  await seed({ name: "金華台北", venue: "jinhua", stake: "taipei", phone: "0911111111" });
  await seed({ name: "金華台中", venue: "jinhua", stake: "taichung", phone: "0922222222" });
  await seed({ name: "大雅台北", venue: "daya", stake: "taipei", phone: "0933333333" });
  await seed({ name: "大雅台中", venue: "daya", stake: "taichung", number: "456789" });
}

const names = async (client: SupabaseClient, query = "") =>
  (await listRegistrations(client, query)).items.map((item) => item.name).sort();

describe("後台報名名單的角色範圍", () => {
  it("總管理員讀得到所有場地、所有支聯會的報名", async () => {
    await seedGrid();

    expect(await names(await signedInClient("head@example.com"))).toEqual(["大雅台中", "大雅台北", "金華台中", "金華台北"]);
  });

  it("課務組只讀得到報名該區教堂的報名，該區支聯會報名別區教堂的讀不到", async () => {
    await seedGrid();
    const course = await signedInClient("course@example.com");

    expect(await names(course)).toEqual(["金華台中", "金華台北"]);
    // 直接查資料表也一樣，不是只有名單畫面藏起來。
    const direct = must(await course.from("registrations").select("name").eq("venue_id", dayaId));
    expect(direct).toEqual([]);
  });

  it("報報組讀得到報名該區教堂的報名，加上該區支聯會報名別區教堂的報名", async () => {
    await seedGrid();
    const report = await signedInClient("report@example.com");

    expect(await names(report)).toEqual(["大雅台北", "金華台中", "金華台北"]);
    const direct = must(await report.from("registrations").select("name").eq("venue_id", dayaId));
    expect(direct).toEqual([{ name: "大雅台北" }]);
  });

  it("全區的報報組讀得到所有報名", async () => {
    await seedGrid();

    expect(await names(await signedInClient("everywhere@example.com"))).toEqual([
      "大雅台中",
      "大雅台北",
      "金華台中",
      "金華台北",
    ]);
  });

  it.each(["course@example.com", "report@example.com", "everywhere@example.com"])(
    "課務組、報報組改不了任何報名資料，包括自己範圍內的（%s）",
    async (email) => {
      const id = await seed({ name: "金華台北", venue: "jinhua", stake: "taipei" });
      const staff = await signedInClient(email);

      await staff.from("registrations").update({ name: "被改掉" }).eq("id", id);
      await staff.from("registrations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
      await staff.from("registrations").delete().eq("id", id);
      const inserted = await staff.from("registrations").insert({
        conference_id: conferenceIds[0],
        venue_id: jinhuaId,
        stake_id: taipeiStakeId,
        ward_id: xindianWardId,
        name: "偷塞一筆",
        phone: "0999999999",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      });
      expect(inserted.error).not.toBeNull();

      const after = must(await admin.from("registrations").select("name, status").eq("conference_id", conferenceIds[0]));
      expect(after).toEqual([{ name: "金華台北", status: "registered" }]);
    },
  );

  it("沒登入的訪客、不在工作人員名單裡的登入帳號都讀不到任何報名", async () => {
    await seedGrid();
    must(await admin.auth.admin.createUser({ email: "nobody@example.com", email_confirm: true }));

    // 訪客連讀取資料表的權限都沒有；有登入帳號但不是工作人員的，權限規則一筆都不給。
    await expect(names(anonClient())).rejects.toThrow("permission denied");
    expect(await names(await signedInClient("nobody@example.com"))).toEqual([]);
  });

  it("只列出目前年度的報名", async () => {
    await seed({ name: "今年的", venue: "jinhua", stake: "taipei" });
    const old = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    );
    conferenceIds.push(old.id);
    const oldVenue = must(
      await admin.from("venues").insert({ region: "north", conference_id: old.id, name_zh: "去年的教堂" }).select("id").single(),
    );
    must(
      await admin.from("registrations").insert({
        conference_id: old.id,
        venue_id: oldVenue.id,
        stake_id: taipeiStakeId,
        ward_id: xindianWardId,
        name: "去年的",
        phone: "0912345678",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      }),
    );

    expect(await names(await signedInClient("head@example.com"))).toEqual(["今年的"]);
  });
});

describe("後台選年度看舊年度的名單", () => {
  /** 2099 年的四筆報名變成去年：另建一個 2100 目前年度。 */
  async function lastYearGrid() {
    await seedGrid();
    must(await admin.from("conferences").update({ is_current: false }).eq("id", conferenceIds[0]));
    const now = Date.now();
    const current = must(
      await admin
        .from("conferences")
        .insert({
          year: 2100,
          conference_date: "2100-05-15",
          announce_at: new Date(now - 2 * DAY).toISOString(),
          registration_opens_at: new Date(now + DAY).toISOString(),
          registration_closes_at: new Date(now + 2 * DAY).toISOString(),
          is_current: true,
        })
        .select("id")
        .single(),
    );
    conferenceIds.push(current.id);
  }

  const namesIn = async (client: SupabaseClient, year: number, query = "") =>
    (await listRegistrations(client, query, year)).items.map((item) => item.name).sort();

  it("選了年度就列出那一年的報名，沒選時是目前年度", async () => {
    await lastYearGrid();
    const head = await signedInClient("head@example.com");

    expect(await namesIn(head, 2099)).toEqual(["大雅台中", "大雅台北", "金華台中", "金華台北"]);
    expect(await names(head)).toEqual([]);
  });

  it("舊年度的名單也只看得到自己範圍內的", async () => {
    await lastYearGrid();

    expect(await namesIn(await signedInClient("course@example.com"), 2099)).toEqual(["金華台中", "金華台北"]);
    expect(await namesIn(await signedInClient("report@example.com"), 2099)).toEqual(["大雅台北", "金華台中", "金華台北"]);
  });

  it("舊年度也能搜尋", async () => {
    await lastYearGrid();

    expect(await namesIn(await signedInClient("head@example.com"), 2099, "大雅")).toEqual(["大雅台中", "大雅台北"]);
  });
});

describe("後台報名名單的內容與搜尋", () => {
  it("每筆顯示電話或報名編號、支聯會、支會、場地與狀態", async () => {
    const id = await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0912345678" });
    await seed({ name: "陳大明", venue: "daya", stake: "taichung", number: "456789" });
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", id),
    );

    const { items, total } = await listRegistrations(await signedInClient("head@example.com"), "");

    expect(total).toBe(2);
    expect(items.find((item) => item.name === "王小美")).toMatchObject({
      phone: "0912345678",
      registrationNumber: null,
      venueName: "測試金華教堂",
      stakeName: "測試台北支聯會",
      wardName: "測試新店支會",
      status: "cancelled",
    });
    expect(items.find((item) => item.name === "陳大明")).toMatchObject({
      phone: null,
      registrationNumber: "456789",
      venueName: "測試大雅教堂",
      stakeName: "測試台中支聯會",
      wardName: "測試大雅支會",
      status: "registered",
      role: "attendee",
    });
  });

  it("支會停用後，課務組、報報組仍看得到舊報名的支聯會與支會名稱", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    must(await admin.from("stakes").update({ is_active: false }).eq("id", taipeiStakeId));
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    for (const email of ["course@example.com", "report@example.com"]) {
      const { items } = await listRegistrations(await signedInClient(email), "");
      expect(items).toMatchObject([{ stakeName: "測試台北支聯會", wardName: "測試新店支會" }]);
    }
  });

  it("可以用姓名的一部分搜尋，前後空白不影響", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王大華", venue: "jinhua", stake: "taipei" });
    await seed({ name: "陳小美", venue: "jinhua", stake: "taipei" });
    const head = await signedInClient("head@example.com");

    expect(await names(head, " 小美 ")).toEqual(["王小美", "陳小美"]);
    expect(await names(head, "王")).toEqual(["王大華", "王小美"]);
  });

  it("搜尋字裡的 % 和 _ 當成一般文字，不是萬用字元", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "Amy_Lin", venue: "jinhua", stake: "taipei" });
    const head = await signedInClient("head@example.com");

    expect(await names(head, "%")).toEqual([]);
    expect(await names(head, "y_L")).toEqual(["Amy_Lin"]);
    expect(await names(head, "y_")).toEqual(["Amy_Lin"]);
    expect(await names(head, "_")).toEqual(["Amy_Lin"]);
  });

  it("可以用電話搜尋，輸入的格式不同也找得到；也可以用報名編號搜尋", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0912345678" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei", phone: "+886922333444" });
    await seed({ name: "林阿姨", venue: "jinhua", stake: "taipei", number: "456789" });
    const head = await signedInClient("head@example.com");

    expect(await names(head, "0912-345-678")).toEqual(["王小美"]);
    expect(await names(head, "345 678")).toEqual(["王小美"]);
    expect(await names(head, "+886 922")).toEqual(["陳大明"]);
    expect(await names(head, "456789")).toEqual(["林阿姨"]);
  });

  it("台灣號碼用 09 開頭或 +886 開頭搜尋都找得到", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0912345678" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei", phone: "+886922333444" });
    const head = await signedInClient("head@example.com");

    expect(await names(head, "+886 912 345 678")).toEqual(["王小美"]);
    expect(await names(head, "0922-333-444")).toEqual(["陳大明"]);
    expect(await names(head, "0922")).toEqual(["陳大明"]);
  });

  it("09 與 +886 只在號碼開頭互換，不會找到其他國家或不含這段數字的號碼", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0912345678" });
    await seed({ name: "日本姐妹", venue: "jinhua", stake: "taipei", phone: "+81912345678" });
    const head = await signedInClient("head@example.com");

    expect(await names(head, "0912345678")).toEqual(["王小美"]);
    expect(await names(head, "+886912345678")).toEqual(["王小美"]);
    expect(await names(head, "01234567")).toEqual([]);
  });

  it("搜尋也只在自己的範圍裡找", async () => {
    await seedGrid();

    expect(await names(await signedInClient("course@example.com"), "0933333333")).toEqual([]);
    expect(await names(await signedInClient("report@example.com"), "台中")).toEqual(["金華台中"]);
  });
});

describe("後台修改報名時讀出的報名", () => {
  it("讀得到存下的內容、所選課程、身分類別與支聯會、支會名稱", async () => {
    const id = await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0912345678" });
    must(await admin.from("registrations").update({ role: "speaker", printed_handbook: true }).eq("id", id));

    const registration = await getRegistrationForEdit(await signedInClient("head@example.com"), id);

    expect(registration).toEqual({
      id,
      name: "王小美",
      phone: "0912345678",
      registrationNumber: null,
      email: null,
      lineId: null,
      stakeId: taipeiStakeId,
      wardId: xindianWardId,
      venueId: jinhuaId,
      courseIds: [],
      lunchOptionId: null,
      afternoonActivityId: null,
      choirPart: null,
      services: [],
      printedHandbook: true,
      role: "speaker",
      status: "registered",
      stakeName: "測試台北支聯會",
      wardName: "測試新店支會",
      isCurrentYear: true,
    });
  });

  it("讀不到範圍外或不存在的報名", async () => {
    const id = await seed({ name: "大雅台中", venue: "daya", stake: "taichung" });

    expect(await getRegistrationForEdit(await signedInClient("course@example.com"), id)).toBeNull();
    expect(
      await getRegistrationForEdit(await signedInClient("head@example.com"), "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
    expect(await getRegistrationForEdit(await signedInClient("head@example.com"), "not-an-id")).toBeNull();
  });
});

describe("疑似重複", () => {
  /** 在台北支聯會另加一個支會。 */
  async function anotherTaipeiWard() {
    return must(
      await admin.from("wards").insert({ stake_id: taipeiStakeId, name_zh: "測試景美支會" }).select("id").single(),
    ).id;
  }

  const duplicates = async (client: SupabaseClient, query = "") =>
    (await listRegistrations(client, query, undefined, "duplicates")).items.map((item) => item.name).sort();

  it("列出姓名與支會都相同的有效報名，姓名前後、中間的空白與英文大小寫不影響", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei", phone: "0911111111" });
    await seed({ name: "王 小美", venue: "daya", stake: "taipei", phone: "0922222222" });
    await seed({ name: "王　小美", venue: "jinhua", stake: "taipei", phone: "0933333333" });
    await seed({ name: "Amy Lin", venue: "jinhua", stake: "taipei" });
    await seed({ name: "amy lin", venue: "jinhua", stake: "taipei" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei" });

    expect(await duplicates(await signedInClient("head@example.com"))).toEqual(["Amy Lin", "amy lin", "王 小美", "王　小美", "王小美"]);
  });

  it("姓名相同但支會不同的不列入", async () => {
    const jingmeiWardId = await anotherTaipeiWard();
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    const other = await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    must(await admin.from("registrations").update({ ward_id: jingmeiWardId }).eq("id", other));
    await seed({ name: "王小美", venue: "jinhua", stake: "taichung" });

    expect(await duplicates(await signedInClient("head@example.com"))).toEqual([]);
  });

  it("已取消的報名不列入，也不讓剩下的一筆變成疑似重複", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    const cancelled = await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", cancelled),
    );

    expect(await duplicates(await signedInClient("head@example.com"))).toEqual([]);
  });

  it("只比對同一年度的報名", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    const old = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    );
    conferenceIds.push(old.id);
    const oldVenue = must(
      await admin.from("venues").insert({ region: "north", conference_id: old.id, name_zh: "去年的教堂" }).select("id").single(),
    );
    must(
      await admin.from("registrations").insert({
        conference_id: old.id,
        venue_id: oldVenue.id,
        stake_id: taipeiStakeId,
        ward_id: xindianWardId,
        name: "王小美",
        phone: "0912345678",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      }),
    );

    expect(await duplicates(await signedInClient("head@example.com"))).toEqual([]);
  });

  it("一般名單上也標出哪幾筆是疑似重複", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei" });

    const { items } = await listRegistrations(await signedInClient("head@example.com"), "");
    expect(items.map((item) => [item.name, item.suspectedDuplicate]).sort()).toEqual([
      ["王小美", true],
      ["王小美", true],
      ["陳大明", false],
    ]);
  });

  it("同一支會、同名的排在一起", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王大明", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王 大明", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王 小美", venue: "jinhua", stake: "taipei" });

    const { items } = await listRegistrations(await signedInClient("head@example.com"), "", undefined, "duplicates");
    const keys = items.map((item) => item.name.replace(" ", ""));
    expect([["王大明", "王大明", "王小美", "王小美"], ["王小美", "王小美", "王大明", "王大明"]]).toContainEqual(keys);
  });

  it("疑似重複的清單也可以搜尋", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei" });
    await seed({ name: "陳大明", venue: "jinhua", stake: "taipei" });

    expect(await duplicates(await signedInClient("head@example.com"), "大明")).toEqual(["陳大明", "陳大明"]);
  });
});

describe("跨區", () => {
  const crossRegion = async (client: SupabaseClient) =>
    Object.fromEntries((await listRegistrations(client, "")).items.map((item) => [item.name, item.crossRegion]));

  it("所選教堂的區與支聯會的區不同時標記跨區，相同時不標記", async () => {
    await seedGrid();

    expect(await crossRegion(await signedInClient("head@example.com"))).toEqual({
      金華台北: false,
      金華台中: true,
      大雅台北: true,
      大雅台中: false,
    });
  });

  it("支聯會改區後，標記跟著新的區", async () => {
    await seedGrid();
    must(await admin.from("stakes").update({ region: "north" }).eq("id", taichungStakeId));

    expect(await crossRegion(await signedInClient("head@example.com"))).toEqual({
      金華台北: false,
      金華台中: false,
      大雅台北: true,
      大雅台中: true,
    });
  });

  it("可以只列出有效的跨區報名，課務組、報報組也只在自己範圍內", async () => {
    await seedGrid();
    const crossOnly = async (email: string) =>
      (await listRegistrations(await signedInClient(email), "", undefined, "cross_region")).items
        .map((item) => item.name)
        .sort();

    expect(await crossOnly("head@example.com")).toEqual(["大雅台北", "金華台中"]);
    expect(await crossOnly("course@example.com")).toEqual(["金華台中"]);
    expect(await crossOnly("report@example.com")).toEqual(["大雅台北", "金華台中"]);

    // 已取消的不列入只看跨區。
    must(
      await admin
        .from("registrations")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("name", "金華台中"),
    );
    expect(await crossOnly("head@example.com")).toEqual(["大雅台北"]);
  });
});
