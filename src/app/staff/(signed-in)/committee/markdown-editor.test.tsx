// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MarkdownEditor } from "./markdown-editor";

/*
 * 籌備委員會文字頁的編輯框與上方的樣式按鈕（#75）。
 */

afterEach(cleanup);

const textarea = () => screen.getByLabelText<HTMLTextAreaElement>("籌備委員會備忘錄");

function renderEditor(defaultValue: string) {
  const submit = vi.fn((event: Event) => event.preventDefault());
  render(
    <form onSubmit={(event) => submit(event.nativeEvent)}>
      <MarkdownEditor name="memorandum" label="籌備委員會備忘錄" hint="組織章程。" defaultValue={defaultValue} />
    </form>,
  );
  return submit;
}

it("編輯框帶著原本的內容，送出時用 name 傳出去", () => {
  renderEditor("原本的內容");
  expect(textarea().value).toBe("原本的內容");
  expect(textarea().name).toBe("memorandum");
});

it("有標題、粗體、編號清單、項目清單、縮排、表格、連結等樣式按鈕", () => {
  renderEditor("");
  for (const name of ["標題", "粗體", "編號清單", "項目清單", "往內縮一層", "往外移一層", "表格", "連結"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
});

it("按粗體包住選取的文字，選取範圍留在原本的文字上，不會送出表單", () => {
  const submit = renderEditor("這是重點文字");
  textarea().setSelectionRange(2, 4);
  fireEvent.click(screen.getByRole("button", { name: "粗體" }));
  expect(textarea().value).toBe("這是**重點**文字");
  expect([textarea().selectionStart, textarea().selectionEnd]).toEqual([4, 6]);
  expect(document.activeElement).toBe(textarea());
  expect(submit).not.toHaveBeenCalled();
});

it("按編號清單、往內縮一層，做出多層編號清單", () => {
  renderEditor("甲\n乙");
  textarea().setSelectionRange(0, 3);
  fireEvent.click(screen.getByRole("button", { name: "編號清單" }));
  expect(textarea().value).toBe("1. 甲\n2. 乙");
  textarea().setSelectionRange(6, 6);
  fireEvent.click(screen.getByRole("button", { name: "往內縮一層" }));
  expect(textarea().value).toBe("1. 甲\n    1. 乙");
});

it("編輯框下面顯示欄位說明", () => {
  renderEditor("");
  expect(screen.getByText(/組織章程。/)).toBeTruthy();
});
