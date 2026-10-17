import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { listRegistrations } from "./registration-list";
import { getRegistrationOptions } from "./registration-options";
import { deleteUnit, getStakeDirectory, saveStake, saveWard, setUnitActive } from "./stakes";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let headAdmin: SupabaseClient;
let registrationTeam: SupabaseClient;
let centralRegistrationTeam: SupabaseClient;

// 測試建的支聯會名稱都以「測試」開頭，測完連同支會刪掉；seed 的名單不動。
// 每個測試有一位總管理員、一位北區報報組、一位中區報報組。
beforeEach(async () => {
  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "report@example.com", role: "registration_team", region: "north" },
    { email: "central@example.com", role: "registration_team", region: "central" },
  ];
  for (const { email, ...scope } of staff) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
  }
  [headAdmin, registrationTeam, centralRegistrationTeam] = await Promise.all(staff.map(({ email }) => signedInClient(email)));
});

afterEach(async () => {
  must(await admin.from("staff_members").delete().not("user_id", "is", null));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  must(await admin.from("stakes").delete().like("name_zh", "測試%"));
});

async function addedStake(nameZh: string, region = "north") {
  const result = await saveStake(headAdmin, { nameZh, nameEn: "", region, position: "" });
  if (!result.ok) throw new Error(`新增支聯會失敗：${result.error}`);
  return result.id;
}

async function addedWard(stakeId: string, nameZh: string, position = "") {
  const result = await saveWard(headAdmin, { stakeId, nameZh, nameEn: "", position });
  if (!result.ok) throw new Error(`新增支會失敗：${result.error}`);
  return result.id;
}

describe("新增與修改", () => {
  it("總管理員新增的支聯會與支會出現在後台名單，前台報名表也立即列出", async () => {
    const stakeId = await addedStake("測試竹北支聯會");
    await addedWard(stakeId, "測試竹北一支會");

    const directory = await getStakeDirectory(headAdmin);
    const stake = directory.stakes.find((candidate) => candidate.id === stakeId);
    expect(stake).toMatchObject({ nameZh: "測試竹北支聯會", region: "north", isActive: true });
    expect(stake?.wards.map((ward) => ward.nameZh)).toEqual(["測試竹北一支會"]);

    const options = await getRegistrationOptions(anonClient(), "zh");
    const listed = options.stakes.find((candidate) => candidate.id === stakeId);
    expect(listed?.wards.map((ward) => ward.name)).toEqual(["測試竹北一支會"]);
  });

  it("修改名稱（例如更正錯字），報名表跟著改", async () => {
    const stakeId = await addedStake("測試竹北支聯會");
    const wardId = await addedWard(stakeId, "測試竹北一支惠");

    expect(await saveWard(headAdmin, { id: wardId, nameZh: "測試竹北一支會", nameEn: "Zhubei 1st Ward", position: "2" })).toEqual({
      ok: true,
      id: wardId,
    });

    const options = await getRegistrationOptions(anonClient(), "en");
    const ward = options.stakes.find((candidate) => candidate.id === stakeId)?.wards[0];
    expect(ward).toMatchObject({ id: wardId, name: "Zhubei 1st Ward", nameZh: "測試竹北一支會" });
  });

  it("新增支聯會要選區、要有中文名稱", async () => {
    expect(await saveStake(headAdmin, { nameZh: "測試竹北支聯會", nameEn: "", region: "", position: "" })).toEqual({
      ok: false,
      error: "region_required",
    });
    expect(await saveStake(headAdmin, { nameZh: "　", nameEn: "Zhubei", region: "north", position: "" })).toEqual({
      ok: false,
      error: "name_required",
    });
  });

  it("報報組不能新增或修改", async () => {
    const stakeId = await addedStake("測試竹北支聯會");

    expect(await saveStake(registrationTeam, { nameZh: "測試新竹支聯會", nameEn: "", region: "north", position: "" })).toEqual({
      ok: false,
      error: "not_admin",
    });
    expect(await saveStake(registrationTeam, { id: stakeId, nameZh: "測試改名", nameEn: "", position: "" })).toEqual({
      ok: false,
      error: "not_admin",
    });
    expect(await setUnitActive(registrationTeam, "stake", stakeId, false)).toEqual({ ok: false, error: "not_admin" });
    expect((await getStakeDirectory(headAdmin)).stakes.find((stake) => stake.id === stakeId)).toMatchObject({
      nameZh: "測試竹北支聯會",
      isActive: true,
    });
  });

  it("既有支會不能改隸屬的支聯會", async () => {
    const zhubei = await addedStake("測試竹北支聯會");
    const hsinchu = await addedStake("測試新竹支聯會");
    const wardId = await addedWard(zhubei, "測試竹北一支會");

    const moved = await headAdmin.from("wards").update({ stake_id: hsinchu }).eq("id", wardId);
    expect(moved.error?.message).toBe("ward_stake_fixed");

    const directory = await getStakeDirectory(headAdmin);
    expect(directory.stakes.find((stake) => stake.id === zhubei)?.wards.map((ward) => ward.id)).toEqual([wardId]);
  });
});

