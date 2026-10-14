import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, latestEmailTo, must, signedInClient } from "../../test/supabase";
import {
  addStaffMember,
  getStaffMember,
  listStaffMembers,
  removeStaffMember,
  requestSignInLink,
  updateStaffMember,
} from "./staff";

const admin = adminClient();

async function accountExists(email: string) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.some((user) => user.email === email);
}

describe("後台登入", () => {
  it("未受邀的 Email 要登入連結時，不寄信也不建立帳號，畫面上看不出差別", async () => {
    const result = await requestSignInLink(anonClient(), "stranger@example.com");

    expect(result).toEqual({ ok: true });
    expect(await accountExists("stranger@example.com")).toBe(false);
  });

  it("已有帳號的 Email 收到登入連結，連到後台的登入確認頁", async () => {
    const user = must(await admin.auth.admin.createUser({ email: "invited@example.com", email_confirm: true })).user;
    try {
      // 大小寫、前後空白不同也算同一個 Email。
      expect(await requestSignInLink(anonClient(), "  Invited@Example.com ")).toEqual({ ok: true });

      const email = await latestEmailTo("invited@example.com");
      expect(email?.html).toMatch(/\/staff\/auth\/confirm\?token_hash=[^&"]+&type=email/);
    } finally {
      must(await admin.auth.admin.deleteUser(user.id));
    }
  });

  it("未受邀的 Email 不能自己註冊", async () => {
    const { error } = await anonClient().auth.signUp({ email: "signup@example.com", password: "a-long-password" });

    expect(error).not.toBeNull();
    expect(await accountExists("signup@example.com")).toBe(false);
  });

  it("Email 格式不對時要求重填", async () => {
    expect(await requestSignInLink(anonClient(), "not-an-email")).toEqual({ ok: false, error: "email_invalid" });
  });
});

describe("工作人員帳號", () => {
  let venueId: string;
  let stakeId: string;
  let headAdmin: SupabaseClient;
  const createdStakeIds: string[] = [];

  // 每個測試有一位總管理員（第一位總管理員依 README 直接寫進資料表）、一個場地、一個支聯會；測完全部刪掉。
  beforeEach(async () => {
    venueId = must(await admin.from("venues").select("id").limit(1).single()).id;
    stakeId = must(
      await admin.from("stakes").insert({ name_zh: "測試帳號支聯會" }).select("id").single(),
    ).id;
    createdStakeIds.push(stakeId);

    const user = must(await admin.auth.admin.createUser({ email: "head@example.com", email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin" }));
    headAdmin = await signedInClient("head@example.com");
  });

  afterEach(async () => {
    // 工作人員的登入帳號要先移出名單才能刪除。
    must(await admin.from("staff_members").delete().not("user_id", "is", null));
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
    must(await admin.from("stakes").delete().in("id", createdStakeIds.splice(0)));
  });

  const add = (session: SupabaseClient, input: Parameters<typeof addStaffMember>[1]) =>
    addStaffMember({ session, authAdmin: admin }, input);

  it("總管理員新增教堂承辦後，她可以用那個 Email 登入，角色與負責場地都對", async () => {
    const result = await add(headAdmin, { email: "Venue@Example.com ", role: "venue_staff", venueId, stakeId: null });
    expect(result).toEqual({ ok: true });

    const venueStaff = await signedInClient("venue@example.com");
    expect(await getStaffMember(venueStaff)).toMatchObject({
      email: "venue@example.com",
      role: "venue_staff",
      venueId,
      stakeId: null,
    });
    expect((await listStaffMembers(headAdmin)).map((member) => [member.email, member.role])).toEqual([
      ["head@example.com", "admin"],
      ["venue@example.com", "venue_staff"],
    ]);
  });

  it("有登入帳號但不在工作人員名單裡的人不是工作人員；沒登入的訪客也不是", async () => {
    must(await admin.auth.admin.createUser({ email: "nobody@example.com", email_confirm: true }));

    expect(await getStaffMember(await signedInClient("nobody@example.com"))).toBeNull();
    expect(await getStaffMember(anonClient())).toBeNull();
  });

  it("承辦人員不能新增工作人員，也不會因此多出登入帳號", async () => {
    await add(headAdmin, { email: "stake@example.com", role: "stake_staff", venueId: null, stakeId });
    const stakeStaff = await signedInClient("stake@example.com");

    const result = await add(stakeStaff, { email: "friend@example.com", role: "admin", venueId: null, stakeId: null });

    expect(result).toEqual({ ok: false, error: "not_admin" });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("friend@example.com");
    await expect(listStaffMembers(stakeStaff)).rejects.toThrow();
  });

  it("角色和負責範圍不相符時不能新增，也不留下登入帳號", async () => {
    // 教堂承辦一定要有場地，不能是支聯會。
    const result = await add(headAdmin, { email: "wrong@example.com", role: "venue_staff", venueId: null, stakeId });

    expect(result).toEqual({ ok: false, error: "scope_invalid" });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("wrong@example.com");
  });

  it("同一個 Email 不能新增兩次", async () => {
    await add(headAdmin, { email: "twice@example.com", role: "stake_staff", venueId: null, stakeId });

    expect(await add(headAdmin, { email: "twice@example.com", role: "admin", venueId: null, stakeId: null })).toEqual({
      ok: false,
      error: "already_staff",
    });
  });

  it("總管理員可以改工作人員的角色與負責範圍", async () => {
    await add(headAdmin, { email: "move@example.com", role: "stake_staff", venueId: null, stakeId });
    const userId = (await listStaffMembers(headAdmin)).find((member) => member.email === "move@example.com")!.userId;

    expect(await updateStaffMember(headAdmin, { userId, role: "venue_staff", venueId, stakeId: null })).toEqual({
      ok: true,
    });

    expect(await getStaffMember(await signedInClient("move@example.com"))).toMatchObject({
      role: "venue_staff",
      venueId,
      stakeId: null,
    });
  });

  it("移除工作人員後，她的登入帳號也一起刪除，不能再登入", async () => {
    await add(headAdmin, { email: "leaving@example.com", role: "stake_staff", venueId: null, stakeId });
    const leaving = await signedInClient("leaving@example.com");
    const userId = (await getStaffMember(leaving))!.userId;

    expect(await removeStaffMember({ session: headAdmin, authAdmin: admin }, userId)).toEqual({ ok: true });

    expect(await getStaffMember(leaving)).toBeNull();
    expect((await listStaffMembers(headAdmin)).map((member) => member.email)).toEqual(["head@example.com"]);
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("leaving@example.com");
  });

  it("最後一位總管理員不能被移除，也不能改成其他角色", async () => {
    const userId = (await getStaffMember(headAdmin))!.userId;

    expect(await removeStaffMember({ session: headAdmin, authAdmin: admin }, userId)).toEqual({
      ok: false,
      error: "last_admin",
    });
    expect(await updateStaffMember(headAdmin, { userId, role: "venue_staff", venueId, stakeId: null })).toEqual({
      ok: false,
      error: "last_admin",
    });
    expect(await getStaffMember(headAdmin)).toMatchObject({ role: "admin" });
  });

  it("承辦人員不能直接寫入工作人員名單把自己升成總管理員", async () => {
    await add(headAdmin, { email: "sneaky@example.com", role: "stake_staff", venueId: null, stakeId });
    const sneaky = await signedInClient("sneaky@example.com");
    const userId = (await getStaffMember(sneaky))!.userId;

    await sneaky.from("staff_members").update({ role: "admin", stake_id: null }).eq("user_id", userId);
    await sneaky.rpc("update_staff_member", { p_user_id: userId, p_role: "admin", p_venue_id: null, p_stake_id: null });

    expect(await getStaffMember(sneaky)).toMatchObject({ role: "stake_staff" });
  });

  it("總管理員的登入帳號不能繞過名單直接刪除，免得系統沒有總管理員", async () => {
    const userId = (await getStaffMember(headAdmin))!.userId;

    expect((await admin.auth.admin.deleteUser(userId)).error).not.toBeNull();
    expect(await getStaffMember(headAdmin)).toMatchObject({ role: "admin" });
  });

  it("訪客與承辦人員不能直接呼叫工作人員的內部檢查", async () => {
    await add(headAdmin, { email: "probe@example.com", role: "stake_staff", venueId: null, stakeId });
    const probe = await signedInClient("probe@example.com");

    for (const client of [anonClient(), probe]) {
      const scope = await client.rpc("check_staff_scope", { p_role: "venue_staff", p_venue_id: venueId, p_stake_id: null });
      expect(scope.error?.code).toBe("42501");
      const another = await client.rpc("ensure_another_admin", { p_user_id: stakeId });
      expect(another.error?.code).toBe("42501");
    }
  });
});
