// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyUrl } from "./copy-url";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubClipboard = (writeText: (text: string) => Promise<void>) =>
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

it("網址用瀏覽器網址列上的網域，按下複製網址就複製（不用請求標頭，Codex 審查）", async () => {
  const writeText = vi.fn(async () => {});
  stubClipboard(writeText);
  render(<CopyUrl path="/committee?year=2001" />);

  const expected = `${window.location.origin}/committee?year=2001&openExternalBrowser=1`;
  expect(screen.getByLabelText<HTMLInputElement>("公開網址").value).toBe(expected);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "複製網址" })));
  expect(writeText).toHaveBeenCalledWith(expected);
  expect(screen.getByRole("button", { name: "已複製" })).toBeTruthy();
});

it("網址加上 openExternalBrowser=1，從 LINE 打開時改用手機的瀏覽器", () => {
  render(<CopyUrl path="/" />);
  expect(screen.getByLabelText<HTMLInputElement>("公開網址").value).toBe(
    `${window.location.origin}/?openExternalBrowser=1`,
  );
});

it("網址有錨點時，參數加在錨點前面，錨點照樣有用（Codex 審查）", () => {
  render(<CopyUrl path="/#register" />);
  expect(screen.getByLabelText<HTMLInputElement>("公開網址").value).toBe(
    `${window.location.origin}/?openExternalBrowser=1#register`,
  );
});

it("網址已經有 openExternalBrowser 時改成 1，不重複加（Codex 審查）", () => {
  render(<CopyUrl path="/committee?openExternalBrowser=0&year=2001" />);
  expect(screen.getByLabelText<HTMLInputElement>("公開網址").value).toBe(
    `${window.location.origin}/committee?openExternalBrowser=1&year=2001`,
  );
});

it("瀏覽器不讓複製時，說明要自己選取複製", async () => {
  stubClipboard(async () => {
    throw new Error("denied");
  });
  render(<CopyUrl path="/committee" />);

  await act(async () => fireEvent.click(screen.getByRole("button", { name: "複製網址" })));
  expect(screen.getByRole("alert").textContent).toContain("自己複製");
  expect(screen.getByRole("button", { name: "複製網址" })).toBeTruthy();
});
