// @vitest-environment jsdom
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { sinkListItem } from "@milkdown/kit/prose/schema-list";
import { type Command, TextSelection } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { deleteTableColumn, deleteTableRow, insertTable, setLink, toggleHeading, toggleList } from "./rich-text-commands";
import { createRichTextEditor, editorMarkdown } from "./rich-text-setup";

/*
 * 所見即所得編輯器（#88）：存檔再打開格式不變、只留支援的格式、工具列的指令。
 */

// jsdom 沒有 ClipboardEvent，ProseMirror 模擬貼上時要用。
class FakeClipboardEvent extends Event {
  clipboardData: Pick<DataTransfer, "getData"> | null = null;
}
globalThis.ClipboardEvent ??= FakeClipboardEvent as unknown as typeof ClipboardEvent;

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

async function open(markdown: string) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = await createRichTextEditor(root, markdown);
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return { editor, view, root, markdown: () => editorMarkdown(editor) };
}

/** 存檔後再打開，存出來的一樣。 */
async function roundTrip(markdown: string) {
  const first = await open(markdown);
  const saved = first.markdown();
  const second = await open(saved);
  expect(second.markdown()).toBe(saved);
  return { saved, root: first.root };
}

/** 游標移到第一個有這段文字的地方。 */
function placeCursor(view: EditorView, text: string) {
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text);
  });
  if (found < 0) throw new Error(`找不到「${text}」`);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
}

function selectText(view: EditorView, text: string) {
  placeCursor(view, text);
  const from = view.state.selection.from;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + text.length)));
}

const run = (view: EditorView, command: Command) => command(view.state, view.dispatch);

describe("存檔再打開", () => {
  it("表格、多層清單、粗體、連結、換行格式不變", async () => {
    const markdown = [
      "# 大會簡介",
      "",
      "一段**粗體**文字\\",
      "第二行",
      "",
      "1. 第一條",
      "   1. 甲",
      "      1. 子",
      "         1. 一",
      "2. 第二條",
      "",
      "- 項目",
      "- 項目二",
      "",
      "| 時間   | 內容 |",
      "| ---- | -- |",
      "| 9:00 | 開幕 |",
      "",
      "[報名網站](https://example.com/a?b=1)",
      "",
    ].join("\n");
    const { saved, root } = await roundTrip(markdown);
    expect(saved).toBe(markdown);
    // 編輯器裡看到的是排好的樣子，沒有 Markdown 符號。
    const text = root.textContent ?? "";
    for (const symbol of ["**", "#", "|", "](", "1."]) expect(text).not.toContain(symbol);
    expect(root.querySelectorAll("ol ol ol ol")).toHaveLength(1);
    expect(root.querySelector("strong")?.textContent).toBe("粗體");
    expect(root.querySelector("th")?.textContent).toBe("時間");
    expect(root.querySelector("a")?.getAttribute("href")).toBe("https://example.com/a?b=1");
  });

  it("單一換行（舊的內容、remark-breaks）載入後照樣換行", async () => {
    const { saved, root } = await roundTrip("第一行\n第二行");
    expect(root.querySelectorAll("p br")).toHaveLength(1);
    expect(saved).toBe("第一行\\\n第二行\n");
  });

  it("空白內容存成空字串", async () => {
    const { saved } = await roundTrip("");
    expect(saved).toBe("");
  });

  it("不支援的寫法改成文字，HTML 與危險連結不會存進去", async () => {
    const { saved } = await roundTrip(
      [
        "> 引言",
        "",
        "```",
        "程式碼",
        "第二行",
        "```",
        "",
        "    縮排四格",
        "",
        "*斜體* ~~刪除~~ `程式` <b>粗</b>",
        "",
        "<script>alert(1)</script>",
        "",
        "![圖片說明](https://example.com/a.png)",
        "",
        "---",
        "",
        "[壞連結](javascript:alert(1)) [信箱](mailto:a@b.c) [參考][r]",
        "",
        "[r]: https://example.com/r",
        "",
        "- [ ] 待辦",
      ].join("\n"),
    );
    expect(saved).toBe(
      [
        "引言",
        "",
        "程式碼\\",
        "第二行",
        "",
        "縮排四格",
        "",
        "斜體 刪除 程式 \\<b>粗\\</b>",
        "",
        "\\<script>alert(1)\\</script>",
        "",
        "圖片說明",
        "",
        "壞連結 信箱 [參考](https://example.com/r)",
        "",
        "- \\[ ] 待辦",
        "",
      ].join("\n"),
    );
  });
});

