import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, databaseClient, must, signedInClient } from "../../test/supabase";
import {
  deleteAgendaItem,
  getAgendaEditor,
  moveAgendaItem,
  saveAgendaItem,
  saveAgendaVenue,
  type AgendaError,
  type AgendaItemInput,
  type AgendaVenueInput,
} from "./agenda";
import { deleteHomeItem } from "./content";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let jinhua: string;
let daya: string;
let jinhuaFirst: string;
let jinhuaAfternoon: string;
let dayaFirst: string;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個還沒開放報名的 2099 目前年度：金華（第一場、午后動態）與大雅（第一場）兩個場地，
// 一位總管理員、一位北區課務組、一位北區報報組；測完全部刪掉。
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
        registration_opens_at: new Date(now + DAY).toISOString(),
        registration_closes_at: new Date(now + 2 * DAY).toISOString(),
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;
  const insert = async (table: string, row: Record<string, unknown>) =>
    must(await admin.from(table).insert({ conference_id: conferenceId, ...row }).select("id").single()).id as string;
  jinhua = await insert("venues", { position: 1, region: "north", name_zh: "台北金華教堂" });
  daya = await insert("venues", { position: 2, region: "central", name_zh: "台中大雅教堂" });
  jinhuaFirst = await insert("sessions", { venue_id: jinhua, position: 1, name_zh: "第一場" });
  jinhuaAfternoon = await insert("sessions", { venue_id: jinhua, position: 2, name_zh: "午后動態" });
  dayaFirst = await insert("sessions", { venue_id: daya, position: 1, name_zh: "第一場" });

  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "course@example.com", role: "course_team", region: "north" },
    { email: "report@example.com", role: "registration_team", region: "north" },
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
  // 刪掉年度大會時，它的場地、場次與大會程序一起刪除。
  if (conferenceId) must(await admin.from("conferences").delete().eq("id", conferenceId));
  conferenceId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

async function save(input: Partial<AgendaItemInput> & { nameZh: string }, client = headAdmin) {
  return saveAgendaItem(client, {
    conferenceId: conferenceId!,
    startTime: "09:30",
    endTime: "10:30",
    nameEn: "",
    parts: [],
    ...input,
  });
}

async function saved(input: Partial<AgendaItemInput> & { nameZh: string }) {
  const result = await save(input);
  if (!result.ok) throw new Error(`新增失敗：${result.error}`);
  return result.id;
}

async function setVenue(input: Partial<AgendaVenueInput> & { agendaItemId: string; venueId: string }, client = headAdmin) {
  return saveAgendaVenue(client, { placeZh: "", placeEn: "", noteZh: "", noteEn: "", sessionId: "", highlightId: "", ...input });
}

async function editor() {
  return (await getAgendaEditor(headAdmin))!;
}

async function names() {
  return (await editor()).items.map((item) => item.nameZh);
}

