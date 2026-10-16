import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { adminClient, anonClient, databaseClient, latestEmailTo, must, signedInClient } from "../../test/supabase";
import {
  addStaffMember,
  getStaffMember,
  listStaffMembers,
  removeStaffMember,
  requestSignInLink,
  updateStaffMember,
  type StaffScope,
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
  let headAdmin: SupabaseClient;

  // 每個測試有一位總管理員（第一位總管理員依 README 直接寫進資料表）；測完全部刪掉。
  beforeEach(async () => {
    const user = must(await admin.auth.admin.createUser({ email: "head@example.com", email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin" }));
    headAdmin = await signedInClient("head@example.com");
  });

  afterEach(async () => {
    // 工作人員的登入帳號要先移出名單才能刪除。
    must(await admin.from("staff_members").delete().not("user_id", "is", null));
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  });

  const add = (session: SupabaseClient, input: Parameters<typeof addStaffMember>[1]) =>
    addStaffMember({ session, authAdmin: admin }, input);

  it("總管理員新增課務組後，她可以用那個 Email 登入，角色與負責的區都對", async () => {
    const result = await add(headAdmin, { email: "Course@Example.com ", name: "測試姊妹", role: "course_team", region: "central" });
    expect(result).toEqual({ ok: true });

    const course = await signedInClient("course@example.com");
    expect(await getStaffMember(course)).toMatchObject({
      email: "course@example.com",
      role: "course_team",
      region: "central",
    });
    expect((await listStaffMembers(headAdmin)).map((member) => [member.email, member.role, member.region])).toEqual([
      ["head@example.com", "admin", null],
      ["course@example.com", "course_team", "central"],
    ]);
  });

  it("名字由總管理員填，前後空白去掉；登入後看得到自己的名字", async () => {
    await add(headAdmin, { email: "lin@example.com", name: "  林姊妹 ", role: "course_team", region: "north" });

    expect(await getStaffMember(await signedInClient("lin@example.com"))).toMatchObject({ name: "林姊妹" });
    const userId = (await listStaffMembers(headAdmin)).find((member) => member.email === "lin@example.com")!.userId;
    expect(
      await updateStaffMember(headAdmin, { userId, name: "林春妙", role: "course_team", region: "north" }),
    ).toEqual({ ok: true });
    expect((await listStaffMembers(headAdmin)).find((member) => member.userId === userId)?.name).toBe("林春妙");
  });

  it.each([
    ["空白", "  "],
    ["超過 50 個字", "林".repeat(51)],
  ])("名字%s時不能新增或修改", async (_, name) => {
    expect(await add(headAdmin, { email: "noname@example.com", name, role: "admin", region: null })).toEqual({
      ok: false,
      error: "name_invalid",
    });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("noname@example.com");

    const userId = (await getStaffMember(headAdmin))!.userId;
    expect(await updateStaffMember(headAdmin, { userId, name, role: "admin", region: null })).toEqual({
      ok: false,
      error: "name_invalid",
    });
    // 直接呼叫資料庫函式也一樣。
    const direct = await headAdmin.rpc("update_staff_member", {
      p_user_id: userId,
      p_name: name,
      p_role: "admin",
      p_region: null,
    });
    expect(direct.error?.message).toBe("name_invalid");
  });

  it("課務組、報報組不能自己改名字", async () => {
    await add(headAdmin, { email: "self@example.com", name: "原本的名字", role: "registration_team", region: null });
    const self = await signedInClient("self@example.com");
    const userId = (await getStaffMember(self))!.userId;

    await self.from("staff_members").update({ name: "自己改的" }).eq("user_id", userId);
    await self.rpc("update_staff_member", { p_user_id: userId, p_name: "自己改的", p_role: "registration_team", p_region: null });

    expect(await getStaffMember(self)).toMatchObject({ name: "原本的名字" });
  });

  it("報報組可以負責一區或全區", async () => {
    expect(await add(headAdmin, { email: "north@example.com", name: "測試姊妹", role: "registration_team", region: "north" })).toEqual({
      ok: true,
    });
    expect(await add(headAdmin, { email: "all@example.com", name: "測試姊妹", role: "registration_team", region: null })).toEqual({
      ok: true,
    });

    expect(await getStaffMember(await signedInClient("north@example.com"))).toMatchObject({ region: "north" });
    expect(await getStaffMember(await signedInClient("all@example.com"))).toMatchObject({
      role: "registration_team",
      region: null,
    });
  });

  it("有登入帳號但不在工作人員名單裡的人不是工作人員；沒登入的訪客也不是", async () => {
    must(await admin.auth.admin.createUser({ email: "nobody@example.com", email_confirm: true }));

    expect(await getStaffMember(await signedInClient("nobody@example.com"))).toBeNull();
    expect(await getStaffMember(anonClient())).toBeNull();
  });

  it("課務組、報報組不能新增工作人員，也不會因此多出登入帳號", async () => {
    await add(headAdmin, { email: "report@example.com", name: "測試姊妹", role: "registration_team", region: null });
    const report = await signedInClient("report@example.com");

    const result = await add(report, { email: "friend@example.com", name: "測試姊妹", role: "admin", region: null });

    expect(result).toEqual({ ok: false, error: "not_admin" });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("friend@example.com");
    await expect(listStaffMembers(report)).rejects.toThrow();
  });

  it.each([
    ["課務組沒有選區", { role: "course_team", region: null }],
    ["總管理員選了區", { role: "admin", region: "north" }],
    ["不認得的區", { role: "registration_team", region: "east" }],
  ] as const)("角色和負責範圍不相符時不能新增，也不留下登入帳號：%s", async (_, scope) => {
    const result = await add(headAdmin, { email: "wrong@example.com", name: "測試姊妹", ...(scope as StaffScope) });

    expect(result).toEqual({ ok: false, error: "scope_invalid" });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((user) => user.email)).not.toContain("wrong@example.com");
  });

  it("資料庫也擋下角色和負責範圍不相符的寫入", async () => {
    for (const [role, region] of [
      ["course_team", null],
      ["admin", "north"],
      ["registration_team", "east"],
    ]) {
      const { error } = await headAdmin.rpc("add_staff_member", {
        p_email: "head@example.com",
        p_name: "測試姊妹",
        p_role: role,
        p_region: region,
      });
      expect(error?.message).toBe("scope_invalid");
    }
  });

  it("同一個 Email 不能新增兩次", async () => {
    await add(headAdmin, { email: "twice@example.com", name: "測試姊妹", role: "registration_team", region: "south" });

    expect(await add(headAdmin, { email: "twice@example.com", name: "測試姊妹", role: "admin", region: null })).toEqual({
      ok: false,
      error: "already_staff",
    });
  });

  it("總管理員可以改工作人員的角色與負責範圍", async () => {
    await add(headAdmin, { email: "move@example.com", name: "測試姊妹", role: "registration_team", region: null });
    const userId = (await listStaffMembers(headAdmin)).find((member) => member.email === "move@example.com")!.userId;

    expect(await updateStaffMember(headAdmin, { userId, name: "測試姊妹", role: "course_team", region: "south" })).toEqual({
      ok: true,
    });

    expect(await getStaffMember(await signedInClient("move@example.com"))).toMatchObject({
      role: "course_team",
      region: "south",
    });
  });

  it("移除工作人員後，她的登入帳號也一起刪除，不能再登入", async () => {
    await add(headAdmin, { email: "leaving@example.com", name: "測試姊妹", role: "registration_team", region: "north" });
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
    expect(await updateStaffMember(headAdmin, { userId, name: "測試姊妹", role: "course_team", region: "north" })).toEqual({
      ok: false,
      error: "last_admin",
    });
    expect(await getStaffMember(headAdmin)).toMatchObject({ role: "admin" });
  });

  it("課務組、報報組不能直接寫入工作人員名單把自己升成總管理員或改成全區", async () => {
    await add(headAdmin, { email: "sneaky@example.com", name: "測試姊妹", role: "course_team", region: "north" });
    const sneaky = await signedInClient("sneaky@example.com");
    const userId = (await getStaffMember(sneaky))!.userId;

    await sneaky.from("staff_members").update({ role: "admin", region: null }).eq("user_id", userId);
    await sneaky.from("staff_members").update({ role: "registration_team", region: null }).eq("user_id", userId);
    await sneaky.rpc("update_staff_member", { p_user_id: userId, p_name: "測試", p_role: "admin", p_region: null });

    expect(await getStaffMember(sneaky)).toMatchObject({ role: "course_team", region: "north" });
  });

  it("總管理員的登入帳號不能繞過名單直接刪除，免得系統沒有總管理員", async () => {
    const userId = (await getStaffMember(headAdmin))!.userId;

    expect((await admin.auth.admin.deleteUser(userId)).error).not.toBeNull();
    expect(await getStaffMember(headAdmin)).toMatchObject({ role: "admin" });
  });

  it("訪客、課務組、報報組不能直接呼叫工作人員的內部檢查", async () => {
    await add(headAdmin, { email: "probe@example.com", name: "測試姊妹", role: "registration_team", region: null });
    const probe = await signedInClient("probe@example.com");

    for (const client of [anonClient(), probe]) {
      const scope = await client.rpc("check_staff_scope", { p_role: "course_team", p_region: "north" });
      expect(scope.error?.code).toBe("42501");
      const another = await client.rpc("ensure_another_admin", { p_user_id: crypto.randomUUID() });
      expect(another.error?.code).toBe("42501");
    }
  });

  it("總管理員的登入帳號不能用軟刪除停用，免得留下登入不了的總管理員", async () => {
    const userId = (await getStaffMember(headAdmin))!.userId;

    expect((await admin.auth.admin.deleteUser(userId, true)).error).not.toBeNull();
    expect(await getStaffMember(await signedInClient("head@example.com"))).toMatchObject({ role: "admin" });
  });

  /**
   * 甲在直接連線的交易裡做 first，還沒提交時送出乙（second），等乙卡在甲後面再讓甲提交，回傳乙的結果。
   * 沒有排隊的話乙不會卡住，測試直接失敗。
   */
  async function whileUncommitted<T>(
    first: (tx: TransactionSql) => Promise<unknown>,
    second: () => PromiseLike<T>,
  ): Promise<T> {
    const [a, watcher] = [databaseClient(), databaseClient()];
    let release!: () => void;
    const mayCommit = new Promise<void>((resolve) => (release = resolve));
    let started!: (pid: number) => void;
    const firstStarted = new Promise<number>((resolve) => (started = resolve));
    const firstDone = a.begin(async (tx) => {
      await first(tx);
      const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      started(pid);
      await mayCommit;
    });
    try {
      const firstPid = await firstStarted;
      // supabase-js 的請求要 then 才會送出，這裡立刻送。
      const secondDone = Promise.resolve(second());
      for (let waited = 0; ; waited += 50) {
        const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
          select exists (
            select 1 from pg_stat_activity where ${firstPid}::int = any(pg_blocking_pids(pid))
          ) as blocked`;
        if (blocked) break;
        if (waited > 3000) throw new Error("乙沒有卡在甲後面");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      release();
      await firstDone;
      return await secondDone;
    } finally {
      release();
      await firstDone.catch(() => {});
      await Promise.all([a.end(), watcher.end()]);
    }
  }

  it("正在被移除的總管理員，不能趁移除還沒完成時把自己加回去", async () => {
    await add(headAdmin, { email: "second@example.com", name: "測試姊妹", role: "admin", region: null });
    const second = await signedInClient("second@example.com");
    const headId = (await getStaffMember(headAdmin))!.userId;
    const secondId = (await getStaffMember(second))!.userId;

    // 甲（head）移除乙（second），交易還沒提交時，乙把自己的 Email 重新加成總管理員。
    const readding = await whileUncommitted(
      async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: headId, role: "authenticated" })}, true)`;
        await tx`select public.remove_staff_member(${secondId})`;
      },
      () =>
        second.rpc("add_staff_member", {
          p_email: "second@example.com",
          p_role: "admin",
          p_name: "測試姊妹",
          p_region: null,
        }),
    );

    expect(readding.error?.message).toBe("not_admin");
    expect(await getStaffMember(second)).toBeNull();
  });

  it("登入帳號正在被軟刪除時，不能同時把她加成工作人員", async () => {
    const pending = must(await admin.auth.admin.createUser({ email: "pending@example.com", email_confirm: true })).user;

    // 和 Supabase 的軟刪除一樣：設定 deleted_at、改寫 Email。還沒提交時，總管理員新增她。
    const adding = await whileUncommitted(
      (tx) => tx`update auth.users set deleted_at = now(), email = ${`${pending.id}@deleted.invalid`}
        where id = ${pending.id}`,
      () =>
        headAdmin.rpc("add_staff_member", {
          p_email: "pending@example.com",
          p_role: "admin",
          p_name: "測試姊妹",
          p_region: null,
        }),
    );

    expect(adding.error?.message).toBe("account_missing");
    expect((await listStaffMembers(headAdmin)).map((member) => member.email)).toEqual(["head@example.com"]);
  });

  it("新增工作人員還沒完成時，她的登入帳號不能同時被軟刪除", async () => {
    const pending = must(await admin.auth.admin.createUser({ email: "pending@example.com", email_confirm: true })).user;
    const headId = (await getStaffMember(headAdmin))!.userId;

    const deleting = await whileUncommitted(
      async (tx) => {
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: headId, role: "authenticated" })}, true)`;
        await tx`select public.add_staff_member('pending@example.com', '測試姊妹', 'admin', null)`;
      },
      () => admin.auth.admin.deleteUser(pending.id, true),
    );

    expect(deleting.error).not.toBeNull();
    expect(await getStaffMember(await signedInClient("pending@example.com"))).toMatchObject({ role: "admin" });
  });
});
