import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";

/*
 * 首頁、大會特色、大會程序、籌備委員會網站已經移到大會網站（#126），資料先留著（#128）。
 * 訪客用網站公開的 publishable key 不能再讀到這些資料：資料表、目前年度只給舊首頁用的欄位、
 * 會回傳這些資料的函式，以及存放空間裡的圖片。
 */

const anon = anonClient();
const admin = adminClient();
let headAdmin: SupabaseClient;

const removedTables = [
  "highlights",
  "highlight_venues",
  "highlight_venue_team",
  "highlight_people",
  "agenda_items",
  "agenda_item_parts",
  "agenda_item_venues",
  "faqs",
  "custom_blocks",
  "committee_texts",
  "committee_meetings",
  "committee_links",
  "committee_team_members",
  "committee_members",
];

const removedConferenceColumns = [
  "theme_scripture_zh",
  "theme_scripture_en",
  "theme_scripture_reference_zh",
  "theme_scripture_reference_en",
  "welcome_zh",
  "welcome_en",
  "welcome_signature_zh",
  "welcome_signature_en",
  "admin_line_id",
  "hero_mobile_zh_path",
  "hero_mobile_en_path",
  "hero_desktop_zh_path",
  "hero_desktop_en_path",
  "hero_alt_zh",
  "hero_alt_en",
];

const buckets = ["hero-images", "highlight-images", "committee-photos"];
const imagePath = `test/${crypto.randomUUID()}.png`;
// 最小的 PNG 檔頭就夠了，存放空間只看 content type。
const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" });

beforeAll(async () => {
  const user = must(await admin.auth.admin.createUser({ email: "removed-content-head@example.com", email_confirm: true })).user;
  must(await admin.from("staff_members").insert({ user_id: user.id, role: "admin", region: null }));
  headAdmin = await signedInClient("removed-content-head@example.com");
  for (const bucket of buckets) {
    must(await admin.storage.from(bucket).upload(imagePath, png, { contentType: "image/png" }));
  }
});

afterAll(async () => {
  for (const bucket of buckets) {
    must(await admin.storage.from(bucket).remove([imagePath]));
  }
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users.filter((u) => u.email === "removed-content-head@example.com")) {
    must(await admin.from("staff_members").delete().eq("user_id", user.id));
    must(await admin.auth.admin.deleteUser(user.id));
  }
});

describe("訪客讀不到已移除功能的資料", () => {
  it.each(removedTables)("資料表 %s", async (table) => {
    const { error } = await anon.from(table).select("*").limit(1);
    expect(error?.code).toBe("42501");
  });

  it.each(removedConferenceColumns)("目前年度的 %s 欄位", async (column) => {
    const { error } = await anon.from("conferences").select(column).eq("is_current", true);
    expect(error?.code).toBe("42501");
  });

  it("目前年度的報名資訊照樣讀得到", async () => {
    const data = must(
      await anon
        .from("conferences")
        .select(
          "id, year, conference_date, start_time, end_time, is_current, announce_at, registration_opens_at, registration_closes_at, personal_data_cleared_at, created_at, updated_at",
        )
        .eq("is_current", true),
    );
    expect(data).toHaveLength(1);
  });

  it("課程的分類 highlight_id", async () => {
    const { error } = await anon.from("courses").select("highlight_id").limit(1);
    expect(error?.code).toBe("42501");
  });

  it.each([
    ["list_public_committee_years", {}],
    ["committee_stakes", { p_conference_id: crypto.randomUUID() }],
    ["highlight_people_units", { p_highlight_id: crypto.randomUUID() }],
    ["is_public_committee_year", { p_conference_id: crypto.randomUUID() }],
  ])("函式 %s 已經拿掉", async (fn, args) => {
    const { error } = await anon.rpc(fn, args);
    expect(error?.code).toBe("PGRST202");
  });

  it.each(buckets)("存放空間 %s 的公開網址", async (bucket) => {
    const response = await fetch(`${inject("supabaseUrl")}/storage/v1/object/public/${bucket}/${imagePath}`);
    await response.body?.cancel();
    expect(response.ok).toBe(false);
  });

  it.each(buckets)("存放空間 %s 用 API 下載", async (bucket) => {
    const { data, error } = await anon.storage.from(bucket).download(imagePath);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });
});

describe("總管理員照樣讀得到存放空間的圖片", () => {
  it.each(buckets)("存放空間 %s", async (bucket) => {
    const data = must(await headAdmin.storage.from(bucket).download(imagePath));
    expect(data?.size).toBe(png.size);
  });
});
