import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { submitWhileHolding } from "../../test/hold-transaction";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import {
  attachCommitteePhoto,
  deleteCommitteeItem,
  getPublicCommitteeMember,
  removeCommitteePhoto,
  getCommittee,
  listPublicCommitteeYears,
  moveCommitteeLink,
  roleLabel,
  saveCommitteeLink,
  saveCommitteeMember,
  changedTextPages,
  discardCommitteeTextDraft,
  getCommitteeTextDraft,
  publishCommitteeTexts,
  saveCommitteeTextDraft,
  saveMeeting,
  saveTeamMember,
  type CommitteeTextsInput,
  type MeetingInput,
  type TeamMemberInput,
} from "./committee";
import { COMMITTEE_PHOTO_BUCKET, committeePhotoPath } from "./committee-photos";
import { deleteUnit } from "./stakes";
import { copyConference } from "./years";

/*
 * 籌備委員會資訊（#45）。repo 是公開的，這裡一律用假名（測試甲、測試乙…），不寫真實姓名。
 */

const admin = adminClient();
const TABLES = ["committee_texts", "committee_meetings", "committee_links", "committee_team_members", "committee_members"];

let conferenceIds: string[] = [];
let conferenceId: string;
let stakes: { id: string; name: string; region: string }[];
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個 2099 年度（不是目前年度：籌備資料哪個年度都能編輯）、一位總管理員、一位課務組、一位報報組。
beforeEach(async () => {
  conferenceId = must(
    await admin.from("conferences").insert({ year: 2099, conference_date: "2099-05-15" }).select("id").single(),
  ).id;
  conferenceIds = [conferenceId];
  stakes = must(await admin.from("stakes").select("id, name_zh, region").order("position").order("id")).map((stake) => ({
    id: stake.id,
    name: stake.name_zh,
    region: stake.region,
  }));

  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "course@example.com", role: "course_team", region: "north" },
    { email: "report@example.com", role: "registration_team", region: null },
  ];
  for (const { email, ...scope } of staff) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
  }
  [headAdmin, courseTeam, registrationTeam] = await Promise.all(staff.map(({ email }) => signedInClient(email)));
});

afterEach(async () => {
  must(await admin.from("staff_members").delete().not("user_id", "is", null));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  // 刪掉年度大會時，它的籌備資料一起刪除。
  must(await admin.from("conferences").delete().in("id", conferenceIds));
});

const meeting = (changes: Partial<MeetingInput> = {}): MeetingInput => ({
  conferenceId,
  title: "第 1 次會議",
  meetingDate: "2099-01-10",
  url: "https://www.canva.com/design/example/view",
  note: "",
  ...changes,
});

const teamMember = (changes: Partial<TeamMemberInput> = {}): TeamMemberInput => ({
  conferenceId,
  team: "course",
  role: "lead",
  name: "測試甲",
  region: "north",
  stakeId: stakes[0].id,
  ...changes,
});

// 已經過去的年度（目前年度之前），公開頁面看得到（#74）。
async function pastConference(): Promise<string> {
  const id = must(
    await admin.from("conferences").insert({ year: 2001, conference_date: "2001-05-15" }).select("id").single(),
  ).id;
  conferenceIds.push(id);
  return id;
}

// 每一種資料各一筆。
async function fillCommittee(id: string) {
  await ok(publishTexts(headAdmin, { conferenceId: id, introduction: "大會簡介", chairMessage: "主席的話", memorandum: "備忘錄", executionPlan: "" }));
  await ok(saveMeeting(headAdmin, meeting({ conferenceId: id })));
  await ok(saveCommitteeLink(headAdmin, { conferenceId: id, title: "執行計畫", url: "https://example.com/plan" }));
  await ok(saveTeamMember(headAdmin, teamMember({ conferenceId: id })));
  await ok(saveCommitteeMember(headAdmin, { conferenceId: id, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: true, bio: "" }));
}

// 三個文字頁存成草稿再發布，大家才看得到（#76）。
async function publishTexts(client: SupabaseClient, input: CommitteeTextsInput) {
  const saved = await saveCommitteeTextDraft(client, input);
  if (!saved.ok) return saved;
  return publishCommitteeTexts(client, input.conferenceId, saved.revision);
}

async function ok<T extends { ok: boolean }>(result: Promise<T>): Promise<Extract<T, { ok: true }>> {
  const value = await result;
  if (!value.ok) throw new Error(`應該成功卻失敗：${JSON.stringify(value)}`);
  return value as Extract<T, { ok: true }>;
}

it("職務名稱依組別：總召團是總召、副總召，各組是組長、副組長", () => {
  expect(roleLabel("conveners", "lead")).toBe("總召");
  expect(roleLabel("conveners", "deputy")).toBe("副總召");
  expect(roleLabel("publicity", "lead")).toBe("組長");
  expect(roleLabel("publicity", "deputy")).toBe("副組長");
});

