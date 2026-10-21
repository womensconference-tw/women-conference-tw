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

const keyBlocked = () => !fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });

it("遮蔽期間攔下鍵盤，焦點在遮蔽層上；結束後放開，焦點回到原本按的按鈕（Codex 審查）", () => {
  const { rerender } = render(<Page first={false} />);
  screen.getByRole("button", { name: "送出" }).focus();

  rerender(<Page first />);
  expect(document.activeElement).toBe(screen.getByRole("status"));
  expect(keyBlocked()).toBe(true);
  // 重新整理這類瀏覽器快捷鍵照常；會移動焦點、改到欄位的組合鍵要攔（Codex 審查）
  expect(fireEvent.keyDown(document.body, { key: "r", metaKey: true })).toBe(true);
  expect(fireEvent.keyDown(document.body, { key: "Tab", altKey: true, shiftKey: true })).toBe(false);
  expect(fireEvent.keyDown(document.body, { key: "v", metaKey: true })).toBe(false);

  rerender(<Page first={false} />);
  expect(keyBlocked()).toBe(false);
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "送出" }));
});

it("等待中程式把焦點移到錯誤訊息，結束後焦點留在錯誤訊息上（Codex 審查）", () => {
  const { rerender } = render(<Page first />);
  document.getElementById("error")!.focus();
  expect(document.activeElement?.id).toBe("error");

  rerender(<Page first={false} />);
  expect(document.activeElement?.id).toBe("error");
});

it("兩個遮蔽層先後出現，先出現的先結束時，鍵盤仍然攔著，到最後一個結束才放開（Codex 審查）", () => {
  const { rerender } = render(<Page first />);
  rerender(<Page first second />);
  rerender(<Page first={false} second />);
  expect(keyBlocked()).toBe(true);

  rerender(<Page first={false} second={false} />);
  expect(keyBlocked()).toBe(false);
});

it("等待中底下的欄位不能貼上或輸入，結束後恢復（Codex 審查）", () => {
  const { rerender } = render(
    <>
      <input aria-label="電話" />
      <LoadingOverlay show label="查詢中，請稍候…" />
    </>,
  );
  const phone = screen.getByLabelText("電話");
  expect(fireEvent.paste(phone)).toBe(false);
  expect(fireEvent(phone, new InputEvent("beforeinput", { bubbles: true, cancelable: true }))).toBe(false);

  rerender(
    <>
      <input aria-label="電話" />
      <LoadingOverlay show={false} label="查詢中，請稍候…" />
    </>,
  );
  expect(fireEvent.paste(phone)).toBe(true);
});