describe("每一列", () => {
  it("新增的列依序排在最後，可以往前、往後移、修改、刪除", async () => {
    const opening = await saved({ nameZh: "開幕式" });
    const checkIn = await saved({ nameZh: "報到", startTime: "08:30", endTime: "09:15" });
    const closing = await saved({ nameZh: "閉幕式", startTime: "15:30", endTime: "16:30" });
    expect(await names()).toEqual(["開幕式", "報到", "閉幕式"]);

    expect(await moveAgendaItem(headAdmin, checkIn, "up")).toEqual({ ok: true });
    expect(await names()).toEqual(["報到", "開幕式", "閉幕式"]);
    expect(await moveAgendaItem(headAdmin, closing, "down")).toEqual({ ok: true });
    expect(await names()).toEqual(["報到", "開幕式", "閉幕式"]);

    expect(
      await save({ id: opening, nameZh: " 開幕 ", nameEn: "Opening", startTime: "09:40", endTime: "10:40:00" }),
    ).toMatchObject({ ok: true, id: opening });
    expect((await editor()).items[1]).toMatchObject({ nameZh: "開幕", nameEn: "Opening", startTime: "09:40", endTime: "10:40" });

    expect(await deleteAgendaItem(headAdmin, checkIn)).toEqual({ ok: true });
    expect(await names()).toEqual(["開幕", "閉幕式"]);
    expect(await deleteAgendaItem(headAdmin, checkIn)).toEqual({ ok: false, error: "not_found" });
  });

  it.each<[Partial<AgendaItemInput> & { nameZh: string }, AgendaError]>([
    [{ nameZh: " " }, "name_required"],
    [{ nameZh: "開幕式", startTime: "10:30", endTime: "10:30" }, "time_invalid"],
    [{ nameZh: "開幕式", startTime: "11:00", endTime: "10:30" }, "time_invalid"],
    [{ nameZh: "開幕式", startTime: "", endTime: "10:30" }, "time_invalid"],
    [{ nameZh: "開幕式", startTime: "25:00", endTime: "26:00" }, "time_invalid"],
    [{ nameZh: "開幕式", parts: [{ nameZh: "", nameEn: "Choir", highlightId: "" }] }, "part_name_required"],
  ])("%o 不能存（%s）", async (input, error) => {
    expect(await save(input)).toEqual({ ok: false, error });
    expect(await names()).toEqual([]);
  });

  it("子項目依順序存下，可以連到大會特色；空的格子略過，清空就是刪掉", async () => {
    const choir = must(
      await admin.from("highlights").insert({ conference_id: conferenceId, name_zh: "即席唱詩班" }).select("id").single(),
    ).id;
    const id = await saved({
      nameZh: "開幕式",
      parts: [
        { nameZh: "即席唱詩班", nameEn: "Choir", highlightId: choir },
        { nameZh: "", nameEn: "", highlightId: "" },
        { nameZh: "領袖演講", nameEn: "", highlightId: "" },
      ],
    });
    expect((await editor()).items[0].parts).toEqual([
      { nameZh: "即席唱詩班", nameEn: "Choir", highlightId: choir },
      { nameZh: "領袖演講", nameEn: "", highlightId: null },
    ]);

    await saved({ id, nameZh: "開幕式", parts: [{ nameZh: "領袖演講", nameEn: "", highlightId: "" }] });
    expect((await editor()).items[0].parts).toEqual([{ nameZh: "領袖演講", nameEn: "", highlightId: null }]);
  });

  it("子項目只能連到同一年度的大會特色；刪除大會特色時只清掉連結", async () => {
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      const old = must(
        await admin.from("highlights").insert({ conference_id: other, name_zh: "去年的" }).select("id").single(),
      ).id;
      expect(await save({ nameZh: "開幕式", parts: [{ nameZh: "唱詩班", nameEn: "", highlightId: old }] })).toEqual({
        ok: false,
        error: "highlight_invalid",
      });
      expect(await names()).toEqual([]);
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }

    const speech = must(
      await admin.from("highlights").insert({ conference_id: conferenceId, name_zh: "領袖演講" }).select("id").single(),
    ).id;
    await saved({ nameZh: "閉幕式", parts: [{ nameZh: "領袖演講", nameEn: "", highlightId: speech }] });
    expect(await deleteHomeItem(headAdmin, "highlight", speech)).toEqual({ ok: true });
    expect((await editor()).items[0].parts).toEqual([{ nameZh: "領袖演講", nameEn: "", highlightId: null }]);
  });

  it("報名開放後照樣能改", async () => {
    const id = await saved({ nameZh: "開幕式" });
    await setVenue({ agendaItemId: id, venueId: jinhua, sessionId: jinhuaFirst });
    must(await admin.from("conferences").update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() }).eq("id", conferenceId!));

    expect(await save({ id, nameZh: "開幕式", startTime: "09:00" })).toMatchObject({ ok: true });
    expect(await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "大會堂", sessionId: "" })).toEqual({ ok: true });
    expect(await moveAgendaItem(headAdmin, id, "up")).toEqual({ ok: true });
    expect((await editor()).items[0].venues[jinhua]).toMatchObject({ placeZh: "大會堂", sessionId: null });
  });

  it("不是目前年度的不能改", async () => {
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      expect(await saveAgendaItem(headAdmin, { conferenceId: other, startTime: "09:00", endTime: "10:00", nameZh: "舊的", nameEn: "", parts: [] })).toEqual({
        ok: false,
        error: "not_found",
      });
      const old = must(
        await admin
          .from("agenda_items")
          .insert({ conference_id: other, start_time: "09:00", end_time: "10:00", name_zh: "舊的" })
          .select("id")
          .single(),
      ).id;
      expect(await save({ id: old, nameZh: "被改了" })).toEqual({ ok: false, error: "not_found" });
      expect(await moveAgendaItem(headAdmin, old, "up")).toEqual({ ok: false, error: "not_found" });
      expect(await deleteAgendaItem(headAdmin, old)).toEqual({ ok: false, error: "not_found" });
      expect(await setVenue({ agendaItemId: old, venueId: jinhua })).toEqual({ ok: false, error: "not_found" });
      expect(must(await admin.from("agenda_items").select("name_zh").eq("id", old).single()).name_zh).toBe("舊的");
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });
});