describe("改區", () => {
  it("總管理員可以改支聯會的區", async () => {
    const stakeId = await addedStake("測試竹北支聯會", "north");

    expect(await saveStake(headAdmin, { id: stakeId, nameZh: "測試竹北支聯會", nameEn: "", region: "central", position: "" })).toEqual({
      ok: true,
      id: stakeId,
    });
    expect((await getStakeDirectory(headAdmin)).stakes.find((stake) => stake.id === stakeId)).toMatchObject({ region: "central" });
  });

  it("修改時沒帶區就不改；帶了不認得的區時擋下", async () => {
    const stakeId = await addedStake("測試竹北支聯會", "north");

    await saveStake(headAdmin, { id: stakeId, nameZh: "測試竹北支聯會", nameEn: "", position: "" });
    expect(await saveStake(headAdmin, { id: stakeId, nameZh: "測試竹北支聯會", nameEn: "", region: "east", position: "" })).toEqual({
      ok: false,
      error: "region_required",
    });
    expect((await getStakeDirectory(headAdmin)).stakes.find((stake) => stake.id === stakeId)).toMatchObject({ region: "north" });
  });
});

describe("停用與刪除", () => {
  it("停用的支會不出現在報名表，後台名單照常列出；可以重新啟用", async () => {
    const stakeId = await addedStake("測試竹北支聯會");
    const oldWard = await addedWard(stakeId, "測試竹北一支會", "1");
    const newWard = await addedWard(stakeId, "測試竹北二支會", "2");

    expect(await setUnitActive(headAdmin, "ward", oldWard, false)).toEqual({ ok: true });

    const listed = async () =>
      (await getRegistrationOptions(anonClient(), "zh")).stakes.find((stake) => stake.id === stakeId)?.wards.map((ward) => ward.id);
    expect(await listed()).toEqual([newWard]);
    const directory = await getStakeDirectory(headAdmin);
    expect(directory.stakes.find((stake) => stake.id === stakeId)?.wards).toEqual([
      expect.objectContaining({ id: oldWard, isActive: false }),
      expect.objectContaining({ id: newWard, isActive: true }),
    ]);

    expect(await setUnitActive(headAdmin, "ward", oldWard, true)).toEqual({ ok: true });
    expect(await listed()).toEqual([oldWard, newWard]);
  });

  it("停用的支聯會連同它的支會都不出現在報名表", async () => {
    const stakeId = await addedStake("測試竹北支聯會");
    await addedWard(stakeId, "測試竹北一支會");

    expect(await setUnitActive(headAdmin, "stake", stakeId, false)).toEqual({ ok: true });

    const options = await getRegistrationOptions(anonClient(), "zh");
    expect(options.stakes.map((stake) => stake.id)).not.toContain(stakeId);
  });

  it("沒有報名的支聯會可以刪除，它的支會一起刪掉", async () => {
    const stakeId = await addedStake("測試竹北支聯會");
    const wardId = await addedWard(stakeId, "測試竹北一支會");
    const otherWard = await addedWard(stakeId, "測試竹北二支會");

    expect(await deleteUnit(headAdmin, "ward", otherWard)).toEqual({ ok: true });
    expect((await getStakeDirectory(headAdmin)).stakes.find((stake) => stake.id === stakeId)?.wards.map((ward) => ward.id)).toEqual([
      wardId,
    ]);

    expect(await deleteUnit(headAdmin, "stake", stakeId)).toEqual({ ok: true });
    expect((await getStakeDirectory(headAdmin)).stakes.map((stake) => stake.id)).not.toContain(stakeId);
    expect(must(await admin.from("wards").select("id").eq("id", wardId))).toEqual([]);
  });

  it("報報組不能刪除", async () => {
    const stakeId = await addedStake("測試竹北支聯會");

    expect(await deleteUnit(registrationTeam, "stake", stakeId)).toEqual({ ok: false, error: "not_admin" });
    expect((await getStakeDirectory(headAdmin)).stakes.map((stake) => stake.id)).toContain(stakeId);
  });
});

