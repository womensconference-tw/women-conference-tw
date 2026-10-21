// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { afterLoading, LoadingOverlay } from "./loading-overlay";

afterEach(cleanup);

it("等待中蓋住整個畫面，放在 body 底下，顯示處理中的文字", () => {
  const { container } = render(<LoadingOverlay show label="送出中，請稍候…" />);
  const overlay = screen.getByRole("status");
  expect(overlay.textContent).toBe("送出中，請稍候…");
  expect(overlay.parentElement?.parentElement).toBe(document.body);
  expect(container.contains(overlay)).toBe(false);
});

it("不在等待中時什麼都不顯示", () => {
  render(<LoadingOverlay show={false} label="送出中，請稍候…" />);
  expect(screen.queryByRole("status")).toBeNull();
});

it("點到遮蔽層不會再觸發一次底下的按鈕", () => {
  const onClick = vi.fn();
  render(
    <button type="button" onClick={onClick}>
      送出
      <LoadingOverlay show label="送出中，請稍候…" />
    </button>,
  );
  fireEvent.click(screen.getByRole("status"));
  expect(onClick).not.toHaveBeenCalled();
});

function Page({ first, second = false }: { first: boolean; second?: boolean }) {
  return (
    <>
      <button type="button">送出</button>
      <p id="error" tabIndex={-1}>
        系統錯誤
      </p>
      <LoadingOverlay show={first} label="送出中，請稍候…" />
      <LoadingOverlay show={second} label="切換中，請稍候…" />
    </>
  );
}

it("遮蔽期間底下整個畫面設成 inert（輔具、輸入法也操作不到），焦點在遮蔽層上；結束後還原，焦點回到原本的按鈕（Codex 審查）", () => {
  const { container, rerender } = render(<Page first={false} />);
  screen.getByRole("button", { name: "送出" }).focus();

  rerender(<Page first />);
  expect(container.inert).toBe(true);
  expect(screen.getByRole("status").closest("[inert]")).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("status"));

  rerender(<Page first={false} />);
  expect(container.inert).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "送出" }));
});

it("等待中要聚焦錯誤訊息，等遮蔽層結束、解除 inert 後才聚焦（Codex 審查）", () => {
  const { container, rerender } = render(<Page first />);
  const focusError = vi.fn(() => {
    expect(container.inert).toBe(false);
    document.getElementById("error")!.focus();
  });
  afterLoading(focusError);
  expect(focusError).not.toHaveBeenCalled();

  rerender(<Page first={false} />);
  expect(focusError).toHaveBeenCalledOnce();
  expect(document.activeElement?.id).toBe("error");
});

it("沒有遮蔽層時 afterLoading 馬上執行", () => {
  const callback = vi.fn();
  afterLoading(callback);
  expect(callback).toHaveBeenCalledOnce();
});

it("兩個遮蔽層先後出現，先出現的先結束時，底下仍然是 inert，到最後一個結束才解除（Codex 審查）", () => {
  const { container, rerender } = render(<Page first />);
  rerender(<Page first second />);
  rerender(<Page first={false} second />);
  expect(container.inert).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("切換中，請稍候…");

  rerender(<Page first={false} second={false} />);
  expect(container.inert).toBe(false);
});
