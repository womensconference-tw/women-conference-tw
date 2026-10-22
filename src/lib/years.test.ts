import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionSql } from "postgres";
import { adminClient, anonClient, databaseClient, must, serverClient, signedInClient } from "../../test/supabase";
import { getCurrentConference } from "./conference";
import { getAgendaEditor } from "./agenda";
import { getContentEditor, toTaipeiDateTimeInput } from "./content";
import { getProgramme, type Programme } from "./programme";
import { cancelRegistration, submitRegistration, updateRegistration, type RegistrationInput } from "./registration";
import { listRegistrations } from "./registration-list";
import { copyConference, createFirstConference, listConferences, setCurrentConference } from "./years";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;

let previousCurrentIds: string[] = [];
let sourceId: string;
let stakeId: string;
let wardId: string;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個還沒開放報名的 2099 目前年度（lastYear() 把它變成已截止的去年）、一位總管理員、一位北區課務組、一位北區報報組；測完全部刪掉。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));

  const now = Date.now();
  sourceId = must(
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

  stakeId = must(await admin.from("stakes").insert({ region: "north", name_zh: "測試年度支聯會" }).select("id").single()).id;
  wardId = must(await admin.from("wards").insert({ stake_id: stakeId, name_zh: "測試年度支會" }).select("id").single()).id;

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
  // 刪掉年度大會時，它的場地、課程與報名一起刪除。
  must(await admin.from("conferences").delete().gte("year", 2099));
  must(await admin.from("wards").delete().eq("stake_id", stakeId));
  must(await admin.from("stakes").delete().eq("id", stakeId));
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

/** 表單上的台灣時間（datetime-local 的格式），距離現在 offset 毫秒。 */
function taipei(offset: number): string {
  return toTaipeiDateTimeInput(new Date(Date.now() + offset).toISOString());
}

async function copied(client = headAdmin) {
  const result = await copyConference(client, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-05-15" });
  if (!result.ok) throw new Error(`複製失敗：${result.error}`);
  return result.conferenceId;
}

/** 把複製出來的年度設為目前年度，時程是報名前（明天開放）。 */
async function switchedTo(conferenceId: string) {
  const result = await setCurrentConference(headAdmin, {
    conferenceId,
    announceAt: taipei(-DAY),
    registrationOpensAt: taipei(DAY),
    registrationClosesAt: taipei(2 * DAY),
  });
  if (!result.ok) throw new Error(`切換失敗：${result.error}`);
}

/**
 * 2099 年的完整安排：一個場地、兩個場次、三門課（其中兩門成對、一門有教室與講師）、限量午餐、午后動態（第三個場次，裡面一門不限量的課）、
 * 首頁內容、常見問題、自訂區塊、兩項大會特色，以及一筆報名。建好後把時程移到過去（已截止），像去年一樣。
 */
async function lastYear() {
  must(
    await admin
      .from("conferences")
      .update({
        start_time: "09:00",
        end_time: "16:00",
        theme_scripture_zh: "你的兒女都要受耶和華的教訓",
        theme_scripture_en: "All thy children shall be taught of the Lord",
        welcome_zh: "歡迎姐妹們",
        welcome_signature_zh: "2099台灣姐妹大會籌備委員會",
        welcome_signature_en: "2099 Organizing Committee",
        hero_alt_zh: "2099 主視覺",
        hero_mobile_zh_path: `${sourceId}/mobile-zh-${crypto.randomUUID()}.png`,
        admin_line_id: "@twsisters",
      })
      .eq("id", sourceId),
  );
  const insert = async (table: string, row: Record<string, unknown>) =>
    must(await admin.from(table).insert({ conference_id: sourceId, ...row }).select("id").single()).id as string;
  const venue = await insert("venues", { region: "north", name_zh: "台北金華教堂", features_zh: "另有午后動態" });
  const first = await insert("sessions", { venue_id: venue, position: 1, name_zh: "第一場" });
  const second = await insert("sessions", { venue_id: venue, position: 2, name_zh: "第二場" });
  const service = await insert("highlights", { position: 2, name_zh: "公益服務" });
  const honor = await insert("highlights", {
    position: 3,
    name_zh: "向貴賓致敬",
    page_template: "honor",
    subtitle_zh: "80 歲長輩",
    lead_quote_zh: "值得尊敬的姐妹",
    lead_quote_source_en: "Source",
  });
  await insert("highlight_people", {
    highlight_id: honor,
    position: 2,
    name_zh: "黃蘋 姐妹",
    link_label_zh: "她的故事",
    link_url: "/story",
  });
  await insert("highlight_people", {
    highlight_id: honor,
    position: 1,
    stake_zh: "中台北支聯會",
    ward_en: "Luzhou Ward",
    name_zh: "沈亦斌 姐妹",
    photo_path: `${sourceId}/00000000-0000-4000-8000-000000000000.jpg`,
    photo_focus: 20,
  });
  await insert("highlights", {
    position: 1,
    name_zh: "即席唱詩班",
    name_en: "Choir",
    summary_zh: "跟著影片練唱",
    description_zh: "[練唱影片](https://www.youtube.com/)",
  });
  const genealogy = await insert("courses", {
    session_id: first,
    title_zh: "家譜入門",
    capacity: 20,
    speaker_zh: "蔡婷儀",
    speaker_en: "Tsai Ting-yi",
  });
  await insert("courses", { session_id: first, position: 1, title_zh: "自由選課" });
  const genealogyTwo = await insert("courses", { session_id: second, title_zh: "家譜進階", capacity: 20 });
  const afternoon = await insert("sessions", { venue_id: venue, position: 3, name_zh: "午后動態" });
  await insert("courses", { session_id: afternoon, title_zh: "手作花圈", speaker_zh: "余心愛", highlight_id: service });
  const agendaItem = await insert("agenda_items", { position: 1, start_time: "11:00", end_time: "11:50", name_zh: "第一場次" });
  await insert("agenda_items", { position: 2, start_time: "12:30", end_time: "13:15", name_zh: "公益服務說明", name_en: "Service" });
  must(
    await admin.from("agenda_item_parts").insert([
      { conference_id: sourceId, agenda_item_id: agendaItem, position: 1, name_zh: "公益服務", name_en: "", highlight_id: service },
      { conference_id: sourceId, agenda_item_id: agendaItem, position: 2, name_zh: "見證", name_en: "", highlight_id: null },
    ]),
  );
  must(
    await admin.from("agenda_item_venues").insert({
      conference_id: sourceId,
      agenda_item_id: agendaItem,
      venue_id: venue,
      place_zh: "一樓大會堂",
      session_id: first,
    }),
  );
  must(
    await admin.from("highlight_venues").insert({
      conference_id: sourceId,
      highlight_id: service,
      venue_id: venue,
      body_zh: "在一樓大廳",
      body_en: "In the 1F lobby",
    }),
  );
  must(await admin.from("course_classrooms").insert({ course_id: genealogy, classroom: "201 教室" }));
  must(await admin.from("course_pairs").insert({ conference_id: sourceId, first_course_id: genealogy, second_course_id: genealogyTwo }));
  const lunch = await insert("lunch_options", { venue_id: venue, name_zh: "素食便當", capacity: 30 });
  await insert("faqs", { question_zh: "要收費嗎？", answer_zh: "不用。" });
  await insert("custom_blocks", { title_zh: "交通資訊", button_label_zh: "查看", button_url: "/lookup" });

  const registration = await insert("registrations", {
    venue_id: venue,
    stake_id: stakeId,
    ward_id: wardId,
    name: "去年的報名者",
    phone: "0912345678",
    portrait_consented_at: new Date().toISOString(),
    locale: "zh",
    lunch_option_id: lunch,
  });
  must(
    await admin
      .from("registration_courses")
      .insert({ registration_id: registration, venue_id: venue, session_id: first, course_id: genealogy }),
  );

  const now = Date.now();
  must(
    await admin
      .from("conferences")
      .update({
        announce_at: new Date(now - 30 * DAY).toISOString(),
        registration_opens_at: new Date(now - 20 * DAY).toISOString(),
        registration_closes_at: new Date(now - 10 * DAY).toISOString(),
      })
      .eq("id", sourceId),
  );
}

/** 課程安排去掉編號，只留看得到的內容與名額；成對課程以課名表示。 */
function arrangement(programme: Programme) {
  const titles = new Map(
    programme.venues.flatMap((venue) => venue.sessions.flatMap((session) => session.courses)).map((course) => [course.id, course.nameZh]),
  );
  return {
    venues: programme.venues.map((venue) => ({
      nameZh: venue.nameZh,
      region: venue.region,
      featuresZh: venue.featuresZh,
      sessions: venue.sessions.map((session) => ({
        nameZh: session.nameZh,
        courses: session.courses.map((course) => [course.nameZh, course.capacity, course.classroom]),
      })),
      lunchOptions: venue.lunchOptions.map((lunch) => [lunch.nameZh, lunch.capacity]),
    })),
    coursePairs: programme.coursePairs.map((pair) => [titles.get(pair.firstCourseId), titles.get(pair.secondCourseId)]),
  };
}

describe("複製去年建立新年度", () => {
  it("場地、場次（含午后動態）、課程、名額、教室、成對課程、午餐都複製過去", async () => {
    await lastYear();

    await switchedTo(await copied());

    const programme = (await getProgramme(headAdmin))!;
    expect(programme.year).toBe(2100);
    expect(arrangement(programme)).toEqual({
      venues: [
        {
          nameZh: "台北金華教堂",
          region: "north",
          featuresZh: "另有午后動態",
          sessions: [
            {
              nameZh: "第一場",
              courses: [
                ["家譜入門", 20, "201 教室"],
                ["自由選課", null, null],
              ],
            },
            { nameZh: "第二場", courses: [["家譜進階", 20, null]] },
            { nameZh: "午后動態", courses: [["手作花圈", null, null]] },
          ],
          lunchOptions: [["素食便當", 30]],
        },
      ],
      coursePairs: [["家譜入門", "家譜進階"]],
    });
  });

  it("排序數字相同的場次，複製後仍是原本的順序，成對課程照樣複製", async () => {
    const venue = must(
      await admin.from("venues").insert({ conference_id: sourceId, region: "north", name_zh: "台北金華教堂" }).select("id").single(),
    ).id;
    // 五個排序數字都是 0 的場次，顯示順序由編號決定；每個場次一門課。
    for (const name of ["甲", "乙", "丙", "丁", "戊"]) {
      const session = must(
        await admin.from("sessions").insert({ conference_id: sourceId, venue_id: venue, name_zh: `${name}場` }).select("id").single(),
      ).id;
      must(await admin.from("courses").insert({ conference_id: sourceId, session_id: session, title_zh: `${name}課` }));
    }
    const before = (await getProgramme(headAdmin))!.venues[0].sessions;
    // 依顯示順序相鄰的第二、三個場次的課設成對。
    must(
      await admin.from("course_pairs").insert({
        conference_id: sourceId,
        first_course_id: before[1].courses[0].id,
        second_course_id: before[2].courses[0].id,
      }),
    );

    await switchedTo(await copied());

    const after = arrangement((await getProgramme(headAdmin))!);
    expect(after.venues[0].sessions.map((session) => session.nameZh)).toEqual(before.map((session) => session.nameZh));
    expect(after.coursePairs).toEqual([[before[1].courses[0].nameZh, before[2].courses[0].nameZh]]);
  });

  it("去年報名開放後調過場次順序、成對課程不再相鄰時，其他照樣複製，那一組不複製並告知", async () => {
    const venue = must(
      await admin.from("venues").insert({ conference_id: sourceId, region: "north", name_zh: "台北金華教堂" }).select("id").single(),
    ).id;
    const course = async (position: number, name: string) => {
      const session = must(
        await admin
          .from("sessions")
          .insert({ conference_id: sourceId, venue_id: venue, position, name_zh: `${name}場` })
          .select("id")
          .single(),
      ).id;
      const id = must(
        await admin.from("courses").insert({ conference_id: sourceId, session_id: session, title_zh: `${name}課` }).select("id").single(),
      ).id;
      return { session, id };
    };
    const a = await course(1, "甲");
    const b = await course(2, "乙");
    const c = await course(3, "丙");
    must(await admin.from("course_pairs").insert({ conference_id: sourceId, first_course_id: a.id, second_course_id: b.id }));
    // 開放報名後只能調排序：把丙場移到甲、乙中間。
    must(await admin.from("conferences").update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() }).eq("id", sourceId));
    must(await admin.from("sessions").update({ position: 3 }).eq("id", b.session));
    must(await admin.from("sessions").update({ position: 2 }).eq("id", c.session));

    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-05-15" });

    expect(result).toMatchObject({ ok: true, skippedCoursePairs: 1 });
    await switchedTo((result as { conferenceId: string }).conferenceId);
    const after = arrangement((await getProgramme(headAdmin))!);
    expect(after.venues[0].sessions.map((session) => session.nameZh)).toEqual(["甲場", "丙場", "乙場"]);
    expect(after.coursePairs).toEqual([]);
  });

  it("首頁內容（含歡迎詞署名，不含主視覺）、常見問題、自訂區塊、大會特色都複製過去", async () => {
    await lastYear();

    await switchedTo(await copied());

    expect(await getContentEditor(headAdmin)).toMatchObject({
      year: 2100,
      conferenceDate: "2100-05-15",
      startTime: "09:00",
      endTime: "16:00",
      themeScriptureZh: "你的兒女都要受耶和華的教訓",
      themeScriptureEn: "All thy children shall be taught of the Lord",
      welcomeZh: "歡迎姐妹們",
      welcomeSignatureZh: "2099台灣姐妹大會籌備委員會",
      welcomeSignatureEn: "2099 Organizing Committee",
      adminLineId: "@twsisters",
      // 主視覺每年不同，圖與圖片說明都不複製。
      heroImages: { mobileZh: null, mobileEn: null, desktopZh: null, desktopEn: null },
      heroAltZh: "",
      heroAltEn: "",
      faqs: [{ titleZh: "要收費嗎？", bodyZh: "不用。" }],
      customBlocks: [{ titleZh: "交通資訊", buttonLabelZh: "查看", buttonUrl: "/lookup" }],
      highlights: [
        { titleZh: "即席唱詩班", titleEn: "Choir", summaryZh: "跟著影片練唱", bodyZh: "[練唱影片](https://www.youtube.com/)" },
        { titleZh: "公益服務", summaryZh: "", bodyZh: "" },
        { titleZh: "向貴賓致敬", pageTemplate: "honor" },
      ],
    });
  });

  it("課程的講師與分類都帶過去，分類對到新年度複製出來的那一項", async () => {
    await lastYear();

    await switchedTo(await copied());

    const programme = (await getProgramme(headAdmin))!;
    const category = new Map(programme.highlights.map((highlight) => [highlight.id, highlight.nameZh]));
    const courses = programme.venues[0].sessions.flatMap((session) => session.courses);
    expect(
      courses.map((course) => [course.nameZh, course.speakerZh, course.speakerEn, course.highlightId && category.get(course.highlightId)]),
    ).toEqual([
      ["家譜入門", "蔡婷儀", "Tsai Ting-yi", null],
      ["自由選課", "", "", null],
      ["家譜進階", "", "", null],
      ["手作花圈", "余心愛", "", "公益服務"],
    ]);
  });

  it("大會程序一起帶過去，子項目的大會特色、教堂與場次都對到新年度的", async () => {
    await lastYear();

    await switchedTo(await copied());

    const agenda = (await getAgendaEditor(headAdmin))!;
    const venue = agenda.venues[0];
    const highlightName = new Map(agenda.highlights.map((highlight) => [highlight.id, highlight.nameZh]));
    expect(agenda.year).toBe(2100);
    expect(
      agenda.items.map((item) => ({
        name: item.nameZh,
        time: `${item.startTime}–${item.endTime}`,
        parts: item.parts.map((part) => [part.nameZh, part.highlightId && highlightName.get(part.highlightId)]),
        place: item.venues[venue.id].placeZh,
        session: venue.sessions.find((session) => session.id === item.venues[venue.id].sessionId)?.nameZh ?? null,
      })),
    ).toEqual([
      { name: "第一場次", time: "11:00–11:50", parts: [["公益服務", "公益服務"], ["見證", null]], place: "一樓大會堂", session: "第一場" },
      { name: "公益服務說明", time: "12:30–13:15", parts: [], place: "", session: null },
    ]);
    expect(agenda.unplacedSessions.map((session) => session.sessionNameZh)).toEqual(["第二場", "午后動態"]);
  });

  it("大會特色的教堂分頁一起帶過去，對到新年度的大會特色與教堂", async () => {
    await lastYear();

    const id = await copied();

    const rows = must(
      await admin
        .from("highlight_venues")
        .select("body_zh, body_en, highlights(conference_id, name_zh), venues(conference_id, name_zh)")
        .eq("conference_id", id),
    );
    expect(rows).toEqual([
      {
        body_zh: "在一樓大廳",
        body_en: "In the 1F lobby",
        highlights: { conference_id: id, name_zh: "公益服務" },
        venues: { conference_id: id, name_zh: "台北金華教堂" },
      },
    ]);
  });

  it("介紹頁的版型、副標、引言與人物一起帶過去，照片用同一個檔案", async () => {
    await lastYear();

    await switchedTo(await copied());

    const honor = (await getContentEditor(headAdmin))!.highlights.find((highlight) => highlight.titleZh === "向貴賓致敬")!;
    expect(honor).toMatchObject({
      pageTemplate: "honor",
      subtitleZh: "80 歲長輩",
      leadQuoteZh: "值得尊敬的姐妹",
      leadQuoteSourceEn: "Source",
      linkable: true,
    });
    expect(
      honor.people.map((person) => [person.nameZh, person.stakeZh, person.wardEn, person.photo?.path ?? null, person.photoFocus, person.linkUrl]),
    ).toEqual([
      ["沈亦斌 姐妹", "中台北支聯會", "Luzhou Ward", `${sourceId}/00000000-0000-4000-8000-000000000000.jpg`, 20, ""],
      ["黃蘋 姐妹", "", "", null, 50, "/story"],
    ]);
  });

  it("籌備委員會的文字（含執行計畫）一起帶過去", async () => {
    await lastYear();
    must(
      await admin.from("committee_texts").insert({
        conference_id: sourceId,
        introduction: "大會簡介",
        chair_message: "主席的話",
        memorandum: "備忘錄",
        execution_plan: "執行計畫",
      }),
    );

    const id = await copied();

    expect(
      must(
        await admin
          .from("committee_texts")
          .select("introduction, chair_message, memorandum, execution_plan")
          .eq("conference_id", id)
          .single(),
      ),
    ).toEqual({ introduction: "大會簡介", chair_message: "主席的話", memorandum: "備忘錄", execution_plan: "執行計畫" });
  });

  it("大會特色的新編號由去年的編號固定算出（課程的分類才對得到新年度的那一項）", async () => {
    await lastYear();
    const before = must(await admin.from("highlights").select("id").eq("conference_id", sourceId)).map((row) => row.id);

    const id = await copied();

    const after = must(await admin.from("highlights").select("id").eq("conference_id", id)).map((row) => row.id);
    expect(after).toHaveLength(3);
    expect(after.some((highlight) => before.includes(highlight))).toBe(false);
    const sql = databaseClient();
    try {
      const [{ ids }] = await sql<{ ids: string[] }[]>`
        select array_agg(extensions.uuid_generate_v5(${id}::uuid, source::text)) as ids
        from unnest(${before}::uuid[]) as source`;
      expect([...after].sort()).toEqual([...ids].sort());
    } finally {
      await sql.end();
    }
  });

  it("報名沒有被複製，新年度的名額都是空的", async () => {
    await lastYear();

    await switchedTo(await copied());

    expect((await listRegistrations(headAdmin, "")).total).toBe(0);
  });

  it("場地沿用同一個固定識別", async () => {
    await lastYear();

    const id = await copied();

    const siteKeys = async (conferenceId: string) =>
      must(await admin.from("venues").select("site_key").eq("conference_id", conferenceId)).map((venue) => venue.site_key);
    expect(await siteKeys(id)).toEqual(await siteKeys(sourceId));
  });

  it("新年度還沒開放報名，課程可以照常調整", async () => {
    await lastYear();
    await switchedTo(await copied());
    const programme = (await getProgramme(headAdmin))!;
    const session = programme.venues[0].sessions[1];

    const { error } = await headAdmin.from("sessions").delete().eq("id", session.id);

    expect(error).toBeNull();
  });

  it("新年度出現在年度列表，時程時間點是空的，還不是目前年度", async () => {
    const id = await copied();

    const years = await listConferences(headAdmin);
    expect(years.map((year) => [year.year, year.isCurrent])).toEqual(
      expect.arrayContaining([
        [2100, false],
        [2099, true],
      ]),
    );
    expect(years.find((year) => year.id === id)).toMatchObject({
      year: 2100,
      conferenceDate: "2100-05-15",
      announceAt: null,
      registrationOpensAt: null,
      registrationClosesAt: null,
    });
  });
});

