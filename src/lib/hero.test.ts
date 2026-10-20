import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import { getContentEditor } from "./content";
import {
  attachHeroImage,
  checkHeroFile,
  HERO_BUCKET,
  HERO_MAX_BYTES,
  heroImagePath,
  heroRatioOff,
  pickHeroPaths,
  removeHeroImage,
  saveHeroAlt,
  type HeroPaths,
  type HeroSlot,
} from "./hero";
import { getHomeContent } from "./home-content";

const admin = adminClient();
const DAY = 24 * 60 * 60 * 1000;
// 最小的 PNG（1×1 透明），存放空間只看格式與大小，不檢查內容。
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);

let previousCurrentIds: string[] = [];
let conferenceId: string | undefined;
let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;
let registrationTeam: SupabaseClient;

// 每個測試有一個 2099 目前年度（已公告上線）、一位總管理員、一位北區課務組、一位北區報報組；測完連同上傳的圖全部刪掉。
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
        theme_scripture_zh: "你要把你的重擔卸給耶和華",
        is_current: true,
      })
      .select("id")
      .single(),
  ).id;

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
  if (conferenceId) {
    const files = must(await admin.storage.from(HERO_BUCKET).list(conferenceId)) ?? [];
    if (files.length > 0) must(await admin.storage.from(HERO_BUCKET).remove(files.map((file) => `${conferenceId}/${file.name}`)));
    must(await admin.from("conferences").delete().eq("id", conferenceId));
  }
  conferenceId = undefined;
  if (previousCurrentIds.length > 0) {
    must(await admin.from("conferences").update({ is_current: true }).in("id", previousCurrentIds));
  }
});

