// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoadingOverlay } from "./loading-overlay";

afterEach(cleanup);

it("等待中蓋住整個畫面，放在 body 底下，顯示處理中的文字", () => {
  const { container } = render(<LoadingOverlay show label="送出中，請稍候…" />);
  const overlay = screen.getByRole("status");
  expect(overlay.textContent).toBe("送出中，請稍候…");
  expect(overlay.parentElement).toBe(document.body);
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

it("遮蔽期間底下的按鈕不能聚焦，焦點在遮蔽層上；結束後還原，焦點回到原本按的按鈕（Codex 審查）", () => {
  function Page({ pending }: { pending: boolean }) {
    return (
      <>
        <button type="button">送出</button>
        <button type="button">English</button>
        <LoadingOverlay show={pending} label="送出中，請稍候…" />
      </>
    );
  }
  const { container, rerender } = render(<Page pending={false} />);
  screen.getByRole("button", { name: "送出" }).focus();

  rerender(<Page pending />);
  expect(container.inert).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole("status"));

  rerender(<Page pending={false} />);
  expect(container.inert).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "送出" }));
});
