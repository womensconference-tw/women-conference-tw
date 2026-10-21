// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SubmitButton } from "./submit-button";

const navigation = new EventTarget();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("navigation", navigation);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function renderSearch() {
  render(
    <form onSubmit={(event) => event.preventDefault()}>
      <SubmitButton navigates>搜尋</SubmitButton>
    </form>,
  );
  act(() => {
    fireEvent.submit(screen.getByRole<HTMLButtonElement>("button", { name: "搜尋" }).form!);
  });
  expect(screen.getByRole("status").textContent).toBe("處理中…");
}

it("搜尋換頁被瀏覽器的「停止」中止時（navigateerror），遮蔽層解除（Codex 審查）", () => {
  renderSearch();
  act(() => {
    navigation.dispatchEvent(new Event("navigateerror"));
  });
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "搜尋" }).disabled).toBe(false);
});

it("瀏覽器沒有 navigateerror 時，等太久也自動解除，不會卡到要重新整理（Codex 審查）", () => {
  renderSearch();
  act(() => {
    vi.advanceTimersByTime(15_000);
  });
  expect(screen.queryByRole("status")).toBeNull();
});