describe("各教堂的設定", () => {
  it("每一列可以分教堂設定地點、補充說明、對應場次，沒設定的是空的", async () => {
    const service = await saved({ nameZh: "公益服務說明" });

    expect(
      await setVenue({
        agendaItemId: service,
        venueId: jinhua,
        placeZh: " 一樓大會堂 ",
        placeEn: "1F Assembly Hall",
        noteZh: "或改參加午后動態",
        sessionId: jinhuaAfternoon,
      }),
    ).toEqual({ ok: true });

    const [item] = (await editor()).items;
    expect(item.venues).toEqual({
      [jinhua]: {
        placeZh: "一樓大會堂",
        placeEn: "1F Assembly Hall",
        noteZh: "或改參加午后動態",
        noteEn: "",
        sessionId: jinhuaAfternoon,
        highlightId: null,
      },
      [daya]: { placeZh: "", placeEn: "", noteZh: "", noteEn: "", sessionId: null, highlightId: null },
    });

    // 再存一次是修改，不會多一筆。
    expect(await setVenue({ agendaItemId: service, venueId: jinhua, placeZh: "三樓" })).toEqual({ ok: true });
    expect((await editor()).items[0].venues[jinhua]).toMatchObject({ placeZh: "三樓", noteZh: "", sessionId: null });
    expect(must(await admin.from("agenda_item_venues").select("venue_id").eq("agenda_item_id", service))).toHaveLength(1);
  });

  it("一個場次不能接到兩列，也不能接到別間教堂的場次", async () => {
    const first = await saved({ nameZh: "第一場次" });
    const second = await saved({ nameZh: "第二場次" });
    expect(await setVenue({ agendaItemId: first, venueId: jinhua, sessionId: jinhuaFirst })).toEqual({ ok: true });

    expect(await setVenue({ agendaItemId: second, venueId: jinhua, sessionId: jinhuaFirst })).toEqual({
      ok: false,
      error: "session_taken",
    });
    expect(await setVenue({ agendaItemId: second, venueId: jinhua, sessionId: dayaFirst })).toEqual({
      ok: false,
      error: "session_invalid",
    });
    expect(await setVenue({ agendaItemId: second, venueId: jinhua, sessionId: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "session_invalid",
    });
    expect((await editor()).items[1].venues[jinhua].sessionId).toBeNull();
  });

  it("可以改接一項大會特色（例如靜態展示），和場次擇一；選單只列人物卡片版型的大會特色", async () => {
    const insert = async (table: string, row: Record<string, unknown>) =>
      must(await admin.from(table).insert({ conference_id: conferenceId, ...row }).select("id").single()).id as string;
    const exhibit = await insert("highlights", { position: 2, name_zh: "靜態展示", page_template: "exhibit" });
    const corner = await insert("highlights", { position: 1, name_zh: "角落課程", page_template: "corner" });
    await insert("highlights", { position: 3, name_zh: "即席唱詩班", page_template: "choir" });
    await insert("highlights", { position: 4, name_zh: "公益服務" });
    expect((await editor()).cardHighlights).toEqual([
      { id: corner, nameZh: "角落課程" },
      { id: exhibit, nameZh: "靜態展示" },
    ]);

    const display = await saved({ nameZh: "靜態展示" });
    expect(await setVenue({ agendaItemId: display, venueId: jinhua, placeZh: "二樓", highlightId: exhibit })).toEqual({ ok: true });
    expect((await editor()).items[0].venues[jinhua]).toMatchObject({ placeZh: "二樓", sessionId: null, highlightId: exhibit });

    expect(
      await setVenue({ agendaItemId: display, venueId: jinhua, sessionId: jinhuaFirst, highlightId: exhibit }),
    ).toEqual({ ok: false, error: "session_and_highlight" });
    // 直接寫資料庫也擋下。
    const both = await headAdmin.rpc("save_agenda_item_venue", {
      p_agenda_item_id: display,
      p_venue_id: jinhua,
      p_place_zh: "",
      p_place_en: "",
      p_note_zh: "",
      p_note_en: "",
      p_session_id: jinhuaFirst,
      p_highlight_id: exhibit,
    });
    expect(both.error?.message).toContain("agenda_item_venues_session_or_highlight");

    // 改接場次就把大會特色清掉。
    expect(await setVenue({ agendaItemId: display, venueId: jinhua, sessionId: jinhuaFirst })).toEqual({ ok: true });
    expect((await editor()).items[0].venues[jinhua]).toMatchObject({ sessionId: jinhuaFirst, highlightId: null });
  });

  it("只能接同一年度的大會特色；刪除大會特色時只清掉對應", async () => {
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      const oldExhibit = must(
        await admin.from("highlights").insert({ conference_id: other, name_zh: "去年的展示" }).select("id").single(),
      ).id;
      const display = await saved({ nameZh: "靜態展示" });
      expect(await setVenue({ agendaItemId: display, venueId: jinhua, highlightId: oldExhibit })).toEqual({
        ok: false,
        error: "highlight_invalid",
      });
      expect(await setVenue({ agendaItemId: display, venueId: jinhua, highlightId: "不是編號" })).toEqual({
        ok: false,
        error: "highlight_invalid",
      });

      const exhibit = must(
        await admin
          .from("highlights")
          .insert({ conference_id: conferenceId, name_zh: "靜態展示", page_template: "exhibit" })
          .select("id")
          .single(),
      ).id;
      await setVenue({ agendaItemId: display, venueId: jinhua, placeZh: "二樓", highlightId: exhibit });
      must(await admin.from("highlights").delete().eq("id", exhibit));
      expect((await editor()).items[0].venues[jinhua]).toMatchObject({ placeZh: "二樓", highlightId: null });
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("不能設定別的年度的教堂", async () => {
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      const oldVenue = must(
        await admin.from("venues").insert({ conference_id: other, region: "north", name_zh: "去年的金華" }).select("id").single(),
      ).id;
      const id = await saved({ nameZh: "開幕式" });
      expect(await setVenue({ agendaItemId: id, venueId: oldVenue, placeZh: "大會堂" })).toEqual({ ok: false, error: "not_found" });
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("還沒接到任何一列的場次會列出來", async () => {
    expect((await editor()).unplacedSessions).toEqual([
      { venueNameZh: "台北金華教堂", sessionNameZh: "第一場" },
      { venueNameZh: "台北金華教堂", sessionNameZh: "午后動態" },
      { venueNameZh: "台中大雅教堂", sessionNameZh: "第一場" },
    ]);

    const first = await saved({ nameZh: "第一場次" });
    await setVenue({ agendaItemId: first, venueId: jinhua, sessionId: jinhuaFirst });
    await setVenue({ agendaItemId: first, venueId: daya, sessionId: dayaFirst });

    expect((await editor()).unplacedSessions).toEqual([{ venueNameZh: "台北金華教堂", sessionNameZh: "午后動態" }]);
  });

  it("刪除場次時對應清空、地點留著；刪除教堂時設定一起刪除；刪除一列時設定一起刪除", async () => {
    const id = await saved({ nameZh: "第一場次" });
    await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "大會堂", sessionId: jinhuaFirst });
    await setVenue({ agendaItemId: id, venueId: daya, placeZh: "康樂廳", sessionId: dayaFirst });

    must(await headAdmin.from("sessions").delete().eq("id", jinhuaFirst));
    expect((await editor()).items[0].venues[jinhua]).toMatchObject({ placeZh: "大會堂", sessionId: null });

    must(await headAdmin.from("venues").delete().eq("id", daya));
    expect(must(await admin.from("agenda_item_venues").select("venue_id").eq("agenda_item_id", id))).toEqual([{ venue_id: jinhua }]);

    expect(await deleteAgendaItem(headAdmin, id)).toEqual({ ok: true });
    expect(must(await admin.from("agenda_item_venues").select("venue_id").eq("agenda_item_id", id))).toEqual([]);
  });
});

describe("只有總管理員能編輯", () => {
  it("課務組、報報組與訪客透過後台都被擋下", async () => {
    const id = await saved({ nameZh: "原本的" });
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(await save({ nameZh: "新的" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await save({ id, nameZh: "被改了" }, client)).toEqual({ ok: false, error: "not_admin" });
      expect(await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "被改了" }, client)).toEqual({
        ok: false,
        error: "not_admin",
      });
      expect(await moveAgendaItem(client, id, "up")).toEqual({ ok: false, error: "not_admin" });
      expect(await deleteAgendaItem(client, id)).toEqual({ ok: false, error: "not_admin" });
    }
    expect(await names()).toEqual(["原本的"]);
  });

  // 等這一列的列鎖時被移出工作人員名單：權限規則讓子項目刪不到也不出錯，不能只改了名稱就回報成功（Codex 審查）。
  it("存一列途中失去總管理員身分時，名稱與子項目都不改", async () => {
    const id = await saved({ nameZh: "開幕式", parts: [{ nameZh: "領袖演講", nameEn: "", highlightId: "" }] });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const headId = data.users.find((user) => user.email === "head@example.com")!.id;
    const sql = databaseClient();
    const watcher = databaseClient();
    try {
      let saving!: ReturnType<typeof save>;
      await sql.begin(async (tx) => {
        await tx`select 1 from public.agenda_items where id = ${id} for update`;
        saving = save({ id, nameZh: "改過的名稱", parts: [] });
        for (let waited = 0; ; waited += 50) {
          const [{ blocked }] = await watcher<{ blocked: boolean }[]>`
            select exists (
              select 1 from pg_stat_activity where wait_event_type = 'Lock' and query ~ 'save_agenda_item'
            ) as blocked`;
          if (blocked) break;
          if (waited > 3000) throw new Error("save_agenda_item 沒有等這一列的列鎖");
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        await tx`delete from public.staff_members where user_id = ${headId}`;
      });

      expect(await saving).toEqual({ ok: false, error: "not_admin" });
    } finally {
      await Promise.all([sql.end(), watcher.end()]);
    }
    expect(must(await admin.from("agenda_items").select("name_zh").eq("id", id).single()).name_zh).toBe("開幕式");
    expect(must(await admin.from("agenda_item_parts").select("name_zh").eq("agenda_item_id", id))).toEqual([
      { name_zh: "領袖演講" },
    ]);
  });

  it("權限規則：非總管理員直接寫資料庫也改不到", async () => {
    const id = await saved({ nameZh: "原本的", parts: [{ nameZh: "子項目", nameEn: "", highlightId: "" }] });
    await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "大會堂" });

    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      expect(
        (await client.from("agenda_items").insert({ conference_id: conferenceId, start_time: "09:00", end_time: "10:00", name_zh: "偷加" }))
          .error,
      ).not.toBeNull();
      expect((await client.from("agenda_items").update({ name_zh: "被改了" }).eq("id", id).select("id")).data ?? []).toEqual([]);
      expect((await client.from("agenda_item_parts").delete().eq("agenda_item_id", id).select("id")).data ?? []).toEqual([]);
      expect(
        (await client.from("agenda_item_venues").update({ place_zh: "被改了" }).eq("agenda_item_id", id).select("venue_id")).data ?? [],
      ).toEqual([]);
      for (const rpc of ["save_agenda_item", "save_agenda_item_venue"]) {
        const args =
          rpc === "save_agenda_item"
            ? { p_id: id, p_conference_id: conferenceId, p_start_time: "09:00", p_end_time: "10:00", p_name_zh: "被改了", p_name_en: "", p_parts: [] }
            : { p_agenda_item_id: id, p_venue_id: jinhua, p_place_zh: "被改了", p_place_en: "", p_note_zh: "", p_note_en: "", p_session_id: null };
        const { error } = await client.rpc(rpc, args);
        // 有執行到函式、被擋下，不是參數對不上（PGRST202）。
        expect(error).not.toBeNull();
        expect(error?.code).not.toBe("PGRST202");
      }
    }

    const [item] = (await editor()).items;
    expect(item).toMatchObject({ nameZh: "原本的", parts: [{ nameZh: "子項目" }] });
    expect(item.venues[jinhua].placeZh).toBe("大會堂");
  });

  it("權限規則：總管理員也不能直接把一列換到別的年度、換教堂", async () => {
    const id = await saved({ nameZh: "開幕式" });
    await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "大會堂" });
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      expect((await headAdmin.from("agenda_items").update({ conference_id: other }).eq("id", id)).error?.code).toBe("42501");
      expect((await headAdmin.from("agenda_item_venues").update({ venue_id: daya }).eq("agenda_item_id", id)).error?.code).toBe(
        "42501",
      );
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("前台訪客讀得到目前年度的大會程序", async () => {
    const id = await saved({ nameZh: "開幕式", parts: [{ nameZh: "領袖演講", nameEn: "", highlightId: "" }] });
    await setVenue({ agendaItemId: id, venueId: jinhua, placeZh: "大會堂" });

    const visitor = anonClient();
    expect(must(await visitor.from("agenda_items").select("name_zh").eq("id", id))).toEqual([{ name_zh: "開幕式" }]);
    expect(must(await visitor.from("agenda_item_parts").select("name_zh").eq("agenda_item_id", id))).toEqual([{ name_zh: "領袖演講" }]);
    expect(must(await visitor.from("agenda_item_venues").select("place_zh").eq("agenda_item_id", id))).toEqual([{ place_zh: "大會堂" }]);
  });
});