describe("有報名的單位", () => {
  let previousCurrentIds: string[] = [];
  let conferenceId: string;
  let southVenueId: string;

  // 一個 2099 目前年度，只有一個南區場地：北區、中區報報組只能因為支聯會的區看到報名。
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
          announce_at: new Date(Date.now() - 2 * DAY).toISOString(),
          registration_opens_at: new Date(Date.now() + DAY).toISOString(),
          registration_closes_at: new Date(Date.now() + 2 * DAY).toISOString(),
          is_current: true,
        })
        .select("id")
        .single(),
    ).id;
    southVenueId = must(
      await admin.from("venues").insert({ conference_id: conferenceId, region: "south", name_zh: "測試台南教堂" }).select("id").single(),
    ).id;
  });

  afterEach(async () => {
    // 刪掉年度大會時，它的場地與報名一起刪除；之後外層的 afterEach 才刪得掉支聯會。
    must(await admin.from("conferences").delete().eq("id", conferenceId));
    if (previousCurrentIds.length > 0) {
      must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
    }
  });

  /** 直接寫入一筆報名（略過報名服務）。 */
  async function registered(name: string, stakeId: string, wardId: string) {
    must(
      await admin.from("registrations").insert({
        conference_id: conferenceId,
        venue_id: southVenueId,
        stake_id: stakeId,
        ward_id: wardId,
        name,
        phone: "0912345678",
        portrait_consented_at: new Date().toISOString(),
        locale: "zh",
      }),
    );
  }

  it("不能刪除，可以停用", async () => {
    const stakeId = await addedStake("測試竹東支聯會");
    const wardId = await addedWard(stakeId, "測試竹東支會");
    await registered("王小美", stakeId, wardId);

    expect(await deleteUnit(headAdmin, "ward", wardId)).toEqual({ ok: false, error: "in_use" });
    expect(await deleteUnit(headAdmin, "stake", stakeId)).toEqual({ ok: false, error: "in_use" });
    expect(await setUnitActive(headAdmin, "ward", wardId, false)).toEqual({ ok: true });
    expect(await setUnitActive(headAdmin, "stake", stakeId, false)).toEqual({ ok: true });
    expect((await getStakeDirectory(headAdmin)).stakes.find((stake) => stake.id === stakeId)).toMatchObject({ isActive: false });
  });

  it("重新劃分：停用舊支會、在新支聯會新增支會後，舊報名的支聯會與支會不變，原支聯會的報報組看得到、新支聯會的看不到", async () => {
    const oldStake = await addedStake("測試竹東支聯會", "north");
    const oldWard = await addedWard(oldStake, "測試峨眉支會");
    await registered("王小美", oldStake, oldWard);

    // 峨眉支會改劃到中區的新支聯會。
    const newStake = await addedStake("測試苗栗支聯會", "central");
    expect(await setUnitActive(headAdmin, "ward", oldWard, false)).toEqual({ ok: true });
    const newWard = await addedWard(newStake, "測試峨眉支會");

    const [item] = (await listRegistrations(headAdmin, "王小美")).items;
    expect(item).toMatchObject({ stakeName: "測試竹東支聯會", wardName: "測試峨眉支會" });
    expect((await listRegistrations(registrationTeam, "王小美")).items.map((row) => row.id)).toEqual([item.id]);
    expect((await listRegistrations(centralRegistrationTeam, "王小美")).items).toEqual([]);

    // 報名表只剩新的峨眉支會。
    const options = await getRegistrationOptions(anonClient(), "zh");
    const listed = options.stakes.flatMap((stake) => stake.wards.filter((ward) => ward.nameZh === "測試峨眉支會").map((ward) => ward.id));
    expect(listed).toEqual([newWard]);
  });

  it("支聯會改區後，報報組的範圍跟著換到新的區", async () => {
    const stakeId = await addedStake("測試竹東支聯會", "north");
    const wardId = await addedWard(stakeId, "測試峨眉支會");
    await registered("王小美", stakeId, wardId);

    await saveStake(headAdmin, { id: stakeId, nameZh: "測試竹東支聯會", nameEn: "", region: "central", position: "" });

    expect((await listRegistrations(registrationTeam, "王小美")).items).toEqual([]);
    expect((await listRegistrations(centralRegistrationTeam, "王小美")).items).toHaveLength(1);
  });
});