describe("讀取", () => {
  it("沒有任何資料的年度：文字頁是空的，各名單沒有人", async () => {
    const committee = await getCommittee(headAdmin, conferenceId);
    expect(committee).toEqual({
      introduction: "",
      chairMessage: "",
      memorandum: "",
      executionPlan: "",
      markdown: true,
      meetings: [],
      links: [],
      teamMembers: [],
      members: [],
    });
  });

  it("三種角色登入後都看得到所有內容", async () => {
    await ok(publishTexts(headAdmin, { conferenceId, introduction: "大會簡介", chairMessage: "主席的話", memorandum: "備忘錄", executionPlan: "" }));
    await ok(saveMeeting(headAdmin, meeting()));
    await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "執行計畫", url: "https://docs.google.com/spreadsheets/d/x" }));
    await ok(saveTeamMember(headAdmin, teamMember()));
    await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: true, bio: "" }));

    const expected = await getCommittee(headAdmin, conferenceId);
    expect(expected.introduction).toBe("大會簡介");
    expect(expected.chairMessage).toBe("主席的話");
    expect(expected.memorandum).toBe("備忘錄");
    expect(expected.meetings).toHaveLength(1);
    expect(expected.links).toHaveLength(1);
    expect(expected.teamMembers).toHaveLength(1);
    expect(expected.members).toHaveLength(1);
    expect(await getCommittee(courseTeam, conferenceId)).toEqual(expected);
    expect(await getCommittee(registrationTeam, conferenceId)).toEqual(expected);
  });

  it("未登入看得到過去年度的所有內容（#74）", async () => {
    const pastId = await pastConference();
    await fillCommittee(pastId);

    const expected = await getCommittee(headAdmin, pastId);
    expect(expected.teamMembers).toHaveLength(1);
    expect(await getCommittee(anonClient(), pastId)).toEqual(expected);
  });

  it("未登入看得到目前年度的所有內容（#74）", async () => {
    const current = must(await admin.from("conferences").select("id").eq("is_current", true).single()).id;
    try {
      await fillCommittee(current);
      const expected = await getCommittee(headAdmin, current);
      expect(expected.members).toHaveLength(1);
      expect(await getCommittee(anonClient(), current)).toEqual(expected);
    } finally {
      // 目前年度是共用的測試資料，不能整個刪掉，只刪這裡加的。
      for (const table of TABLES) must(await admin.from(table).delete().eq("conference_id", current));
    }
  });

  it("未登入看不到還沒到的年度（複製好的下一屆）", async () => {
    await fillCommittee(conferenceId);

    const visitor = anonClient();
    for (const table of TABLES) {
      const { data } = await visitor.from(table).select("*").eq("conference_id", conferenceId);
      expect(data ?? [], table).toEqual([]);
    }
  });

  it("未登入也看得到停用的支聯會名稱與區域", async () => {
    const pastId = await pastConference();
    const stake = must(
      await admin
        .from("stakes")
        .insert({ name_zh: "測試停用支聯會", region: "south", position: 999, is_active: false })
        .select("id")
        .single(),
    );
    try {
      await ok(saveTeamMember(headAdmin, teamMember({ conferenceId: pastId, stakeId: stake.id })));
      await ok(saveCommitteeMember(headAdmin, { conferenceId: pastId, name: "測試乙", stakeId: stake.id, reliefSocietyPresidency: false, bio: "" }));
      const { teamMembers, members } = await getCommittee(anonClient(), pastId);
      expect(teamMembers[0].stakeName).toBe("測試停用支聯會");
      expect(members[0]).toMatchObject({ stakeName: "測試停用支聯會", stakeRegion: "south" });
    } finally {
      for (const table of ["committee_team_members", "committee_members"]) {
        must(await admin.from(table).delete().eq("stake_id", stake.id));
      }
      must(await admin.from("stakes").delete().eq("id", stake.id));
    }
  });

  it("支聯會表的權限不放寬：未登入照樣讀不到停用的支聯會，名單用到的也一樣", async () => {
    const pastId = await pastConference();
    const stake = must(
      await admin
        .from("stakes")
        .insert({ name_zh: "測試停用支聯會", region: "south", position: 999, is_active: false })
        .select("id")
        .single(),
    );
    try {
      await ok(saveCommitteeMember(headAdmin, { conferenceId: pastId, name: "測試乙", stakeId: stake.id, reliefSocietyPresidency: false, bio: "" }));
      const { data } = await anonClient().from("stakes").select("id").eq("id", stake.id);
      expect(data).toEqual([]);
    } finally {
      must(await admin.from("committee_members").delete().eq("stake_id", stake.id));
      must(await admin.from("stakes").delete().eq("id", stake.id));
    }
  });

  it("未登入讀不到還沒到的年度名單用到哪些支聯會", async () => {
    await fillCommittee(conferenceId);
    const { data } = await anonClient().rpc("committee_stakes", { p_conference_id: conferenceId });
    expect(data).toEqual([]);
    const staff = await courseTeam.rpc("committee_stakes", { p_conference_id: conferenceId });
    expect(staff.data).toHaveLength(1);
  });

  it("公開的年度：目前與過去年度，新的在前；還沒到的年度不列出", async () => {
    const pastId = await pastConference();
    const current = must(await admin.from("conferences").select("id, year").eq("is_current", true).single());

    const years = await listPublicCommitteeYears(anonClient());
    expect(years).toEqual(
      expect.arrayContaining([
        { id: current.id, year: current.year, isCurrent: true },
        { id: pastId, year: 2001, isCurrent: false },
      ]),
    );
    expect(years.map((year) => year.id)).not.toContain(conferenceId);
    expect(years.map((year) => year.year)).toEqual([...years.map((year) => year.year)].sort((a, b) => b - a));
  });

  it("會議記錄依日期排列（同一天依標題）", async () => {
    await ok(saveMeeting(headAdmin, meeting({ title: "第 2 次會議", meetingDate: "2099-02-14" })));
    await ok(saveMeeting(headAdmin, meeting({ title: "備忘錄草案", meetingDate: "2098-12-01", url: "https://example.com/a", note: "草案" })));
    await ok(saveMeeting(headAdmin, meeting({ title: "第 1 次會議", meetingDate: "2099-01-10" })));

    const { meetings } = await getCommittee(courseTeam, conferenceId);
    expect(meetings.map((m) => [m.meetingDate, m.title])).toEqual([
      ["2098-12-01", "備忘錄草案"],
      ["2099-01-10", "第 1 次會議"],
      ["2099-02-14", "第 2 次會議"],
    ]);
    expect(meetings[0]).toMatchObject({ url: "https://example.com/a", note: "草案" });
  });

  it("工作團隊依組別與職務排序，附上支聯會名稱", async () => {
    await ok(saveTeamMember(headAdmin, teamMember({ team: "secretariat", role: "lead", name: "測試丙" })));
    await ok(saveTeamMember(headAdmin, teamMember({ team: "course", role: "deputy", name: "測試丁", region: "south" })));
    await ok(saveTeamMember(headAdmin, teamMember({ team: "conveners", role: "deputy", name: "測試戊", region: null })));
    await ok(saveTeamMember(headAdmin, teamMember({ team: "course", role: "lead", name: "測試己", stakeId: stakes[1].id })));
    await ok(saveTeamMember(headAdmin, teamMember({ team: "conveners", role: "lead", name: "測試庚", region: null })));

    const { teamMembers } = await getCommittee(registrationTeam, conferenceId);
    expect(teamMembers.map((m) => [m.team, m.role, m.name])).toEqual([
      ["conveners", "lead", "測試庚"],
      ["conveners", "deputy", "測試戊"],
      ["course", "lead", "測試己"],
      ["course", "deputy", "測試丁"],
      ["secretariat", "lead", "測試丙"],
    ]);
    expect(teamMembers[2]).toMatchObject({ region: "north", stakeId: stakes[1].id, stakeName: stakes[1].name });
    expect(teamMembers[0].region).toBeNull();
  });

  it("籌備委員依支聯會名單的順序排列，標示慈助會會長團", async () => {
    await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試丙", stakeId: stakes[2].id, reliefSocietyPresidency: true, bio: "" }));
    await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試甲", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }));
    await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: true, bio: "" }));

    const { members } = await getCommittee(courseTeam, conferenceId);
    expect(members.map((m) => [m.stakeName, m.name, m.reliefSocietyPresidency])).toEqual([
      [stakes[0].name, "測試乙", true],
      [stakes[0].name, "測試甲", false],
      [stakes[2].name, "測試丙", true],
    ]);
  });

  it("只讀到指定年度的資料", async () => {
    const otherId = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    conferenceIds.push(otherId);
    await ok(saveMeeting(headAdmin, meeting({ conferenceId: otherId, title: "別年的會議" })));
    expect((await getCommittee(headAdmin, conferenceId)).meetings).toEqual([]);
  });
});

