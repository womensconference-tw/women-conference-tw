import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { adminClient, anonClient, must } from "../../test/supabase";
import { getHomeContent } from "./home-content";

const admin = adminClient();
let previousCurrentIds: string[] = [];
let currentId: string | undefined;
let pastId: string | undefined;

// 每個測試都把 2099 年度大會設成目前年度，另有一個不是目前年度的 2098，測完復原。
beforeEach(async () => {
  const current = must(await admin.from("conferences").select("id").eq("is_current", true));
  previousCurrentIds = current.map((row) => row.id);
  must(await admin.from("conferences").update({ is_current: false }).eq("is_current", true));

  const [past, now] = must(
    await admin
      .from("conferences")
      .insert([
        { year: 2098, conference_date: "2098-05-16", is_current: false },
        {
          year: 2099,
          conference_date: "2099-05-15",
          announce_at: "2099-03-01T09:00:00+08:00",
          registration_opens_at: "2099-04-01T09:00:00+08:00",
          registration_closes_at: "2099-05-01T00:00:00+08:00",
          is_current: true,
        },
      ])
      .select("id, year")
      .order("year"),
  );
  pastId = past.id;
  currentId = now.id;
});

afterEach(async () => {
  const fixtureIds = [pastId, currentId].filter((id) => id !== undefined);
  must(await admin.from("conferences").delete().in("id", fixtureIds));
  pastId = currentId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

describe("首頁內容", () => {
  it("列出目前年度的場地，依排序，含名稱、地址與地圖連結；沒填地址時沒有地圖", async () => {
    const [kaohsiung, taipei] = must(
      await admin
        .from("venues")
        .insert(
          [
            { conference_id: currentId, region: "south", position: 2, name_zh: "高雄鳥松教堂" },
            {
              conference_id: currentId,
              region: "north",
              position: 1,
              name_zh: "台北金華教堂",
              address_zh: "台北市大安區金華街",
              features_zh: "另有午后動態",
            },
            { region: "north", conference_id: pastId, position: 0, name_zh: "去年的場地" },
          ],
          { defaultToNull: false },
        )
        .select("id"),
    );

    const content = await getHomeContent(anonClient(), "zh");

    expect(content?.venues).toEqual([
      {
        id: taipei.id,
        name: "台北金華教堂",
        address: "台北市大安區金華街",
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("台北市大安區金華街")}`,
        agenda: [],
      },
      { id: kaohsiung.id, name: "高雄鳥松教堂", address: "", mapUrl: null, agenda: [] },
    ]);
  });

  it("大會程序：每間教堂各自的地點、說明與場次課程；課程依分類分組，標出連續兩堂，不帶教室", async () => {
    const insert = async (table: string, row: Record<string, unknown>) =>
      must(await admin.from(table).insert({ conference_id: currentId, ...row }).select("id").single()).id as string;
    const choir = await insert("highlights", { position: 1, name_zh: "即席唱詩班", description_zh: "# 唱詩班" });
    const corner = await insert("highlights", { position: 3, name_zh: "角落課程", name_en: "Corner classes" });
    const spiritual = await insert("highlights", { position: 2, name_zh: "靈性課程", description_zh: "介紹" });
    const jinhua = await insert("venues", { position: 1, region: "north", name_zh: "台北金華教堂" });
    const daya = await insert("venues", { position: 2, region: "central", name_zh: "台中大雅教堂" });
    const second = await insert("sessions", { venue_id: jinhua, position: 2, name_zh: "第二場次", name_en: "Session 2" });
    const third = await insert("sessions", { venue_id: jinhua, position: 3, name_zh: "第三場次", name_en: "Session 3" });
    const course = (session: string, position: number, title: string, extra: Record<string, unknown> = {}) =>
      insert("courses", { session_id: session, position, title_zh: title, ...extra });
    const bread = await course(second, 3, "免揉歐式麵包", { highlight_id: corner, speaker_zh: "王淑娟" });
    await course(second, 1, "寫下生活也寫下愛", { highlight_id: spiritual, speaker_zh: "林翁娟", speaker_en: "Lin" });
    await course(second, 2, "家譜入門");
    await course(second, 0, "運用福音原則", { highlight_id: spiritual });
    const breadAgain = await course(third, 1, "免揉歐式麵包", { highlight_id: corner });
    must(await admin.from("course_pairs").insert({ conference_id: currentId, first_course_id: bread, second_course_id: breadAgain }));
    must(await admin.from("course_classrooms").insert({ course_id: bread, classroom: "102 + 103" }));

    const [opening, session] = [
      await insert("agenda_items", { position: 1, start_time: "09:30", end_time: "10:30", name_zh: "開幕式" }),
      await insert("agenda_items", { position: 2, start_time: "13:30", end_time: "14:15", name_zh: "第二場次" }),
    ];
    must(
      await admin.from("agenda_item_parts").insert([
        { conference_id: currentId, agenda_item_id: opening, position: 2, name_zh: "見證" },
        { conference_id: currentId, agenda_item_id: opening, position: 1, name_zh: "即席唱詩班", highlight_id: choir },
        { conference_id: currentId, agenda_item_id: opening, position: 3, name_zh: "角落", highlight_id: corner },
      ], { defaultToNull: false }),
    );
    must(
      await admin.from("agenda_item_venues").insert([
        { conference_id: currentId, agenda_item_id: opening, venue_id: jinhua, place_zh: "一樓大會堂", note_zh: "請提早入座" },
        { conference_id: currentId, agenda_item_id: opening, venue_id: daya, place_zh: "3F 大會堂" },
        { conference_id: currentId, agenda_item_id: session, venue_id: jinhua, session_id: second },
      ], { defaultToNull: false }),
    );

    const content = await getHomeContent(anonClient(), "zh");

    const [jinhuaAgenda, dayaAgenda] = content!.venues.map((venue) => venue.agenda);
    // 子項目只有寫了介紹內容的大會特色才連過去。
    const parts = [
      { name: "即席唱詩班", highlightId: choir },
      { name: "見證", highlightId: null },
      { name: "角落", highlightId: null },
    ];
    expect(jinhuaAgenda).toEqual([
      { start: "09:30", end: "10:30", name: "開幕式", place: "一樓大會堂", note: "請提早入座", parts, courseGroups: null },
      {
        start: "13:30",
        end: "14:15",
        name: "第二場次",
        place: "",
        note: "",
        parts: [],
        courseGroups: [
          {
            category: { name: "靈性課程", highlightId: spiritual },
            courses: [
              { title: "運用福音原則", speaker: "", pairedWith: null },
              { title: "寫下生活也寫下愛", speaker: "林翁娟", pairedWith: null },
            ],
          },
          {
            category: { name: "角落課程", highlightId: null },
            courses: [
              { title: "免揉歐式麵包", speaker: "王淑娟", pairedWith: { sessionName: "第三場次", isSecond: false } },
            ],
          },
          { category: null, courses: [{ title: "家譜入門", speaker: "", pairedWith: null }] },
        ],
      },
    ]);
    // 大雅沒有接場次，也沒有說明。
    expect(dayaAgenda.map((row) => [row.place, row.note, row.courseGroups])).toEqual([
      ["3F 大會堂", "", null],
      ["", "", null],
    ]);
  });

  it("大會程序英文版：連續兩堂的後面那一堂寫出前一個場次，英文缺漏時顯示中文", async () => {
    const insert = async (table: string, row: Record<string, unknown>) =>
      must(await admin.from(table).insert({ conference_id: currentId, ...row }).select("id").single()).id as string;
    const venue = await insert("venues", { region: "north", name_zh: "台北金華教堂", name_en: "Taipei Jinhua Chapel" });
    const second = await insert("sessions", { venue_id: venue, position: 2, name_zh: "第二場次", name_en: "Session 2" });
    const third = await insert("sessions", { venue_id: venue, position: 3, name_zh: "第三場次" });
    const first = await insert("courses", { session_id: second, title_zh: "麵包", title_en: "Bread" });
    const again = await insert("courses", { session_id: third, title_zh: "麵包" });
    must(await admin.from("course_pairs").insert({ conference_id: currentId, first_course_id: first, second_course_id: again }));
    const item = await insert("agenda_items", { start_time: "14:30", end_time: "15:15", name_zh: "第三場次" });
    must(await admin.from("agenda_item_venues").insert({ conference_id: currentId, agenda_item_id: item, venue_id: venue, session_id: third }));

    const content = await getHomeContent(anonClient(), "en");

    expect(content!.venues[0].agenda[0]).toMatchObject({
      name: "第三場次",
      courseGroups: [{ category: null, courses: [{ title: "麵包", pairedWith: { sessionName: "Session 2", isSecond: true } }] }],
    });
  });

  it("依排序列出目前年度的自訂區塊；英文缺漏的欄位顯示中文", async () => {
    must(
      await admin.from("custom_blocks").insert(
        [
          {
            conference_id: currentId,
            position: 2,
            title_zh: "交通管制",
            title_en: "",
            body_zh: "當天金華街封路。",
            body_en: "Jinhua Street is closed that day.",
          },
          {
            conference_id: currentId,
            position: 1,
            title_zh: "志工招募",
            title_en: "Volunteers wanted",
            body_zh: "歡迎報名擔任志工。",
            body_en: "",
            button_label_zh: "填寫志工表單",
            button_label_en: "Volunteer form",
            button_url: "https://example.org/volunteer",
          },
          { conference_id: pastId, position: 0, title_zh: "去年的公告" },
        ],
        { defaultToNull: false },
      ),
    );

    const content = await getHomeContent(anonClient(), "en");

    expect(content?.customBlocks).toEqual([
      {
        title: "Volunteers wanted",
        body: "歡迎報名擔任志工。",
        button: { label: "Volunteer form", url: "https://example.org/volunteer" },
      },
      { title: "交通管制", body: "Jinhua Street is closed that day.", button: null },
    ]);
  });

  it("關於大會：主題經文、歡迎詞與依排序的常見問題", async () => {
    must(
      await admin
        .from("conferences")
        .update({
          theme_scripture_zh: "你的兒女都要受耶和華的教訓。",
          theme_scripture_en: "All thy children shall be taught of the Lord.",
          theme_scripture_reference_zh: "以賽亞書 54:13",
          theme_scripture_reference_en: "Isaiah 54:13",
          welcome_zh: "親愛的姐妹們，歡迎！",
          welcome_en: "",
        })
        .eq("id", currentId!),
    );
    must(
      await admin.from("faqs").insert([
        {
          conference_id: currentId,
          position: 2,
          question_zh: "要帶什麼？",
          question_en: "What should I bring?",
          answer_zh: "經文。",
          answer_en: "Your scriptures.",
        },
        {
          conference_id: currentId,
          position: 1,
          question_zh: "要收費嗎？",
          question_en: "Is there a fee?",
          answer_zh: "免費。",
          answer_en: "It is free.",
        },
        {
          conference_id: pastId,
          position: 0,
          question_zh: "去年的問題",
          question_en: "",
          answer_zh: "去年的回答",
          answer_en: "",
        },
      ]),
    );

    const content = await getHomeContent(anonClient(), "en");

    expect(content?.themeScripture).toEqual({
      text: "All thy children shall be taught of the Lord.",
      reference: "Isaiah 54:13",
    });
    expect(content?.welcome).toBe("親愛的姐妹們，歡迎！");
    expect(content?.faqs).toEqual([
      { question: "Is there a fee?", answer: "It is free." },
      { question: "What should I bring?", answer: "Your scriptures." },
    ]);
  });

  it("大會當天的開始與結束時間", async () => {
    must(
      await admin
        .from("conferences")
        .update({ start_time: "09:00", end_time: "16:30" })
        .eq("id", currentId!),
    );

    const content = await getHomeContent(anonClient(), "zh");

    expect(content?.time).toEqual({ start: "09:00", end: "16:30" });
  });

  it("還沒填時間時沒有時間", async () => {
    const content = await getHomeContent(anonClient(), "zh");

    expect(content?.time).toBeNull();
  });

  // 個人 LINE ID 與官方帳號（@ 開頭）的加好友連結格式不同。
  it.each([
    { kind: "個人 ID", id: "twwc-admin", url: "https://line.me/ti/p/~twwc-admin" },
    { kind: "官方帳號", id: "@twwc", url: "https://line.me/R/ti/p/%40twwc" },
  ])("管理員 LINE 是$kind時附上加好友連結", async ({ id, url }) => {
    must(await admin.from("conferences").update({ admin_line_id: id }).eq("id", currentId!));

    const content = await getHomeContent(anonClient(), "zh");

    expect(content?.adminLine).toEqual({ id, url });
  });

  it("還沒填管理員 LINE 時沒有 LINE", async () => {
    const content = await getHomeContent(anonClient(), "zh");

    expect(content?.adminLine).toBeNull();
  });

  // 直接讀資料表也一樣，不是只靠查詢條件過濾。
  it.each([
    { table: "venues", row: { region: "north", name_zh: "場地" } },
    { table: "faqs", row: { question_zh: "問題", answer_zh: "回答" } },
    { table: "custom_blocks", row: { title_zh: "區塊" } },
  ])("匿名訪客讀不到不是目前年度的 $table", async ({ table, row }) => {
    must(
      await admin.from(table).insert([
        { conference_id: currentId, ...row },
        { conference_id: pastId, ...row },
      ]),
    );

    const visible = must(await anonClient().from(table).select("conference_id"));

    expect(visible).toEqual([{ conference_id: currentId }]);
  });

  // 按鈕網址會直接放進連結，只能是 http(s) 網址或站內路徑，不能偷渡到別的網站或協定。
  it.each([
    "javascript:alert(1)",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://",
    "https://   ",
    "https://exa mple.org",
  ])("自訂區塊的按鈕網址 %j 存不進去", async (url) => {
    const { error } = await admin.from("custom_blocks").insert({
      conference_id: currentId,
      title_zh: "區塊",
      button_label_zh: "按鈕",
      button_url: url,
    });

    expect(error?.code).toBe("23514");
  });

  it.each(["https://example.org/a?b=1", "HTTPS://Example.org", "http://example.org", "/lookup", "/"])(
    "自訂區塊的按鈕網址 %j 可以存",
    async (url) => {
      const { error } = await admin.from("custom_blocks").insert({
        conference_id: currentId,
        title_zh: "區塊",
        button_label_zh: "按鈕",
        button_url: url,
      });

      expect(error).toBeNull();
    },
  );

  // 只有空白、tab 或換行的文字，畫面上會變成看不見的標題或按鈕。
  it.each([
    { table: "venues", row: { region: "north", name_zh: "\n\t " } },
    { table: "faqs", row: { question_zh: "\n", answer_zh: "回答" } },
    { table: "faqs", row: { question_zh: "問題", answer_zh: "\t" } },
    { table: "custom_blocks", row: { title_zh: "\n" } },
    { table: "custom_blocks", row: { title_zh: "區塊", button_label_zh: "\n", button_url: "/" } },
  ])("$table 的必填文字只有空白時存不進去：$row", async ({ table, row }) => {
    const { error } = await admin.from(table).insert({ conference_id: currentId, ...row });

    expect(error?.code).toBe("23514");
  });
});