/** 像後台一樣：瀏覽器上傳到存放空間，再把路徑記到年度大會上。回傳路徑。 */
async function uploaded(slot: HeroSlot, client = headAdmin) {
  const path = heroImagePath(conferenceId!, slot, "image/png");
  must(await client.storage.from(HERO_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" }));
  const result = await attachHeroImage(client, { conferenceId: conferenceId!, slot, path });
  if (!result.ok) throw new Error(`記錄主視覺失敗：${result.error}`);
  return path;
}

async function storedFiles() {
  return (must(await admin.storage.from(HERO_BUCKET).list(conferenceId!)) ?? []).map((file) => `${conferenceId}/${file.name}`).sort();
}

async function alt(altZh = "2099 主視覺：你要把你的重擔卸給耶和華", altEn = "") {
  expect(await saveHeroAlt(headAdmin, { conferenceId: conferenceId!, altZh, altEn })).toEqual({ ok: true });
}

describe("上傳前的檢查", () => {
  it("只收 JPG、PNG、WebP，5 MB 以內", () => {
    expect(checkHeroFile("image/jpeg", HERO_MAX_BYTES)).toBeNull();
    expect(checkHeroFile("image/png", 1)).toBeNull();
    expect(checkHeroFile("image/webp", 1)).toBeNull();
    expect(checkHeroFile("image/gif", 1)).toBe("file_type");
    expect(checkHeroFile("application/pdf", 1)).toBe("file_type");
    expect(checkHeroFile("image/jpeg", HERO_MAX_BYTES + 1)).toBe("file_too_large");
  });

  it("長寬比和建議的差超過一成時提醒", () => {
    expect(heroRatioOff("mobileZh", 1080, 1350)).toBe(false);
    expect(heroRatioOff("mobileEn", 1000, 1300)).toBe(false);
    expect(heroRatioOff("mobileZh", 1080, 1080)).toBe(true);
    expect(heroRatioOff("desktopZh", 2400, 800)).toBe(false);
    expect(heroRatioOff("desktopEn", 1920, 1080)).toBe(true);
  });

  it("檔案路徑在年度的資料夾裡，每次都是新檔名", () => {
    const path = heroImagePath("00000000-0000-4000-8000-000000000001", "desktopEn", "image/webp");
    expect(path).toMatch(/^00000000-0000-4000-8000-000000000001\/desktop-en-[0-9a-f-]{36}\.webp$/);
    expect(heroImagePath("00000000-0000-4000-8000-000000000001", "desktopEn", "image/webp")).not.toBe(path);
  });
});

describe("首頁要顯示哪一張", () => {
  const none: HeroPaths = { mobileZh: null, mobileEn: null, desktopZh: null, desktopEn: null };

  it("依語言與螢幕寬度挑，英文沒有就用中文，電腦版沒有就用手機版，反過來也一樣", () => {
    const all = { mobileZh: "mz", mobileEn: "me", desktopZh: "dz", desktopEn: "de" };
    expect(pickHeroPaths(all, "zh")).toEqual({ mobile: "mz", desktop: "dz" });
    expect(pickHeroPaths(all, "en")).toEqual({ mobile: "me", desktop: "de" });
    expect(pickHeroPaths({ ...none, mobileZh: "mz", desktopZh: "dz" }, "en")).toEqual({ mobile: "mz", desktop: "dz" });
    expect(pickHeroPaths({ ...none, mobileZh: "mz" }, "zh")).toEqual({ mobile: "mz", desktop: "mz" });
    expect(pickHeroPaths({ ...none, desktopZh: "dz" }, "zh")).toEqual({ mobile: "dz", desktop: "dz" });
    expect(pickHeroPaths({ ...none, mobileZh: "mz", desktopEn: "de" }, "en")).toEqual({ mobile: "mz", desktop: "de" });
  });

  it("四張都沒有，或中文版只有英文圖時，沒有圖（首頁顯示主題經文）", () => {
    expect(pickHeroPaths(none, "zh")).toBeNull();
    expect(pickHeroPaths(none, "en")).toBeNull();
    expect(pickHeroPaths({ ...none, mobileEn: "me" }, "zh")).toBeNull();
  });
});

describe("總管理員上傳、更換、刪除主視覺", () => {
  it("上傳後首頁用公開網址顯示，任何人都打得開；沒有圖時首頁沒有主視覺", async () => {
    expect((await getHomeContent(anonClient(), "zh"))!.hero).toBeNull();
    await alt("2099 主視覺", "2099 key visual");

    const mobile = await uploaded("mobileZh");

    const zh = (await getHomeContent(anonClient(), "zh"))!.hero!;
    expect(zh).toEqual({ mobileUrl: expect.stringContaining(mobile), desktopUrl: zh.mobileUrl, alt: "2099 主視覺" });
    expect((await getHomeContent(anonClient(), "en"))!.hero!.alt).toBe("2099 key visual");
    const response = await fetch(zh.mobileUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    expect((await getContentEditor(headAdmin))!.heroImages).toMatchObject({
      mobileZh: { path: mobile, url: zh.mobileUrl },
      mobileEn: null,
      desktopZh: null,
      desktopEn: null,
    });
  });

  it("換圖時舊檔一併刪除；刪圖時檔案也刪除", async () => {
    await alt();
    const first = await uploaded("desktopZh");
    const second = await uploaded("desktopZh");
    expect(await storedFiles()).toEqual([second]);

    expect(await removeHeroImage(headAdmin, { conferenceId: conferenceId!, slot: "desktopZh" })).toEqual({ ok: true });
    expect(await storedFiles()).toEqual([]);
    expect((await getContentEditor(headAdmin))!.heroImages.desktopZh).toBeNull();
    expect(first).not.toBe(second);
  });

  it("有圖時中文圖片說明一定要填：沒填不能記圖，有圖時也不能清空說明", async () => {
    const path = heroImagePath(conferenceId!, "mobileZh", "image/png");
    must(await headAdmin.storage.from(HERO_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" }));
    expect(await attachHeroImage(headAdmin, { conferenceId: conferenceId!, slot: "mobileZh", path })).toEqual({
      ok: false,
      error: "alt_required",
    });

    await alt();
    expect(await attachHeroImage(headAdmin, { conferenceId: conferenceId!, slot: "mobileZh", path })).toEqual({ ok: true });
    expect(await saveHeroAlt(headAdmin, { conferenceId: conferenceId!, altZh: " ", altEn: "Key visual" })).toEqual({
      ok: false,
      error: "alt_required",
    });

    // 圖都刪掉之後可以清空。
    await removeHeroImage(headAdmin, { conferenceId: conferenceId!, slot: "mobileZh" });
    expect(await saveHeroAlt(headAdmin, { conferenceId: conferenceId!, altZh: "", altEn: "" })).toEqual({ ok: true });
  });

  it("路徑要是這個年度、這個位置的檔案", async () => {
    await alt();
    const other = "00000000-0000-4000-8000-000000000001";
    for (const path of [
      heroImagePath(other, "mobileZh", "image/png"),
      heroImagePath(conferenceId!, "desktopZh", "image/png"),
      `${conferenceId}/mobile-zh-../../secret.png`,
    ]) {
      expect(await attachHeroImage(headAdmin, { conferenceId: conferenceId!, slot: "mobileZh", path })).toEqual({
        ok: false,
        error: "upload_failed",
      });
    }
    // 直接寫資料庫也被擋下。
    const { error } = await headAdmin
      .from("conferences")
      .update({ hero_mobile_zh_path: heroImagePath(other, "mobileZh", "image/png") })
      .eq("id", conferenceId!);
    expect(error?.message).toContain("conferences_hero_paths_valid");
  });

  it("不是目前年度的不能改", async () => {
    const other = must(await admin.from("conferences").insert({ year: 2098, conference_date: "2098-05-15" }).select("id").single()).id;
    try {
      const path = heroImagePath(other, "mobileZh", "image/png");
      expect(await attachHeroImage(headAdmin, { conferenceId: other, slot: "mobileZh", path })).toEqual({ ok: false, error: "not_found" });
      expect(await removeHeroImage(headAdmin, { conferenceId: other, slot: "mobileZh" })).toEqual({ ok: false, error: "not_found" });
      expect(await saveHeroAlt(headAdmin, { conferenceId: other, altZh: "舊的", altEn: "" })).toEqual({ ok: false, error: "not_found" });
    } finally {
      must(await admin.from("conferences").delete().eq("id", other));
    }
  });

  it("存放空間只收圖片格式，單張 5 MB 以內", async () => {
    const pdf = `${conferenceId}/mobile-zh-${crypto.randomUUID()}.png`;
    const wrongType = await headAdmin.storage
      .from(HERO_BUCKET)
      .upload(pdf, new Blob(["%PDF-1.4"], { type: "application/pdf" }), { contentType: "application/pdf" });
    expect(wrongType.error).not.toBeNull();

    const big = await headAdmin.storage
      .from(HERO_BUCKET)
      .upload(heroImagePath(conferenceId!, "mobileZh", "image/png"), new Blob([new Uint8Array(HERO_MAX_BYTES + 1)], { type: "image/png" }), {
        contentType: "image/png",
      });
    expect(big.error).not.toBeNull();
    expect(await storedFiles()).toEqual([]);
  });
});

describe("只有總管理員能上傳、刪除", () => {
  it("課務組、報報組與訪客不能上傳到存放空間，也不能記圖、刪圖、改說明", async () => {
    await alt();
    const kept = await uploaded("mobileZh");

    for (const client of [courseTeam, registrationTeam, anonClient()]) {
      const path = heroImagePath(conferenceId!, "mobileEn", "image/png");
      const upload = await client.storage.from(HERO_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });
      expect(upload.error).not.toBeNull();
      expect(await attachHeroImage(client, { conferenceId: conferenceId!, slot: "mobileZh", path: kept })).toEqual({
        ok: false,
        error: "not_admin",
      });
      expect(await removeHeroImage(client, { conferenceId: conferenceId!, slot: "mobileZh" })).toEqual({ ok: false, error: "not_admin" });
      expect(await saveHeroAlt(client, { conferenceId: conferenceId!, altZh: "被改了", altEn: "" })).toEqual({ ok: false, error: "not_admin" });

      // 直接刪檔、直接改欄位也不行。
      const removed = await client.storage.from(HERO_BUCKET).remove([kept]);
      expect(removed.data ?? []).toEqual([]);
      const updated = await client.from("conferences").update({ hero_mobile_zh_path: null }).eq("id", conferenceId!).select("id");
      expect(updated.data ?? []).toEqual([]);
    }

    expect(await storedFiles()).toEqual([kept]);
    expect((await getContentEditor(headAdmin))!.heroImages.mobileZh?.path).toBe(kept);
  });
});
