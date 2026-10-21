// @vitest-environment jsdom
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { sinkListItem } from "@milkdown/kit/prose/schema-list";
import { type Command, TextSelection } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, describe, expect, it } from "vitest";
import { deleteTableColumn, deleteTableRow, insertTable, setLink, toggleHeading, toggleList } from "./rich-text-commands";
import { createRichTextEditor, editorMarkdown, replaceMarkdown } from "./rich-text-setup";

/*
 * 所見即所得編輯器（#88）：存檔再打開格式不變、只留支援的格式、工具列的指令。
 */

// jsdom 沒有 ClipboardEvent，ProseMirror 模擬貼上時要用。
class FakeClipboardEvent extends Event {
  clipboardData: Pick<DataTransfer, "getData"> | null = null;
}
globalThis.ClipboardEvent ??= FakeClipboardEvent as unknown as typeof ClipboardEvent;

/** 模擬瀏覽器的貼上事件，data 是剪貼簿裡各種格式的內容。 */
function pasteEvent(data: Record<string, string>) {
  const event = new FakeClipboardEvent("paste");
  event.clipboardData = { getData: (type: string) => data[type] ?? "" };
  return event as unknown as ClipboardEvent;
}

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
    view.pasteText(text, pasteEvent({ "text/plain": text }));
    expect(markdown()).toBe("**粗** \\<img src=x onerror=alert(1)> 壞 > 引言\n");
  });
});