describe("建立第一個年度", () => {
  /**
   * 在一個還沒有任何年度大會的資料庫裡，以 `staff` 的身分做 `work`，做完一定復原，不動到其他測試的資料。
   * 共用的測試資料庫本來就有年度，所以在交易裡先刪光，最後不提交；`work` 失敗時也一樣不提交。
   */
  async function inEmptyDatabase(staff: SupabaseClient, work: (tx: TransactionSql) => Promise<void>) {
    const userId = must(await staff.auth.getUser()).user.id;
    const db = databaseClient();
    const rollback = new Error("rollback");
    try {
      await db.begin(async (tx) => {
        await tx`delete from public.conferences`;
        await tx`set local role authenticated`;
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
        await work(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      await db.end();
    }
  }

  it("沒有任何年度時，總管理員建立空白年度：時程空著、不是目前年度、沒有場地，可以填時程設為目前年度", async () => {
    await inEmptyDatabase(headAdmin, async (tx) => {
      const [{ id }] = await tx<{ id: string }[]>`select public.create_first_conference(2100, '2100-05-15') as id`;

      const rows = await tx`select id, year, conference_date::text, is_current, announce_at, registration_opens_at,
        registration_closes_at from public.conferences`;
      expect(rows).toEqual([
        {
          id,
          year: 2100,
          conference_date: "2100-05-15",
          is_current: false,
          announce_at: null,
          registration_opens_at: null,
          registration_closes_at: null,
        },
      ]);
      expect(await tx`select id from public.venues where conference_id = ${id}`).toHaveLength(0);

      const now = Date.now();
      await tx`select public.set_current_conference(${id}, ${new Date(now - DAY)}, ${new Date(now + DAY)},
        ${new Date(now + 2 * DAY)})`;
      expect(await tx`select year from public.conferences where is_current`).toEqual([{ year: 2100 }]);
    });
  });

  it("已經有年度時不能建立，要複製去年", async () => {
    const result = await createFirstConference(headAdmin, { year: "2100", conferenceDate: "2100-05-15" });

    expect(result).toEqual({ ok: false, error: "conferences_exist" });
    expect((await listConferences(headAdmin)).map((year) => year.year)).not.toContain(2100);
  });

  it("課務組、報報組、訪客不能建立", async () => {
    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      const result = await createFirstConference(client, { year: "2100", conferenceDate: "2100-05-15" });
      expect(result).toEqual({ ok: false, error: "not_admin" });
    }
  });

  it("沒有任何年度時，課務組也不能建立", async () => {
    await inEmptyDatabase(courseTeam, async (tx) => {
      await expect(tx`select public.create_first_conference(2100, '2100-05-15')`).rejects.toThrow("not_admin");
    });
  });

  it.each(["", "99", "20a0", "1999"])("年度「%s」看不懂", async (year) => {
    const result = await createFirstConference(headAdmin, { year, conferenceDate: "2100-05-15" });
    expect(result).toEqual({ ok: false, error: "year_invalid" });
  });

  it.each(["", "2100-02-30"])("大會日期「%s」沒填或不存在", async (conferenceDate) => {
    const result = await createFirstConference(headAdmin, { year: "2100", conferenceDate });
    expect(result).toEqual({ ok: false, error: "date_invalid" });
  });

  it("大會日期不在那一年", async () => {
    const result = await createFirstConference(headAdmin, { year: "2100", conferenceDate: "2099-05-15" });
    expect(result).toEqual({ ok: false, error: "date_not_in_year" });
  });
});

describe("切換目前年度", () => {
  it("新年度填好時程後設為目前年度，首頁顯示新年度，去年變成舊年度", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: taipei(DAY),
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: true });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2100, phase: "upcoming" });
    const years = await listConferences(headAdmin);
    expect(years.find((year) => year.id === sourceId)?.isCurrent).toBe(false);
  });

  it("時程還空著又沒填時不能切換，目前年度不變", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: "",
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: false, error: "schedule_incomplete" });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("時間不依序時不能切換", async () => {
    const id = await copied();

    const result = await setCurrentConference(headAdmin, {
      conferenceId: id,
      announceAt: taipei(-DAY),
      registrationOpensAt: taipei(3 * DAY),
      registrationClosesAt: taipei(2 * DAY),
    });

    expect(result).toEqual({ ok: false, error: "schedule_order" });
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("切回時程已填好的舊年度時不必再填，原本的時程不變", async () => {
    const id = await copied();
    const before = (await listConferences(headAdmin)).find((year) => year.id === sourceId)!;
    await switchedTo(id);

    const result = await setCurrentConference(headAdmin, { conferenceId: sourceId });

    expect(result).toEqual({ ok: true });
    const after = (await listConferences(headAdmin)).find((year) => year.id === sourceId)!;
    expect(after).toEqual({ ...before, isCurrent: true });
  });
});

