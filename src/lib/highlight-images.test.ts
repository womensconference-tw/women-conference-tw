import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient, anonClient, must, signedInClient } from "../../test/supabase";
import {
  checkHighlightImage,
  HIGHLIGHT_IMAGE_BUCKET,
  HIGHLIGHT_IMAGE_MAX_BYTES,
  highlightImagePath,
  isHighlightImageUrl,
} from "./highlight-images";

/*
 * 大會特色介紹內容與教堂分頁裡的圖片（#102）：格式與大小、檔案路徑、哪些網址算是後台上傳的、誰能上傳。
 */

const admin = adminClient();
// 最小的 PNG（1×1 透明），存放空間只看格式與大小，不檢查內容。
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (char) => char.charCodeAt(0),
);
const FOLDER = "00000000-0000-4000-8000-000000000102";

let headAdmin: SupabaseClient;
let courseTeam: SupabaseClient;

// 一位總管理員、一位北區課務組；測完連同上傳的圖全部刪掉。
beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", inject("supabaseUrl"));
  const staff = [
    { email: "head@example.com", role: "admin", region: null },
    { email: "course@example.com", role: "course_team", region: "north" },
  ];
  for (const { email, ...scope } of staff) {
    const user = must(await admin.auth.admin.createUser({ email, email_confirm: true })).user;
    must(await admin.from("staff_members").insert({ user_id: user.id, ...scope }));
  }
  [headAdmin, courseTeam] = await Promise.all(staff.map(({ email }) => signedInClient(email)));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  must(await admin.from("staff_members").delete().not("user_id", "is", null));
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) must(await admin.auth.admin.deleteUser(user.id));
  const files = must(await admin.storage.from(HIGHLIGHT_IMAGE_BUCKET).list(FOLDER)) ?? [];
  if (files.length > 0) must(await admin.storage.from(HIGHLIGHT_IMAGE_BUCKET).remove(files.map((file) => `${FOLDER}/${file.name}`)));
});

const upload = (client: SupabaseClient, path: string) =>
  client.storage.from(HIGHLIGHT_IMAGE_BUCKET).upload(path, new Blob([PNG], { type: "image/png" }), { contentType: "image/png" });

describe("大會特色的圖片", () => {
  it("只收 JPG、PNG、WebP，5 MB 以內", () => {
    expect(checkHighlightImage("image/jpeg", HIGHLIGHT_IMAGE_MAX_BYTES)).toBeNull();
    expect(checkHighlightImage("image/png", 10)).toBeNull();
    expect(checkHighlightImage("image/webp", 10)).toBeNull();
    expect(checkHighlightImage("image/gif", 10)).toBe("file_type");
    expect(checkHighlightImage("image/png", HIGHLIGHT_IMAGE_MAX_BYTES + 1)).toBe("file_too_large");
  });

  it("檔案路徑在年度的資料夾裡，每次都是新檔名", () => {
    const path = highlightImagePath(FOLDER, "image/webp");
    expect(path).toMatch(new RegExp(`^${FOLDER}/[0-9a-f-]{36}\\.webp$`));
    expect(highlightImagePath(FOLDER, "image/webp")).not.toBe(path);
  });

  it("總管理員上傳後，任何人都打得開公開網址，網址算是後台上傳的圖片", async () => {
    const path = highlightImagePath(FOLDER, "image/png");
    must(await upload(headAdmin, path));
    const url = anonClient().storage.from(HIGHLIGHT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
    expect(isHighlightImageUrl(url)).toBe(true);
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("不是總管理員、沒登入都不能上傳", async () => {
    expect((await upload(courseTeam, highlightImagePath(FOLDER, "image/png"))).error).not.toBeNull();
    expect((await upload(anonClient(), highlightImagePath(FOLDER, "image/png"))).error).not.toBeNull();
    expect(must(await admin.storage.from(HIGHLIGHT_IMAGE_BUCKET).list(FOLDER))).toEqual([]);
  });

  it("別的網站、別的存放空間、路徑不對的網址不算", () => {
    const base = `${inject("supabaseUrl")}/storage/v1/object/public`;
    const file = `${FOLDER}/00000000-0000-4000-8000-000000000001.png`;
    expect(isHighlightImageUrl(`${base}/highlight-images/${file}`)).toBe(true);
    expect(isHighlightImageUrl(`https://example.org/storage/v1/object/public/highlight-images/${file}`)).toBe(false);
    expect(isHighlightImageUrl(`${base}/hero-images/${file}`)).toBe(false);
    expect(isHighlightImageUrl(`${base}/highlight-images/${file}?x=1`)).toBe(false);
    expect(isHighlightImageUrl(`${base}/highlight-images/../hero-images/${file}`)).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(isHighlightImageUrl(`${base}/highlight-images/${file}`)).toBe(false);
  });
});
