import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { listRegistrations } from "./registration-list";

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
 * 每個測試都有一個報名中的 2099 年度大會，兩個場地（金華、大雅）、兩個支聯會（台北、台中）各一個支會，
 * 以及三位工作人員：總管理員、金華的教堂承辦、台北的支聯會承辦。測完全部刪掉、復原原本的目前年度。
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
        registration_opens_at: new Date(now - DAY).toISOString(),
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
        { conference_id: conference.id, position: 1, name_zh: "測試金華教堂" },
        { conference_id: conference.id, position: 2, name_zh: "測試大雅教堂" },
      ])
      .select("id, position")
      .order("position"),
  ).map((venue) => venue.id);

  [taipeiStakeId, taichungStakeId] = must(
    await admin
      .from("stakes")
      .insert([
        { position: 1, name_zh: "測試台北支聯會" },
        { position: 2, name_zh: "測試台中支聯會" },
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
    ["jinhua@example.com", { role: "venue_staff", venue_id: jinhuaId }],
    ["taipei@example.com", { role: "stake_staff", stake_id: taipeiStakeId }],
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

  it("教堂承辦只讀得到自己場地的報名，其他場地的讀不到", async () => {
    await seedGrid();
    const jinhua = await signedInClient("jinhua@example.com");

    expect(await names(jinhua)).toEqual(["金華台中", "金華台北"]);
    // 直接查資料表也一樣，不是只有名單畫面藏起來。
    const direct = must(await jinhua.from("registrations").select("name").eq("venue_id", dayaId));
    expect(direct).toEqual([]);
  });

  it("支聯會承辦讀得到自己支聯會在各場地的報名，其他支聯會的讀不到", async () => {
    await seedGrid();
    const taipei = await signedInClient("taipei@example.com");

    expect(await names(taipei)).toEqual(["大雅台北", "金華台北"]);
    const direct = must(await taipei.from("registrations").select("name").eq("stake_id", taichungStakeId));
    expect(direct).toEqual([]);
  });

  it("支聯會承辦改不了任何報名資料，包括自己支聯會的", async () => {
    const id = await seed({ name: "金華台北", venue: "jinhua", stake: "taipei" });
    const taipei = await signedInClient("taipei@example.com");

    await taipei.from("registrations").update({ name: "被改掉" }).eq("id", id);
    await taipei.from("registrations").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
    await taipei.from("registrations").delete().eq("id", id);
    const inserted = await taipei.from("registrations").insert({
      conference_id: conferenceIds[0],
      venue_id: jinhuaId,
      stake_id: taipeiStakeId,
      ward_id: xindianWardId,
      name: "偷塞一筆",
      phone: "0999999999",
      portrait_consented_at: new Date().toISOString(),
    });
    expect(inserted.error).not.toBeNull();

    const after = must(await admin.from("registrations").select("name, status").eq("conference_id", conferenceIds[0]));
    expect(after).toEqual([{ name: "金華台北", status: "registered" }]);
  });

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
      await admin.from("venues").insert({ conference_id: old.id, name_zh: "去年的教堂" }).select("id").single(),
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
      }),
    );

    expect(await names(await signedInClient("head@example.com"))).toEqual(["今年的"]);
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
    });
  });

  it("支會停用後，承辦人員仍看得到舊報名的支聯會與支會名稱", async () => {
    await seed({ name: "王小美", venue: "jinhua", stake: "taipei" });
    must(await admin.from("stakes").update({ is_active: false }).eq("id", taipeiStakeId));
    must(await admin.from("wards").update({ is_active: false }).eq("id", xindianWardId));

    for (const email of ["jinhua@example.com", "taipei@example.com"]) {
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
  });

  it("搜尋也只在自己的範圍裡找", async () => {
    await seedGrid();

    expect(await names(await signedInClient("jinhua@example.com"), "0933333333")).toEqual([]);
    expect(await names(await signedInClient("taipei@example.com"), "台中")).toEqual([]);
  });
});