describe("只有總管理員能管理年度", () => {
  it("課務組、報報組不能複製年度", async () => {
    for (const staff of [courseTeam, registrationTeam]) {
      const result = await copyConference(staff, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-05-15" });
      expect(result).toEqual({ ok: false, error: "not_admin" });
    }
    expect((await listConferences(headAdmin)).map((year) => year.year)).not.toContain(2100);
  });

  it("課務組、報報組不能切換目前年度", async () => {
    const id = await copied();

    for (const staff of [courseTeam, registrationTeam]) {
      const result = await setCurrentConference(staff, {
        conferenceId: id,
        announceAt: taipei(-DAY),
        registrationOpensAt: taipei(DAY),
        registrationClosesAt: taipei(2 * DAY),
      });
      expect(result).toEqual({ ok: false, error: "not_admin" });
    }
    expect(await getCurrentConference(anonClient(), new Date())).toMatchObject({ year: 2099 });
  });

  it("課務組、報報組看得到所有年度，好選舊年度看名單", async () => {
    await copied();

    for (const staff of [courseTeam, registrationTeam]) {
      expect((await listConferences(staff)).map((year) => year.year)).toEqual(expect.arrayContaining([2100, 2099]));
    }
  });
});

describe("複製時填錯", () => {
  it("年度已經有了", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2099", conferenceDate: "2099-06-01" });
    expect(result).toEqual({ ok: false, error: "year_taken" });
  });

  it.each(["", "99", "20a0", "1999"])("年度「%s」看不懂", async (year) => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year, conferenceDate: "2100-05-15" });
    expect(result).toEqual({ ok: false, error: "year_invalid" });
  });

  it("大會日期不在新年度那一年", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2099-05-15" });
    expect(result).toEqual({ ok: false, error: "date_not_in_year" });
  });

  it("日期不存在", async () => {
    const result = await copyConference(headAdmin, { sourceConferenceId: sourceId, year: "2100", conferenceDate: "2100-02-30" });
    expect(result).toEqual({ ok: false, error: "date_invalid" });
  });
});

