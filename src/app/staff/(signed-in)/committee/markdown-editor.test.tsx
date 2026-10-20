// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

// 存草稿、捨棄草稿、別人發布或存了草稿之後，同一頁重新畫出來，編輯框拿到新的內容（#76，Codex 審查）。
describe("內容換了", () => {
  const editor = (defaultValue: string, resetToken?: string) => (
    <MarkdownEditor
      name="memorandum"
      label="籌備委員會備忘錄"
      hint="組織章程。"
      defaultValue={defaultValue}
      resetToken={resetToken}
    />
  );
  const updatedNotice = () => screen.queryByText(/剛被更新/);

  it("沒動過的編輯框換成新的內容", () => {
    const { rerender } = render(editor("草稿"));
    rerender(editor("已發布"));
    expect(textarea().value).toBe("已發布");
    expect(updatedNotice()).toBeNull();
  });

  it("正在編輯、還沒存：留著打到一半的內容，提醒她別人更新過", () => {
    const { rerender } = render(editor("原本的"));
    fireEvent.change(textarea(), { target: { value: "打到一半" } });
    rerender(editor("別人的版本"));
    expect(textarea().value).toBe("打到一半");
    expect(updatedNotice()).toBeTruthy();

    // 她存了自己的版本，新的內容就是編輯框裡的：提醒拿掉。
    rerender(editor("打到一半"));
    expect(textarea().value).toBe("打到一半");
    expect(updatedNotice()).toBeNull();
  });

  it("提醒出現後，她把內容改成和更新的一樣：提醒拿掉", () => {
    const { rerender } = render(editor("原本的"));
    fireEvent.input(textarea(), { target: { value: "打到一半" } });
    rerender(editor("別人的版本"));
    expect(updatedNotice()).toBeTruthy();
    fireEvent.input(textarea(), { target: { value: "別人的版本" } });
    expect(updatedNotice()).toBeNull();
  });

  it("她自己捨棄草稿（帶新的重設代號）：就算正在編輯，也換回已發布的內容，不顯示提醒", () => {
    const { rerender } = render(editor("草稿"));
    fireEvent.input(textarea(), { target: { value: "草稿又改了" } });
    rerender(editor("已發布", "reset-1"));
    expect(textarea().value).toBe("已發布");
    expect(updatedNotice()).toBeNull();

    // 再捨棄一次（例如另一位總管理員又存了草稿），代號不同，照樣換回。
    fireEvent.input(textarea(), { target: { value: "又打了" } });
    rerender(editor("已發布", "reset-2"));
    expect(textarea().value).toBe("已發布");

    // 之後做別的事，網址不再帶代號：不算捨棄，留著她打的字。
    fireEvent.input(textarea(), { target: { value: "繼續打" } });
    rerender(editor("已發布"));
    expect(textarea().value).toBe("繼續打");
  });

  it("提醒出現後，她存了和更新一樣的內容、表單被重設：提醒拿掉", async () => {
    const { rerender } = render(<form>{editor("原本的")}</form>);
    fireEvent.input(textarea(), { target: { value: "打到一半" } });
    rerender(<form>{editor("別人的版本")}</form>);
    expect(updatedNotice()).toBeTruthy();
    textarea().closest("form")!.reset();
    await waitFor(() => expect(updatedNotice()).toBeNull());
    expect(textarea().value).toBe("別人的版本");
  });

  it("按上一頁回到舊的捨棄網址：同一個重設代號只換回一次，不會清掉她打的字（Codex 審查）", () => {
    const { rerender } = render(editor("已發布", "reset-1"));
    rerender(editor("已發布"));
    fireEvent.input(textarea(), { target: { value: "繼續打" } });
    rerender(editor("已發布", "reset-1"));
    expect(textarea().value).toBe("繼續打");
  });

  it("提醒出現後，用樣式按鈕把內容改成和更新的一樣（瀏覽器不支援插入文字）：提醒拿掉", () => {
    const execCommand = document.execCommand;
    document.execCommand = () => false;
    try {
      const { rerender } = render(editor("原本的"));
      fireEvent.input(textarea(), { target: { value: "# 最新內容" } });
      rerender(editor("最新內容"));
      expect(updatedNotice()).toBeTruthy();
      textarea().setSelectionRange(2, 2);
      fireEvent.click(screen.getByRole("button", { name: "標題" }));
      expect(textarea().value).toBe("最新內容");
      expect(updatedNotice()).toBeNull();
    } finally {
      document.execCommand = execCommand;
    }
  });
});
