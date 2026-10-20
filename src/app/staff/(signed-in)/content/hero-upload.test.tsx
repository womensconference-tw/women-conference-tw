// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HERO_MAX_BYTES } from "@/lib/hero";
import { HeroUpload } from "./hero-upload";

// 瀏覽器端的存放空間、伺服器動作與換頁都換掉，只看這個元件做的事。
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const upload = vi.fn();
const remove = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload, remove }) } }),
}));
const attach = vi.fn();
vi.mock("./actions", () => ({ attachHeroImageAction: (input: unknown) => attach(input) }));

const CONFERENCE = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  // jsdom 沒有實作圖片網址；量長寬比用不到真的圖。
  URL.createObjectURL = () => "blob:hero";
  URL.revokeObjectURL = () => {};
  push.mockReset();
  upload.mockReset().mockResolvedValue({ data: {}, error: null });
  remove.mockReset().mockResolvedValue({ data: [], error: null });
  attach.mockReset().mockResolvedValue({ ok: true });
});

afterEach(cleanup);

function renderUpload() {
  render(<HeroUpload conferenceId={CONFERENCE} slot="mobileZh" label="上傳圖片" ratioHint="4:5，建議 1080×1350。" />);
}

const file = (type: string, size = 10) => new File([new Uint8Array(size)], "hero", { type });

describe("上傳主視覺", () => {
  it("格式不對、超過 5 MB 時說明原因，不上傳", async () => {
    // applyAccept 關掉：要模擬使用者硬選了不收的格式（有些瀏覽器的選檔視窗可以改成「所有檔案」）。
    const user = userEvent.setup({ applyAccept: false });
    renderUpload();

    await user.upload(screen.getByLabelText("上傳圖片"), file("image/gif"));
    expect(screen.getByRole("alert").textContent).toBe("只收 JPG、PNG、WebP 格式的圖片。");
    await user.click(screen.getByRole("button", { name: "上傳" }));
    expect(upload).not.toHaveBeenCalled();

    await user.upload(screen.getByLabelText("上傳圖片"), file("image/jpeg", HERO_MAX_BYTES + 1));
    expect(screen.getByRole("alert").textContent).toContain("超過 5 MB");
    await user.click(screen.getByRole("button", { name: "上傳" }));
    expect(upload).not.toHaveBeenCalled();
  });

  it("上傳到這個年度的資料夾，記好路徑後回到首頁內容頁說明已上傳", async () => {
    const user = userEvent.setup();
    renderUpload();

    await user.upload(screen.getByLabelText("上傳圖片"), file("image/webp"));
    await user.click(screen.getByRole("button", { name: "上傳" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/content?done=heroUploaded"));
    const [path, , options] = upload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${CONFERENCE}/mobile-zh-[0-9a-f-]{36}\\.webp$`));
    expect(options).toMatchObject({ contentType: "image/webp" });
    expect(attach).toHaveBeenCalledWith({ conferenceId: CONFERENCE, slot: "mobileZh", path });
    expect(remove).not.toHaveBeenCalled();
  });

  it("記不成功時把剛上傳的檔案刪掉，並說明原因", async () => {
    attach.mockResolvedValue({ ok: false, error: "alt_required" });
    const user = userEvent.setup();
    renderUpload();

    await user.upload(screen.getByLabelText("上傳圖片"), file("image/png"));
    await user.click(screen.getByRole("button", { name: "上傳" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/content?error=alt_required"));
    expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);
  });

  it("上傳失敗時說明，不記路徑", async () => {
    upload.mockResolvedValue({ data: null, error: new Error("network") });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    renderUpload();

    await user.upload(screen.getByLabelText("上傳圖片"), file("image/png"));
    await user.click(screen.getByRole("button", { name: "上傳" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/staff/content?error=upload_failed"));
    expect(attach).not.toHaveBeenCalled();
  });
});