describe("貼上（續）", () => {
  it("合併的儲存格拆開，後面的文字留在原本的欄", async () => {
    const { view, markdown } = await open("");
    view.pasteHTML(
      "<table><tr><th>時間</th><th>內容</th></tr>" +
        '<tr><td rowspan="2">上午</td><td>開幕</td></tr><tr><td>課程</td></tr>' +
        '<tr><td colspan="2">午餐</td></tr></table>',
    );
    expect(markdown().trim().split("\n").map((line) => line.split("|").map((cell) => cell.trim()).slice(1, -1))).toEqual([
      ["時間", "內容"],
      [":-", ":-"],
      ["上午", "開幕"],
      ["", "課程"],
      ["午餐", ""],
    ]);
  });

  it("表格同時有合併格、換行與危險連結：一次整理好", async () => {
    const { view, root, markdown } = await open("");
    view.pasteHTML(
      "<table><tr><th>甲</th><th>乙</th></tr>" +
        '<tr><td rowspan="2">一<br>二</td><td><a href="javascript:alert(1)">壞</a></td></tr><tr><td>三</td></tr></table>',
    );
    expect(markdown()).not.toMatch(/javascript/);
    expect(markdown()).toContain("| 一 二 | 壞");
    expect(root.querySelector("td br:not(.ProseMirror-trailingBreak)")).toBeNull();
  });

  it("合併格蓋住整列（這一列沒有自己的儲存格）也能貼上", async () => {
    const { view, markdown } = await open("");
    view.pasteHTML(
      "<table><tr><th>甲</th><th>乙</th></tr>" +
        '<tr><td rowspan="2" colspan="2">合併</td></tr><tr></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    const rows = markdown().trim().split("\n").map((line) => line.split("|").map((cell) => cell.trim()).slice(1, -1));
    expect(rows[0]).toEqual(["甲", "乙"]);
    expect(rows[2]).toEqual(["合併", ""]);
    expect(rows.at(-1)).toEqual(["1", "2"]);
  });

  it("儲存格裡的換行變成空白，編輯器看到的和存出來的一樣", async () => {
    const { view, root, markdown } = await open("| 甲 |\n| - |\n| 1 |");
    placeCursor(view, "甲");
    view.dispatch(view.state.tr.insertText("乙", view.state.selection.from + 1));
    view.dispatch(view.state.tr.insert(view.state.selection.from + 1, view.state.schema.nodes.hardbreak.create()));
    expect(root.querySelector("th br:not(.ProseMirror-trailingBreak)")).toBeNull();
    expect(markdown().split("\n")[0]).toBe("| 甲 乙 |");
  });

  it("從 VS Code 複製的文字當成純文字貼上", async () => {
    const { view, markdown } = await open("");
    view.pasteText("const a = 1;", pasteEvent({ "text/plain": "const a = 1;", "vscode-editor-data": '{"mode":"javascript"}' }));
    expect(markdown()).toBe("const a = 1;\n");
  });
});

describe("整份換掉", () => {
  it("換成別人更新的內容後，按 Ctrl+Z 不會回到被換掉的內容", async () => {
    const { editor, view, markdown } = await open("舊的");
    view.dispatch(view.state.tr.insertText("我改的", 1));
    replaceMarkdown(editor, "別人改的");
    expect(markdown()).toBe("別人改的\n");
    expect(undo(view.state, view.dispatch)).toBe(false);
    expect(markdown()).toBe("別人改的\n");
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

  it("表格：插入、新增與刪除列和欄；只剩兩列時刪掉整個表格", async () => {
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
    // 游標在標題列：一次刪一列，下一列補上標題列；只剩兩列時刪掉整個表格。
    for (const rows of [4, 3]) {
      run(view, deleteTableRow);
      expect(markdown().trim().split("\n")).toHaveLength(rows);
    }
    run(view, deleteTableRow);
    expect(markdown()).toBe("");
  });

  it("在段落中間插入表格：段落從游標處分開，游標移到表格第一格", async () => {
    const { view, markdown } = await open("1. 下面是表格");
    placeCursor(view, "是表格");
    run(view, insertTable);
    view.dispatch(view.state.tr.insertText("時間"));
    expect(markdown()).toMatch(/^1\. 下面\n\n {3}\| 時間 \| +\|\n(.*\n){3}\n {3}是表格\n$/);
  });

  it("清單項目裡的表格後面還有文字：存檔再打開，文字不會變成表格的一列", async () => {
    const { view, markdown } = await open("1. 下面是表格\n2. 第二項");
    placeCursor(view, "是表格");
    run(view, insertTable);
    const reopened = await open(markdown());
    expect(reopened.root.querySelectorAll("tr")).toHaveLength(3);
    expect([...reopened.root.querySelectorAll("ol > li")].map((li) => li.querySelector(":scope > p:last-child")?.textContent)).toEqual([
      "是表格",
      "第二項",
    ]);
    expect(reopened.markdown()).toBe(markdown());
  });

  it("清單項目刪光表格前的文字：表格仍在清單裡", async () => {
    const { view, markdown } = await open("1. 甲\n\n   | 時間 |\n   | - |\n   | 9:00 |\n2. 乙");
    placeCursor(view, "甲");
    view.dispatch(view.state.tr.delete(view.state.selection.from, view.state.selection.from + 1));
    const reopened = await open(markdown());
    expect(reopened.root.querySelector("ol > li > table")).not.toBeNull();
    expect(reopened.root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(reopened.markdown()).toBe(markdown());
  });

  it("選取從項目選到它的下一層：層次不變，換成編號清單", async () => {
    const { view, markdown } = await open("- 甲\n  - 乙\n  - 丙\n- 丁");
    placeCursor(view, "甲");
    const from = view.state.selection.from;
    placeCursor(view, "乙");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toBe("1. 甲\n   1. 乙\n   2. 丙\n2. 丁\n");
  });

  it("游標在標題列、表格還有資料列：刪掉標題列，下一列變成標題列", async () => {
    const { view, markdown } = await open("| 甲 | 乙 |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |");
    placeCursor(view, "甲");
    run(view, deleteTableRow);
    expect(markdown()).toBe("| 1 | 2 |\n| - | - |\n| 3 | 4 |\n");
  });

  it("選取範圍從清單跨到一般段落：選到的全部變成編號清單", async () => {
    const { view, markdown } = await open("- 甲\n- 乙\n\n丙");
    placeCursor(view, "乙");
    const from = view.state.selection.from;
    placeCursor(view, "丙");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toBe("1. 甲\n2. 乙\n3. 丙\n");
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