type Database = ReturnType<typeof databaseClient>;

/** 開一個交易做完 `work` 後先不提交，等 release() 才提交。失敗時 release() 也要呼叫，交易才會結束、放開鎖。 */
function holdOpen(client: Database, work: (tx: TransactionSql) => Promise<unknown>) {
  let release!: () => void;
  const mayCommit = new Promise<void>((resolve) => (release = resolve));
  let started!: (pid: number) => void;
  let failed!: (error: unknown) => void;
  const pid = new Promise<number>((resolve, reject) => ((started = resolve), (failed = reject)));
  const done = client.begin(async (tx) => {
    await work(tx);
    const [{ pid }] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
    started(pid);
    await mayCommit;
  });
  done.catch(failed);
  return { pid, release, done };
}

/** 正在等 `pid` 放開鎖的連線。 */
async function waitingFor(watcher: Database, pid: number): Promise<number[]> {
  const rows = await watcher<{ pid: number }[]>`
    select pid from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid))`;
  return rows.map((row) => row.pid);
}

async function waitUntil(message: string, condition: () => Promise<boolean>) {
  for (let waited = 0; !(await condition()); waited += 50) {
    if (waited > 10_000) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("切換目前年度時有人正在報名", () => {
  let venueId: string;
  let lunchId: string;
  let registrationId: string;

  // 2099 報名中：一個場地、一個午餐、一筆報名。
  beforeEach(async () => {
    venueId = must(
      await admin.from("venues").insert({ conference_id: sourceId, region: "north", name_zh: "台北金華教堂" }).select("id").single(),
    ).id;
    lunchId = must(
      await admin.from("lunch_options").insert({ conference_id: sourceId, venue_id: venueId, name_zh: "素食便當" }).select("id").single(),
    ).id;
    must(
      await admin
        .from("conferences")
        .update({ registration_opens_at: new Date(Date.now() - DAY).toISOString() })
        .eq("id", sourceId),
    );
    registrationId = must(
      await admin
        .from("registrations")
        .insert({
          conference_id: sourceId,
          venue_id: venueId,
          stake_id: stakeId,
          ward_id: wardId,
          name: "已報名的",
          phone: "0911111111",
          portrait_consented_at: new Date().toISOString(),
          locale: "zh",
        })
        .select("id")
        .single(),
    ).id;
  });

  const input = (): RegistrationInput => ({
    name: "新報名的",
    phone: "0922222222",
    noPhone: false,
    email: "",
    lineId: "",
    stakeId,
    wardId,
    venueId,
    courseIds: [],
    lunchOptionId: lunchId,
    choirPart: null,
    services: [],
    printedHandbook: false,
    portraitConsent: true,
  });
  const lookup = { name: "已報名的", phoneOrNumber: "0911111111" };

  // 先鎖住報名會碰到的那一列，讓報名讀完目前年度之後卡在那裡；這時才開始切換。
  it.each([
    ["送出報名", "lunch_options", () => lunchId, () => submitRegistration(anonClient(), input(), "zh")],
    [
      "修改報名",
      "registrations",
      () => registrationId,
      () => updateRegistration(serverClient(), { registrationId, lookup, changes: { ...input(), phone: "0911111111", lunchOptionId: null } }),
    ],
    ["取消報名", "registrations", () => registrationId, () => cancelRegistration(serverClient(), { registrationId, lookup })],
  ] as const)("%s做到一半時，切換要等它做完，報名照樣算在原本的年度", async (_, table, rowId, act) => {
    const id = await copied();
    const [holder, watcher] = [databaseClient(), databaseClient()];
    const holding = holdOpen(holder, (tx) => tx`select 1 from ${tx(`public.${table}`)} where id = ${rowId()} for update`);
    let switching: Promise<unknown> = Promise.resolve();
    try {
      const holderPid = await holding.pid;
      const acting = act();
      let actPid: number | undefined;
      await waitUntil("報名沒有卡在那一列", async () => {
        [actPid] = await waitingFor(watcher, holderPid);
        return actPid !== undefined;
      });

      switching = switchedTo(id);
      await waitUntil("切換沒有等做到一半的報名", async () => (await waitingFor(watcher, actPid!)).length === 1);
      holding.release();

      expect(await acting).toMatchObject({ ok: true });
      await switching;
      expect((await listRegistrations(headAdmin, "", 2099)).total).toBeGreaterThan(0);
    } finally {
      holding.release();
      await Promise.all([holding.done.catch(() => {}), switching.catch(() => {})]);
      await Promise.all([holder.end(), watcher.end()]);
    }
  }, 30_000);

  it("切換之後才送出的舊年度報名表，不會寫進舊年度", async () => {
    await switchedTo(await copied());

    const result = await submitRegistration(anonClient(), input(), "zh");

    expect(result.ok).toBe(false);
    expect((await listRegistrations(headAdmin, "", 2099)).items.map((item) => item.name)).toEqual(["已報名的"]);
  });
});
