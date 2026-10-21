// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";
import { RichTextEditor } from "./rich-text-editor";

/*
 * 籌備委員會文字頁的所見即所得編輯器（#88）：工具列、送出的內容、舊的純文字內容、別人更新時的提醒。
 */

afterEach(cleanup);

type Props = Partial<Parameters<typeof RichTextEditor>[0]>;

function editorProps(props: Props) {
  return { name: "memorandum", label: "籌備委員會備忘錄", hint: "組織章程。", defaultValue: "", saveLabel: "儲存草稿", ...props };
}

async function renderEditor(props: Props = {}) {
  const result = render(
    <form>
      <RichTextEditor {...editorProps(props)} />
    </form>,
  );
  const editor = await waitFor(() => screen.getByRole("textbox", { name: "籌備委員會備忘錄" }));
  // 等工具列可以按（編輯器建好了）。
  await waitFor(() => expect((screen.getByRole("button", { name: "標題" }) as HTMLButtonElement).disabled).toBe(false));
  const submitted = () => new FormData(result.container.querySelector("form")!).get("memorandum");
  const rerender = (next: Props) =>
    result.rerender(
      <form>
        <RichTextEditor {...editorProps(next)} />
      </form>,
    );
  return { editor, submitted, rerender };
}

describe("RichTextEditor", () => {
  it("看到的是排好的樣子，送出 Markdown", async () => {
    const markdown = "# 標題\n\n**粗體**\n\n1. 一\n   1. 甲\n";
    const { editor, submitted } = await renderEditor({ defaultValue: markdown });
    expect(editor.querySelector("h1")?.textContent).toBe("標題");
    expect(editor.querySelector("ol ol")?.textContent).toBe("甲");
    expect(editor.textContent).not.toMatch(/[#*]/);
    expect(editor.getAttribute("aria-describedby")).toBeTruthy();
    expect(submitted()).toBe(markdown);
  });

  it("工具列有每種樣式的按鈕；不在表格裡時沒有增刪列欄的按鈕", async () => {
    await renderEditor();
    const toolbar = screen.getByRole("toolbar", { name: "籌備委員會備忘錄的樣式" });
    const labels = [...toolbar.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["標題", "粗體", "編號清單", "項目清單", "往內縮一層", "往外移一層", "表格", "連結"]);
    // 不在清單裡不能縮排。
    expect((screen.getByRole("button", { name: "往內縮一層" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("按標題，送出的內容跟著改；按表格出現增刪列欄的按鈕", async () => {
    const { submitted } = await renderEditor({ defaultValue: "大會簡介" });
    fireEvent.click(screen.getByRole("button", { name: "標題" }));
    expect(submitted()).toBe("# 大會簡介\n");
    expect(screen.getByRole("button", { name: "標題" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "表格" }));
    for (const name of ["新增一列", "新增一欄", "刪除這一列", "刪除這一欄"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("捨棄草稿時就算內容剛好和已發布的一樣，按復原也回不到草稿", async () => {
    const { editor, rerender } = await renderEditor({ defaultValue: "# 甲" });
    fireEvent.click(screen.getByRole("button", { name: "標題" }));
    rerender({ defaultValue: "甲", resetToken: "1" });
    await waitFor(() => expect(editor.querySelector("h1")).toBeNull());
    fireEvent.keyDown(editor, { key: "z", ctrlKey: true });
    expect(editor.querySelector("h1")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("存檔後 React 重設表單，送出的仍是編輯器的內容", async () => {
    const { editor, submitted } = await renderEditor({ defaultValue: "大會簡介" });
    fireEvent.click(screen.getByRole("button", { name: "標題" }));
    editor.closest("form")!.reset();
    await waitFor(() => expect(submitted()).toBe("# 大會簡介\n"));
  });

  it("連結只接受 http(s) 網址", async () => {
    const { submitted } = await renderEditor({ defaultValue: "報名" });
    fireEvent.click(screen.getByRole("button", { name: "連結" }));
    const url = screen.getByLabelText(/連結網址/);
    fireEvent.change(url, { target: { value: "javascript:alert(1)" } });
    fireEvent.click(screen.getByRole("button", { name: "確定" }));
    expect(screen.getByRole("alert").textContent).toContain("網址要以 https:// 或 http:// 開頭");
    fireEvent.change(url, { target: { value: "https://example.com" } });
    // 按 Enter 套用，不送出整張表單。
    fireEvent.keyDown(url, { key: "Enter" });
    expect(screen.queryByLabelText(/連結網址/)).toBeNull();
    expect(submitted()).toBe("<https://example.com>報名\n");
  });

  it("改版前的純文字：換行保留，* 與 # 照原樣顯示", async () => {
    const text = "第一行\n第二行\n\n# 不是標題\n* 不是清單";
    const { editor, submitted } = await renderEditor({ defaultValue: text, plainText: true });
    expect(editor.querySelectorAll("p")).toHaveLength(2);
    expect(editor.querySelectorAll("br")).toHaveLength(2);
    expect(editor.querySelector("h1, ul")).toBeNull();
    // 存檔後在公開頁面顯示的也一樣。
    const page = render(<Markdown>{String(submitted())}</Markdown>);
    expect(page.container.querySelector("h3, ul")).toBeNull();
    expect(page.container.querySelectorAll("p")).toHaveLength(2);
    expect(page.container.querySelectorAll("br")).toHaveLength(2);
    expect(page.container.textContent?.replace(/\n/g, "")).toBe("第一行第二行# 不是標題* 不是清單");
  });

  it("沒動過的編輯器換成新的內容；動過的留著，提醒這一頁剛被更新", async () => {
    const { editor, submitted, rerender } = await renderEditor({ defaultValue: "舊的" });
    rerender({ defaultValue: "別人改的" });
    await waitFor(() => expect(editor.textContent).toBe("別人改的"));
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "標題" }));
    rerender({ defaultValue: "又改了" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("按「儲存草稿」會蓋掉更新的內容"));
    expect(submitted()).toBe("# 別人改的\n");

    // 捨棄草稿：就算正在編輯也換回去。
    rerender({ defaultValue: "已發布", resetToken: "1" });
    await waitFor(() => expect(editor.textContent).toBe("已發布"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitted()).toBe("已發布\n");
  });
});