describe("貼上", () => {
  it("從 Word／Google 文件貼上只留標題、粗體、清單、表格、連結", async () => {
    const { view, markdown } = await open("");
    view.pasteHTML(
      [
        '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">',
        '<h2 style="color:red">議程</h2>',
        '<p><span style="font-weight:700">重要</span><i>斜體</i><u>底線</u><span style="font-size:20pt">大字</span></p>',
        "<ol><li><p>一</p></li><li><p>二</p></li></ol>",
        "<ul><li>項目</li></ul>",
        "<table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>1</td><td>2</td></tr></tbody></table>",
        '<p><a href="https://example.com">好連結</a> <a href="javascript:alert(1)">壞連結</a></p>',
        '<blockquote>引言</blockquote><pre><code>程式</code></pre><img src="x.png" alt="圖"><hr>',
        "<script>alert(1)</script><style>p{}</style>",
        "</b>",
      ].join(""),
    );
    expect(markdown()).toBe(
      [
        "## 議程",
        "",
        "**重要**斜體底線大字",
        "",
        "1. 一",
        "2. 二",
        "",
        "- 項目",
        "",
        // Google 文件的表格沒有標題列，第一列當成標題列。
        "| 甲  | 乙  |",
        "| :- | :- |",
        "| 1  | 2  |",
        "",
        "[好連結](https://example.com) 壞連結",
        "",
        "引言",
        "",
        "程式",
        "",
      ].join("\n"),
    );
  });

  it("貼上 Markdown 文字時也只留支援的格式", async () => {
    const { view, markdown } = await open("");
    // 瀏覽器貼上純文字時，Milkdown 把它當成 Markdown 讀進來。
    const text = "**粗** <img src=x onerror=alert(1)> [壞](javascript:alert(1)) > 引言";
    const event = new FakeClipboardEvent("paste");
    event.clipboardData = { getData: (type: string) => (type === "text/plain" ? text : "") };
    view.pasteText(text, event as unknown as ClipboardEvent);
    expect(markdown()).toBe("**粗** \\<img src=x onerror=alert(1)> 壞 > 引言\n");
  });
});

describe("工具列", () => {
  it("標題：段落變標題，再按一次變回段落", async () => {
    const { view, markdown } = await open("大會簡介");
    run(view, toggleHeading);
    expect(markdown()).toBe("# 大會簡介\n");
    run(view, toggleHeading);
    expect(markdown()).toBe("大會簡介\n");
  });

  it("編號清單、往內縮一層做出多層編號；項目清單換成另一種清單，再按一次拿掉", async () => {
    const { view, markdown } = await open("一\n\n甲\n\n子");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toBe("1. 一\n2. 甲\n3. 子\n");
    placeCursor(view, "甲");
    run(view, sinkListItem(view.state.schema.nodes.list_item));
    placeCursor(view, "子");
    run(view, sinkListItem(view.state.schema.nodes.list_item));
    run(view, sinkListItem(view.state.schema.nodes.list_item));
    expect(markdown()).toBe("1. 一\n   1. 甲\n      1. 子\n");
    run(view, toggleList(view.state.schema.nodes.bullet_list));
    expect(markdown()).toBe("1. 一\n   1. 甲\n      - 子\n");
    placeCursor(view, "一");
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toMatch(/^一\n/);
  });

  it("表格：插入、新增與刪除列和欄；只剩標題列時刪掉整個表格", async () => {
    const { view, markdown } = await open("");
    run(view, insertTable);
    expect(markdown()).toBe("|    |    |\n| :- | :- |\n|    |    |\n|    |    |\n");
    view.dispatch(view.state.tr.insertText("甲"));
    run(view, addColumnAfter);
    run(view, addRowAfter);
    expect(markdown().split("\n")[0]).toMatch(/^\| 甲 +\| +\| +\|$/);
    expect(markdown().trim().split("\n")).toHaveLength(5);
    // 游標還在「甲」那一格：刪掉的是「甲」那一欄。
    run(view, deleteTableColumn);
    expect(markdown().split("\n")[0]).toMatch(/^\| +\| +\|$/);
    // 游標在標題列：刪掉整個表格。
    run(view, deleteTableRow);
    expect(markdown()).toBe("");
  });

  it("在段落中間插入表格：段落從游標處分開，游標移到表格第一格", async () => {
    const { view, markdown } = await open("1. 下面是表格");
    placeCursor(view, "是表格");
    run(view, insertTable);
    view.dispatch(view.state.tr.insertText("時間"));
    expect(markdown()).toMatch(/^1\. 下面\n {3}\| 時間 \| +\|\n(.*\n){3} {3}是表格\n$/);
  });

  it("刪掉資料列", async () => {
    const { view, markdown } = await open("| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");
    placeCursor(view, "1");
    run(view, deleteTableRow);
    expect(markdown()).toBe("| 甲 | 乙 |\n| - | - |\n| 3 | 4 |\n");
  });

  it("連結：選取文字加上連結、改網址、拿掉；沒選文字時插入網址", async () => {
    const { view, markdown } = await open("報名網站");
    selectText(view, "報名");
    setLink(view, "https://a.example");
    expect(markdown()).toBe("[報名](https://a.example)網站\n");
    placeCursor(view, "名");
    setLink(view, "https://b.example");
    expect(markdown()).toBe("[報名](https://b.example)網站\n");
    placeCursor(view, "名");
    setLink(view, "");
    expect(markdown()).toBe("報名網站\n");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    setLink(view, "https://c.example");
    expect(markdown()).toBe("報名網站<https://c.example>\n");
  });
});