describe("總管理員編輯", () => {
  it("文字頁可以修改，去掉頭尾空白", async () => {
    await ok(publishTexts(headAdmin, { conferenceId, introduction: " 舊的 ", chairMessage: "", memorandum: "", executionPlan: "" }));
    await ok(publishTexts(headAdmin, { conferenceId, introduction: "新的簡介\n第二段", chairMessage: " 主席 ", memorandum: "章程", executionPlan: "" }));
    expect(await getCommittee(headAdmin, conferenceId)).toMatchObject({
      introduction: "新的簡介\n第二段",
      chairMessage: "主席",
      memorandum: "章程",
    });
  });

  it("文字頁記得是不是 Markdown：改版前存的照純文字顯示，用新的編輯框存過就依樣式排版（#75）", async () => {
    expect((await getCommittee(headAdmin, conferenceId)).markdown).toBe(true);
    must(await admin.from("committee_texts").insert({ conference_id: conferenceId, introduction: "*舊的*", markdown: false }));
    expect(await getCommittee(anonClient(), conferenceId)).toMatchObject({ introduction: "", markdown: true });
    expect((await getCommittee(headAdmin, conferenceId)).markdown).toBe(false);
    await ok(publishTexts(headAdmin, { conferenceId, introduction: "*舊的*", chairMessage: "", memorandum: "", executionPlan: "" }));
    expect((await getCommittee(headAdmin, conferenceId)).markdown).toBe(true);
  });

  it("會議記錄可以修改與刪除", async () => {
    const { id } = await ok(saveMeeting(headAdmin, meeting()));
    await ok(saveMeeting(headAdmin, meeting({ id, title: "第 1 次會議（修正）", note: " 改了日期 ", meetingDate: "2099-01-11" })));
    expect((await getCommittee(headAdmin, conferenceId)).meetings).toEqual([
      { id, title: "第 1 次會議（修正）", meetingDate: "2099-01-11", url: meeting().url, note: "改了日期" },
    ]);

    await ok(deleteCommitteeItem(headAdmin, "meeting", id));
    expect((await getCommittee(headAdmin, conferenceId)).meetings).toEqual([]);
  });

  it("會議記錄要有標題、真的日期與 http(s) 連結", async () => {
    expect(await saveMeeting(headAdmin, meeting({ title: "  " }))).toEqual({ ok: false, error: "title_required" });
    expect(await saveMeeting(headAdmin, meeting({ meetingDate: "2099-02-30" }))).toEqual({ ok: false, error: "date_invalid" });
    for (const url of ["", "javascript:alert(1)", "/staff", "https://", "https://@/", "https://:", "https://user@/", "https://example.com:abc/", "https://example.com/a b"]) {
      expect(await saveMeeting(headAdmin, meeting({ url })), url).toEqual({ ok: false, error: "url_invalid" });
    }
  });

  it("重要連結新增在最後，可以修改、往前往後移、刪除", async () => {
    const a = await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "執行計畫", url: "https://example.com/plan" }));
    const b = await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "預算表", url: "https://example.com/budget" }));
    const c = await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "交接清單", url: "https://example.com/handover" }));
    const titles = async () => (await getCommittee(headAdmin, conferenceId)).links.map((link) => link.title);
    expect(await titles()).toEqual(["執行計畫", "預算表", "交接清單"]);

    await ok(moveCommitteeLink(headAdmin, c.id, "up"));
    expect(await titles()).toEqual(["執行計畫", "交接清單", "預算表"]);
    await ok(moveCommitteeLink(headAdmin, a.id, "down"));
    expect(await titles()).toEqual(["交接清單", "執行計畫", "預算表"]);
    // 已經在最前面：不動。
    await ok(moveCommitteeLink(headAdmin, c.id, "up"));
    expect(await titles()).toEqual(["交接清單", "執行計畫", "預算表"]);

    await ok(saveCommitteeLink(headAdmin, { id: b.id, conferenceId, title: "預算表 v2", url: "https://example.com/budget2" }));
    await ok(deleteCommitteeItem(headAdmin, "link", a.id));
    expect((await getCommittee(headAdmin, conferenceId)).links).toEqual([
      { id: c.id, title: "交接清單", url: "https://example.com/handover" },
      { id: b.id, title: "預算表 v2", url: "https://example.com/budget2" },
    ]);
  });

  it("重要連結要有標題與 http(s) 連結", async () => {
    expect(await saveCommitteeLink(headAdmin, { conferenceId, title: "", url: "https://example.com" })).toEqual({
      ok: false,
      error: "title_required",
    });
    expect(await saveCommitteeLink(headAdmin, { conferenceId, title: "x", url: "ftp://example.com" })).toEqual({
      ok: false,
      error: "url_invalid",
    });
  });

  it("工作團隊可以修改與刪除；組別、職務、區、支聯會要對", async () => {
    const { id } = await ok(saveTeamMember(headAdmin, teamMember()));
    await ok(saveTeamMember(headAdmin, teamMember({ id, name: "測試甲改", role: "deputy", region: null })));
    expect((await getCommittee(headAdmin, conferenceId)).teamMembers).toEqual([
      {
        id,
        team: "course",
        role: "deputy",
        name: "測試甲改",
        region: null,
        stakeId: stakes[0].id,
        stakeName: stakes[0].name,
      },
    ]);

    expect(await saveTeamMember(headAdmin, teamMember({ name: " " }))).toEqual({ ok: false, error: "name_required" });
    expect(await saveTeamMember(headAdmin, teamMember({ team: "choir" }))).toEqual({ ok: false, error: "team_invalid" });
    expect(await saveTeamMember(headAdmin, teamMember({ role: "member" }))).toEqual({ ok: false, error: "role_invalid" });
    expect(await saveTeamMember(headAdmin, teamMember({ region: "east" }))).toEqual({ ok: false, error: "region_invalid" });
    expect(await saveTeamMember(headAdmin, teamMember({ stakeId: "" }))).toEqual({ ok: false, error: "stake_required" });

    await ok(deleteCommitteeItem(headAdmin, "team_member", id));
    expect((await getCommittee(headAdmin, conferenceId)).teamMembers).toEqual([]);
  });

  it("籌備委員可以修改與刪除；要有姓名與支聯會", async () => {
    const { id } = await ok(
      saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }),
    );
    await ok(
      saveCommitteeMember(headAdmin, {
        id,
        conferenceId,
        name: "測試乙改",
        stakeId: stakes[1].id,
        reliefSocietyPresidency: true,
        bio: " 我是測試乙。\n加入教會十年。 ",
      }),
    );
    expect((await getCommittee(headAdmin, conferenceId)).members).toEqual([
      {
        id,
        name: "測試乙改",
        stakeId: stakes[1].id,
        stakeName: stakes[1].name,
        stakeRegion: stakes[1].region,
        reliefSocietyPresidency: true,
        bio: "我是測試乙。\n加入教會十年。",
        photoPath: null,
        photoUrl: null,
      },
    ]);

    expect(
      await saveCommitteeMember(headAdmin, { conferenceId, name: "", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }),
    ).toEqual({ ok: false, error: "name_required" });
    expect(await saveCommitteeMember(headAdmin, { conferenceId, name: "測試", stakeId: "", reliefSocietyPresidency: false, bio: "" })).toEqual({
      ok: false,
      error: "stake_required",
    });

    await ok(deleteCommitteeItem(headAdmin, "member", id));
    expect((await getCommittee(headAdmin, conferenceId)).members).toEqual([]);
  });

  it("修改或刪除已經不在的項目：找不到", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await saveMeeting(headAdmin, meeting({ id: missing }))).toEqual({ ok: false, error: "not_found" });
    expect(await deleteCommitteeItem(headAdmin, "member", missing)).toEqual({ ok: false, error: "not_found" });
    expect(await moveCommitteeLink(headAdmin, missing, "up")).toEqual({ ok: false, error: "not_found" });
    expect(await saveMeeting(headAdmin, meeting({ conferenceId: missing }))).toEqual({ ok: false, error: "not_found" });
    expect(await saveCommitteeTextDraft(headAdmin, { conferenceId: missing, introduction: "", chairMessage: "", memorandum: "", executionPlan: "" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("文字頁的草稿與發布（#76）", () => {
  const texts = (changes: Partial<CommitteeTextsInput> = {}): CommitteeTextsInput => ({
    conferenceId,
    introduction: "已發布的簡介",
    chairMessage: "已發布的主席的話",
    memorandum: "已發布的備忘錄",
    executionPlan: "已發布的執行計畫",
    ...changes,
  });

  // 目前年度之前的年度，公開頁面看得到。
  beforeEach(async () => {
    conferenceId = await pastConference();
    await ok(publishTexts(headAdmin, texts()));
  });

  it("存草稿後，公開頁面與課務組、報報組看到的仍是已發布版本；草稿只有總管理員讀得到", async () => {
    await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: " 草稿的簡介 " })));

    for (const client of [headAdmin, courseTeam, registrationTeam, anonClient()]) {
      expect((await getCommittee(client, conferenceId)).introduction).toBe("已發布的簡介");
    }
    expect(await getCommitteeTextDraft(headAdmin, conferenceId)).toMatchObject({
      introduction: "草稿的簡介",
      chairMessage: "已發布的主席的話",
      memorandum: "已發布的備忘錄",
    });
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await getCommitteeTextDraft(client, conferenceId)).toBeNull();
      // 直接讀資料表也讀不到（權限規則）。
      const { data } = await client.from("committee_text_drafts").select("*").eq("conference_id", conferenceId);
      expect(data ?? []).toEqual([]);
    }
  });

  it("舊版網站（三頁版）存草稿：沿用已發布、或草稿裡原本的執行計畫，發布後不會被清掉（Codex 審查）", async () => {
    const saveOld = async () => {
      const { data, error } = await headAdmin.rpc("save_committee_text_draft", {
        p_conference_id: conferenceId,
        p_introduction: "舊版存的簡介",
        p_chair_message: "",
        p_memorandum: "",
      });
      expect(error).toBeNull();
      return data as string;
    };

    await ok(publishCommitteeTexts(headAdmin, conferenceId, await saveOld()));
    expect(await getCommittee(headAdmin, conferenceId)).toMatchObject({
      introduction: "舊版存的簡介",
      executionPlan: "已發布的執行計畫",
    });

    await ok(saveCommitteeTextDraft(headAdmin, texts({ executionPlan: "草稿的執行計畫" })));
    await ok(publishCommitteeTexts(headAdmin, conferenceId, await saveOld()));
    expect((await getCommittee(headAdmin, conferenceId)).executionPlan).toBe("草稿的執行計畫");
  });

  it("舊版網站存草稿時正好有人在發布：等發布做完才讀執行計畫，不會用舊的開草稿（Codex 審查）", async () => {
    const { revision } = await ok(saveCommitteeTextDraft(headAdmin, texts({ executionPlan: "新的執行計畫" })));
    const adminId = must(await admin.from("staff_members").select("user_id").eq("role", "admin").single()).user_id;

    // 另一位總管理員的發布做到一半（交易還沒結束）時，舊版網站存草稿。
    const saved = await submitWhileHolding(
      async (tx) => {
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: adminId, role: "authenticated" })}, true)`;
        await tx`set local role authenticated`;
        await tx`select public.publish_committee_texts(${conferenceId}, ${revision})`;
      },
      // 要 await 才會真的送出。
      async () =>
        await headAdmin.rpc("save_committee_text_draft", {
          p_conference_id: conferenceId,
          p_introduction: "舊版存的簡介",
          p_chair_message: "",
          p_memorandum: "",
        }),
      undefined,
      "save_committee_text_draft",
    );
    expect(saved.error).toBeNull();

    await ok(publishCommitteeTexts(headAdmin, conferenceId, saved.data as string));
    expect(await getCommittee(headAdmin, conferenceId)).toMatchObject({
      introduction: "舊版存的簡介",
      executionPlan: "新的執行計畫",
    });
  });

  it("沒有草稿時讀到的是空的", async () => {
    expect(await getCommitteeTextDraft(headAdmin, conferenceId)).toBeNull();
  });

  it("發布後大家立即看到新版本，草稿清掉", async () => {
    const { revision } = await ok(saveCommitteeTextDraft(headAdmin, texts({ memorandum: "# 新的備忘錄", executionPlan: "## 新的執行計畫" })));
    await ok(publishCommitteeTexts(headAdmin, conferenceId, revision));

    for (const client of [headAdmin, courseTeam, registrationTeam, anonClient()]) {
      expect(await getCommittee(client, conferenceId)).toMatchObject({
        memorandum: "# 新的備忘錄",
        executionPlan: "## 新的執行計畫",
        markdown: true,
      });
    }
    expect(await getCommitteeTextDraft(headAdmin, conferenceId)).toBeNull();
    // 已經發布過了，再按一次發布：沒有草稿。
    expect(await publishCommitteeTexts(headAdmin, conferenceId, revision)).toEqual({ ok: false, error: "no_draft" });
  });

  it("預覽之後草稿又被存過（例如另一位總管理員）：不發布，請她重新預覽", async () => {
    const previewed = await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "甲的草稿" })));
    const other = await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "乙的草稿" })));
    expect(other.revision).not.toBe(previewed.revision);

    expect(await publishCommitteeTexts(headAdmin, conferenceId, previewed.revision)).toEqual({
      ok: false,
      error: "draft_changed",
    });
    expect((await getCommittee(anonClient(), conferenceId)).introduction).toBe("已發布的簡介");
    expect((await getCommitteeTextDraft(headAdmin, conferenceId))?.introduction).toBe("乙的草稿");

    await ok(publishCommitteeTexts(headAdmin, conferenceId, other.revision));
    expect((await getCommittee(anonClient(), conferenceId)).introduction).toBe("乙的草稿");
  });

  it("捨棄草稿後回到已發布的版本", async () => {
    const { revision } = await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "不要了" })));
    await ok(discardCommitteeTextDraft(headAdmin, conferenceId));
    expect(await getCommitteeTextDraft(headAdmin, conferenceId)).toBeNull();
    expect((await getCommittee(headAdmin, conferenceId)).introduction).toBe("已發布的簡介");
    expect(await publishCommitteeTexts(headAdmin, conferenceId, revision)).toEqual({ ok: false, error: "no_draft" });
    // 沒有草稿時捨棄也沒關係（可能另一位總管理員剛捨棄或發布了）。
    await ok(discardCommitteeTextDraft(headAdmin, conferenceId));
  });

  it("還沒發布過的年度也能存草稿、發布", async () => {
    conferenceId = must(
      await admin.from("conferences").insert({ year: 2002, conference_date: "2002-05-15" }).select("id").single(),
    ).id;
    conferenceIds.push(conferenceId);
    await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "第一版" })));
    expect((await getCommittee(anonClient(), conferenceId)).introduction).toBe("");
    const draft = await getCommitteeTextDraft(headAdmin, conferenceId);
    await ok(publishCommitteeTexts(headAdmin, conferenceId, draft!.revision));
    expect((await getCommittee(anonClient(), conferenceId)).introduction).toBe("第一版");
  });

  it("草稿的版本代號格式不對：當成草稿被改過", async () => {
    await ok(saveCommitteeTextDraft(headAdmin, texts()));
    expect(await publishCommitteeTexts(headAdmin, conferenceId, "不是代號")).toEqual({ ok: false, error: "draft_changed" });
  });

  it("直接呼叫資料庫、沒帶版本代號：不發布（#76，Codex 審查）", async () => {
    await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "草稿" })));
    const { error } = await headAdmin.rpc("publish_committee_texts", { p_conference_id: conferenceId, p_revision: null });
    expect(error?.message).toBe("draft_changed");
    expect((await getCommittee(anonClient(), conferenceId)).introduction).toBe("已發布的簡介");
    expect((await getCommitteeTextDraft(headAdmin, conferenceId))?.introduction).toBe("草稿");
  });

  it("課務組、報報組、訪客不能存草稿、發布或捨棄", async () => {
    const { revision } = await ok(saveCommitteeTextDraft(headAdmin, texts({ introduction: "草稿" })));
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveCommitteeTextDraft(client, texts({ introduction: "x" }))).toEqual({ ok: false, error: "not_admin" });
      expect(await publishCommitteeTexts(client, conferenceId, revision)).toEqual({ ok: false, error: "not_admin" });
      expect(await discardCommitteeTextDraft(client, conferenceId)).toEqual({ ok: false, error: "not_admin" });
      const inserted = await client.from("committee_text_drafts").insert({ conference_id: conferenceId });
      expect(inserted.error).not.toBeNull();
      const updated = await client
        .from("committee_text_drafts")
        .update({ introduction: "被改了" })
        .eq("conference_id", conferenceId)
        .select();
      expect(updated.data ?? []).toEqual([]);
    }
    expect(await getCommitteeTextDraft(headAdmin, conferenceId)).toMatchObject({ introduction: "草稿", revision });
  });

  it("標出哪幾頁和已發布的版本不同", () => {
    const texts = { introduction: "簡介", chairMessage: "主席", memorandum: "備忘錄", executionPlan: "" };
    const published = { ...texts, markdown: true };
    expect(changedTextPages(published, null)).toEqual([]);
    expect(changedTextPages(published, texts)).toEqual([]);
    expect(changedTextPages(published, { ...texts, chairMessage: "新的", memorandum: "", executionPlan: "" })).toEqual([
      "chairMessage",
      "memorandum",
    ]);
    // 改版前的純文字，發布後改依樣式排版：有內容的頁面都會變樣。
    expect(changedTextPages({ ...published, chairMessage: "", markdown: false }, { ...texts, chairMessage: "" })).toEqual([
      "introduction",
      "memorandum",
    ]);
  });
});

describe("其他角色不能修改", () => {
  it("課務組、報報組、訪客用頁面的功能會被擋下", async () => {
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await saveCommitteeTextDraft(client, { conferenceId, introduction: "x", chairMessage: "", memorandum: "", executionPlan: "" })).toEqual({
        ok: false,
        error: "not_admin",
      });
      expect(await saveMeeting(client, meeting())).toEqual({ ok: false, error: "not_admin" });
      expect(await saveCommitteeLink(client, { conferenceId, title: "x", url: "https://example.com" })).toEqual({
        ok: false,
        error: "not_admin",
      });
      expect(await saveTeamMember(client, teamMember())).toEqual({ ok: false, error: "not_admin" });
      expect(
        await saveCommitteeMember(client, { conferenceId, name: "測試", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }),
      ).toEqual({ ok: false, error: "not_admin" });
    }
  });

  // 公開的年度任何人都讀得到，寫入照樣只有總管理員（#74）。
  it.each([
    ["還沒到的年度", false],
    ["公開的過去年度", true],
  ])("直接呼叫資料庫也被擋下（權限規則）：%s", async (_, isPast) => {
    const targetId = isPast ? await pastConference() : conferenceId;
    await ok(publishTexts(headAdmin, { conferenceId: targetId, introduction: "原本的", chairMessage: "", memorandum: "", executionPlan: "" }));
    const meetingId = (await ok(saveMeeting(headAdmin, meeting({ conferenceId: targetId })))).id;
    const linkId = (await ok(saveCommitteeLink(headAdmin, { conferenceId: targetId, title: "原本的", url: "https://example.com" }))).id;
    const teamId = (await ok(saveTeamMember(headAdmin, teamMember({ conferenceId: targetId })))).id;
    const memberId = (
      await ok(saveCommitteeMember(headAdmin, { conferenceId: targetId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }))
    ).id;
    const before = await getCommittee(headAdmin, targetId);

    const rows: Record<string, Record<string, unknown>> = {
      committee_texts: { conference_id: targetId, introduction: "x" },
      committee_meetings: { conference_id: targetId, title: "x", meeting_date: "2099-01-01", url: "https://example.com" },
      committee_links: { conference_id: targetId, position: 9, title: "x", url: "https://example.com" },
      committee_team_members: { conference_id: targetId, team: "course", role: "lead", name: "x", stake_id: stakes[0].id },
      committee_members: { conference_id: targetId, name: "x", stake_id: stakes[0].id },
    };
    const updates: Record<string, Record<string, unknown>> = {
      committee_texts: { introduction: "被改了" },
      committee_meetings: { title: "被改了" },
      committee_links: { title: "被改了" },
      committee_team_members: { name: "被改了" },
      committee_members: { name: "被改了" },
    };
    const ids: Record<string, [string, string]> = {
      committee_texts: ["conference_id", targetId],
      committee_meetings: ["id", meetingId],
      committee_links: ["id", linkId],
      committee_team_members: ["id", teamId],
      committee_members: ["id", memberId],
    };
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      for (const table of TABLES) {
        const inserted = await client.from(table).insert(rows[table]);
        expect(inserted.error, `${table} 新增`).not.toBeNull();
        const [column, value] = ids[table];
        const updated = await client.from(table).update(updates[table]).eq(column, value).select();
        expect(updated.data ?? [], `${table} 修改`).toEqual([]);
        const deleted = await client.from(table).delete().eq(column, value).select();
        expect(deleted.data ?? [], `${table} 刪除`).toEqual([]);
      }
      const rpcs = [
        // 改成草稿之前的儲存，留給還沒換版的網站用（#76）。
        client.rpc("save_committee_texts", {
          p_conference_id: targetId,
          p_introduction: "被改了",
          p_chair_message: "",
          p_memorandum: "",
        }),
        client.rpc("save_committee_text_draft", {
          p_conference_id: targetId,
          p_introduction: "被改了",
          p_chair_message: "",
          p_memorandum: "",
        }),
        client.rpc("publish_committee_texts", { p_conference_id: targetId, p_revision: crypto.randomUUID() }),
        client.rpc("discard_committee_text_draft", { p_conference_id: targetId }),
        client.rpc("move_committee_link", { p_id: linkId, p_up: false }),
      ];
      for (const { error } of await Promise.all(rpcs)) expect(error).not.toBeNull();
    }
    expect(await getCommittee(headAdmin, targetId)).toEqual(before);
  });

  it("總管理員直接改資料庫也不能把項目換到別的年度", async () => {
    const meetingId = (await ok(saveMeeting(headAdmin, meeting()))).id;
    const otherId = must(
      await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single(),
    ).id;
    conferenceIds.push(otherId);
    const { error } = await headAdmin.from("committee_meetings").update({ conference_id: otherId }).eq("id", meetingId);
    expect(error).not.toBeNull();
  });
});

describe("支聯會名單", () => {
  it("名單上有人屬於的支聯會不能刪除，說明有人用到它", async () => {
    const stakeId = must(
      await admin.from("stakes").insert({ name_zh: "測試支聯會", region: "north" }).select("id").single(),
    ).id;
    try {
      await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId, reliefSocietyPresidency: false, bio: "" }));
      expect(await deleteUnit(headAdmin, "stake", stakeId)).toEqual({ ok: false, error: "in_use" });
    } finally {
      must(await admin.from("committee_members").delete().eq("stake_id", stakeId));
      must(await admin.from("stakes").delete().eq("id", stakeId));
    }
  });
});

describe("複製年度", () => {
  it("複製三個文字頁與重要連結；會議記錄與兩份名單不複製", async () => {
    await ok(publishTexts(headAdmin, { conferenceId, introduction: "大會簡介", chairMessage: "主席的話", memorandum: "備忘錄", executionPlan: "" }));
    await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "執行計畫", url: "https://example.com/plan" }));
    const second = await ok(saveCommitteeLink(headAdmin, { conferenceId, title: "交接清單", url: "https://example.com/handover" }));
    await ok(moveCommitteeLink(headAdmin, second.id, "up"));
    await ok(saveMeeting(headAdmin, meeting()));
    await ok(saveTeamMember(headAdmin, teamMember()));
    await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: true, bio: "" }));

    const copied = await copyConference(headAdmin, { sourceConferenceId: conferenceId, year: "2100", conferenceDate: "2100-05-15" });
    if (!copied.ok) throw new Error(copied.error);
    conferenceIds.push(copied.conferenceId);

    const committee = await getCommittee(headAdmin, copied.conferenceId);
    expect(committee).toMatchObject({
      introduction: "大會簡介",
      chairMessage: "主席的話",
      memorandum: "備忘錄",
      meetings: [],
      teamMembers: [],
      members: [],
    });
    expect(committee.links.map((link) => [link.title, link.url])).toEqual([
      ["交接清單", "https://example.com/handover"],
      ["執行計畫", "https://example.com/plan"],
    ]);
  });

  it("只複製已發布的文字頁，草稿不複製（#76）", async () => {
    await ok(publishTexts(headAdmin, { conferenceId, introduction: "已發布", chairMessage: "", memorandum: "", executionPlan: "" }));
    await ok(saveCommitteeTextDraft(headAdmin, { conferenceId, introduction: "草稿", chairMessage: "", memorandum: "", executionPlan: "" }));

    const copied = await copyConference(headAdmin, { sourceConferenceId: conferenceId, year: "2100", conferenceDate: "2100-05-15" });
    if (!copied.ok) throw new Error(copied.error);
    conferenceIds.push(copied.conferenceId);

    expect((await getCommittee(headAdmin, copied.conferenceId)).introduction).toBe("已發布");
    expect(await getCommitteeTextDraft(headAdmin, copied.conferenceId)).toBeNull();
    // 原本年度的草稿還在。
    expect((await getCommitteeTextDraft(headAdmin, conferenceId))?.introduction).toBe("草稿");
  });

  it("從還是純文字的舊年度複製，新年度也照純文字顯示（#75，Codex 審查）", async () => {
    must(await admin.from("committee_texts").insert({ conference_id: conferenceId, introduction: "*注意*  內容", markdown: false }));
    const copied = await copyConference(headAdmin, { sourceConferenceId: conferenceId, year: "2100", conferenceDate: "2100-05-15" });
    if (!copied.ok) throw new Error(copied.error);
    conferenceIds.push(copied.conferenceId);
    expect(await getCommittee(headAdmin, copied.conferenceId)).toMatchObject({ introduction: "*注意*  內容", markdown: false });
  });
});

describe("籌備委員的照片與個人頁", () => {
  const PNG = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
    (char) => char.charCodeAt(0),
  );
  let memberId: string;

  beforeEach(async () => {
    memberId = (
      await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試乙", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }))
    ).id;
  });

  // 存放空間裡的檔案不會跟著年度刪掉，每個測試自己清。
  afterEach(async () => {
    const files = must(await admin.storage.from(COMMITTEE_PHOTO_BUCKET).list(conferenceId)) ?? [];
    if (files.length > 0) {
      must(await admin.storage.from(COMMITTEE_PHOTO_BUCKET).remove(files.map((file) => `${conferenceId}/${file.name}`)));
    }
  });

  const files = async () =>
    ((must(await admin.storage.from(COMMITTEE_PHOTO_BUCKET).list(conferenceId)) ?? []) as { name: string }[])
      .map((file) => `${conferenceId}/${file.name}`)
      .sort();

  async function upload(client: SupabaseClient = headAdmin, id = memberId) {
    const path = committeePhotoPath(conferenceId, id, "image/png");
    must(await client.storage.from(COMMITTEE_PHOTO_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" }));
    return path;
  }

  const photoOf = async () => (await getCommittee(headAdmin, conferenceId)).members[0];

  it("上傳後記到委員上，有公開網址；換照片時舊的檔案刪掉；刪照片後回到沒有照片", async () => {
    const first = await upload();
    await ok(attachCommitteePhoto(headAdmin, { memberId, path: first, previous: null }));
    expect(await photoOf()).toMatchObject({ photoPath: first, photoUrl: expect.stringContaining(`/${COMMITTEE_PHOTO_BUCKET}/${first}`) });

    const second = await upload();
    await ok(attachCommitteePhoto(headAdmin, { memberId, path: second, previous: first }));
    expect((await photoOf()).photoPath).toBe(second);
    expect(await files()).toEqual([second]);

    await ok(removeCommitteePhoto(headAdmin, { memberId, path: second }));
    expect(await photoOf()).toMatchObject({ photoPath: null, photoUrl: null });
    expect(await files()).toEqual([]);
  });

  it("別人剛換過照片：不記，說明照片已經被換過", async () => {
    const first = await upload();
    await ok(attachCommitteePhoto(headAdmin, { memberId, path: first, previous: null }));
    const second = await upload();

    // 她看到的還是沒有照片的畫面。
    expect(await attachCommitteePhoto(headAdmin, { memberId, path: second, previous: null })).toEqual({
      ok: false,
      error: "photo_changed",
    });
    expect((await photoOf()).photoPath).toBe(first);
    expect(await removeCommitteePhoto(headAdmin, { memberId, path: second })).toEqual({ ok: false, error: "photo_changed" });
  });

  it("檔案沒上傳、或是別位委員的照片路徑：不記", async () => {
    expect(
      await attachCommitteePhoto(headAdmin, { memberId, path: committeePhotoPath(conferenceId, memberId, "image/png"), previous: null }),
    ).toEqual({ ok: false, error: "photo_failed" });

    const other = (
      await ok(saveCommitteeMember(headAdmin, { conferenceId, name: "測試丙", stakeId: stakes[0].id, reliefSocietyPresidency: false, bio: "" }))
    ).id;
    const path = await upload(headAdmin, other);
    expect(await attachCommitteePhoto(headAdmin, { memberId, path, previous: null })).toEqual({ ok: false, error: "photo_failed" });
  });

  it("刪除委員時照片一併刪掉", async () => {
    const path = await upload();
    await ok(attachCommitteePhoto(headAdmin, { memberId, path, previous: null }));

    await ok(deleteCommitteeItem(headAdmin, "member", memberId));
    expect(await files()).toEqual([]);
  });

  it("課務組、報報組與訪客不能上傳照片，也不能記到委員上", async () => {
    const path = committeePhotoPath(conferenceId, memberId, "image/png");
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      const uploaded = await client.storage
        .from(COMMITTEE_PHOTO_BUCKET)
        .upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
      expect(uploaded.error).not.toBeNull();
    }
    const uploaded = await upload();
    for (const client of [courseTeam, registrationTeam]) {
      expect(await attachCommitteePhoto(client, { memberId, path: uploaded, previous: null })).toEqual({ ok: false, error: "not_admin" });
    }
    expect((await photoOf()).photoPath).toBeNull();
  });

  it("公開的個人頁只找得到公開年度的委員", async () => {
    // 2099 年度還沒到。
    expect(await getPublicCommitteeMember(anonClient(), memberId)).toBeNull();
    expect(await getPublicCommitteeMember(headAdmin, memberId)).toBeNull();

    const pastId = await pastConference();
    const { id } = await ok(
      saveCommitteeMember(headAdmin, { conferenceId: pastId, name: "測試丁", stakeId: stakes[0].id, reliefSocietyPresidency: true, bio: "介紹" }),
    );
    expect(await getPublicCommitteeMember(anonClient(), id)).toMatchObject({
      member: { name: "測試丁", bio: "介紹", stakeName: stakes[0].name, photoUrl: null },
      year: { id: pastId, year: 2001, isCurrent: false },
    });
    expect(await getPublicCommitteeMember(anonClient(), "not-a-uuid")).toBeNull();
  });
});
