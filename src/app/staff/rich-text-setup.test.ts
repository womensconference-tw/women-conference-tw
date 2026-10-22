// @vitest-environment jsdom
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { undo } from "@milkdown/kit/prose/history";
import { sinkListItem } from "@milkdown/kit/prose/schema-list";
import { type Command, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { addColumnAfter, addRowAfter } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentAlignment,
  deleteTableColumn,
  deleteTableRow,
  insertImageBlock,
  insertTable,
  selectedImage,
  setAlignment,
  setImageSize,
  setLink,
  toggleHeading,
  toggleList,
} from "./rich-text-commands";
import { plainTextToMarkdown } from "@/lib/rich-text";
import { createRichTextEditor, editorMarkdown, normalizeMarkdown, replaceMarkdown } from "./rich-text-setup";

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

async function open(markdown: string, options: { images?: boolean } = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const editor = await createRichTextEditor(root, markdown, {}, () => {}, options);
  editors.push(editor);
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  return { editor, view, root, markdown: () => editorMarkdown(editor) };
}

/** 存檔後再打開，存出來的一樣。 */
async function roundTrip(markdown: string, options: { images?: boolean } = {}) {
  const first = await open(markdown, options);
  const saved = first.markdown();
  const second = await open(saved, options);
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
    const { saved, root } = await roundTrip(markdown, { images: true });
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

  it("清單項目開頭有好幾個空段落：表格與下一層清單仍在項目裡", async () => {
    const { view, markdown } = await open("");
    view.pasteHTML(
      "<ol><li><p></p><p></p><table><tr><th>時間</th></tr><tr><td>9:00</td></tr></table></li>" +
        "<li><p></p><p></p><ul><li><p>子項</p></li></ul></li></ol>",
    );
    const reopened = await open(markdown());
    expect(reopened.root.querySelector("ol > li > table")).not.toBeNull();
    expect(reopened.root.querySelector("ol > li > ul > li")?.textContent).toBe("子項");
    expect(reopened.root.querySelectorAll("ol > li")).toHaveLength(2);
    expect(reopened.markdown()).toBe(markdown());
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

  it("選取從下一層選到上一層的下一個項目：每一層都換成編號清單", async () => {
    const { view, markdown } = await open("- 甲\n  - 乙\n  - 丙\n- 丁");
    placeCursor(view, "乙");
    const from = view.state.selection.from;
    placeCursor(view, "丁");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toBe("1. 甲\n   1. 乙\n   2. 丙\n2. 丁\n");
  });

  it("選取範圍外、邊上項目裡的下一層清單不換", async () => {
    const { view, markdown } = await open("- 甲\n  - 乙\n- 丙\n  - 丁");
    placeCursor(view, "乙");
    const from = view.state.selection.from;
    placeCursor(view, "丙");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    run(view, toggleList(view.state.schema.nodes.ordered_list));
    expect(markdown()).toBe("1. 甲\n   1. 乙\n2. 丙\n   - 丁\n");
  });

  it("清單項目刪光第一段、後面還有一段：存出的內容讀回來一樣", async () => {
    const { editor, view, markdown } = await open("- 甲\n\n  乙");
    selectText(view, "甲");
    view.dispatch(view.state.tr.deleteSelection());
    expect(markdown()).toBe("- 乙\n");
    expect(normalizeMarkdown(editor, markdown())).toBe(markdown());
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

describe("圖片（#102）", () => {
  const BASE = "http://127.0.0.1:55321";
  const ours = `${BASE}/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001.png`;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE));
  afterEach(() => vi.unstubAllEnvs());

  it("大會特色的編輯器：後台上傳的圖片存檔再打開不變，和文字穿插", async () => {
    const markdown = `練唱說明\n\n![練唱場地](${ours})\n\n記得帶歌本\n`;
    const { saved, root } = await roundTrip(markdown, { images: true });
    expect(saved).toBe(markdown);
    expect(root.querySelector("img[src]")?.getAttribute("src")).toBe(ours);
    expect(root.querySelector("img[src]")?.getAttribute("alt")).toBe("練唱場地");
  });

  it("別的網站的圖片只留圖片說明；沒有圖片按鈕的編輯器（籌備委員會）連後台上傳的也只留說明", async () => {
    const images = await open(`![外面的圖](https://example.org/a.png)\n\n![練唱場地](${ours})`, { images: true });
    expect(images.markdown()).toBe(`外面的圖\n\n![練唱場地](${ours})\n`);
    const plain = await open(`![練唱場地](${ours})`);
    expect(plain.markdown()).toBe("練唱場地\n");
  });

  it("貼上別的網站的圖片拿掉，後台上傳的留著", async () => {
    const { view, markdown } = await open("", { images: true });
    view.pasteHTML(`<p>甲<img src="https://example.org/a.png" alt="外面">乙<img src="${ours}" alt="練唱場地"></p>`);
    // 圖片自己一段（Codex 審查）。
    expect(markdown()).toBe(`甲乙\n\n![練唱場地](${ours})\n`);
  });
});

describe("對齊（#102）", () => {
  it("置中、靠右的標題與段落存檔再打開不變；靠左不另外記", async () => {
    const markdown = ":::center\n# 歡迎\n:::\n\n:::right\n籌備委員會\n:::\n\n一般段落\n";
    const { saved, root } = await roundTrip(markdown);
    expect(saved).toBe(markdown);
    expect(root.querySelector("h1")?.getAttribute("data-align")).toBe("center");
    expect(root.querySelector("p")?.getAttribute("data-align")).toBe("right");
    expect(root.querySelectorAll("p")[1].getAttribute("data-align")).toBeNull();
  });

  it("按置中、靠右、靠左：選到的段落一起改；換成標題對齊不變", async () => {
    const { view, markdown } = await open("甲\n\n乙\n\n丙");
    selectText(view, "甲");
    const from = view.state.selection.from;
    placeCursor(view, "乙");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    expect(run(view, setAlignment("center"))).toBe(true);
    expect(markdown()).toBe(":::center\n甲\n:::\n\n:::center\n乙\n:::\n\n丙\n");
    expect(currentAlignment(view.state)).toBe("center");

    placeCursor(view, "乙");
    run(view, setAlignment("right"));
    run(view, toggleHeading);
    expect(markdown()).toBe(":::center\n甲\n:::\n\n:::right\n# 乙\n:::\n\n丙\n");
    run(view, setAlignment(""));
    expect(markdown()).toBe(":::center\n甲\n:::\n\n# 乙\n\n丙\n");
  });

  it("清單、表格裡不能對齊；選到的段落對齊不一樣時沒有按下的按鈕", async () => {
    const { view } = await open("- 項目\n\n| 甲 |\n| -- |\n| 乙 |\n\n:::center\n丙\n:::\n\n丁");
    placeCursor(view, "項目");
    expect(run(view, setAlignment("center"))).toBe(false);
    expect(currentAlignment(view.state)).toBeNull();
    placeCursor(view, "乙");
    expect(run(view, setAlignment("center"))).toBe(false);
    selectText(view, "丙");
    const from = view.state.selection.from;
    placeCursor(view, "丁");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    expect(currentAlignment(view.state)).toBeNull();
  });

  it("從 Word／Google 文件貼上置中、靠右的段落保留對齊；清單裡的拿掉", async () => {
    const { view, markdown } = await open("");
    // 貼上的第一段併進游標所在的段落（和 Word 一樣），用那一段的對齊。
    view.pasteHTML(
      '<p style="text-align:center">前言</p><p style="text-align:center">甲</p><p style="text-align: right">乙</p><ul><li><p style="text-align:center">丙</p></li></ul>',
    );
    expect(markdown()).toBe("前言\n\n:::center\n甲\n:::\n\n:::right\n乙\n:::\n\n- 丙\n");
  });

  it("不認得的 ::: 寫法照原文當成文字；文字與網址裡的冒號不加反斜線", async () => {
    const { markdown } = await open(":::note\n小心\n:::\n\n:::center[說明]\n甲\n:::\n\n時間 9:00，Note:bring，https://example.com/a");
    const saved = markdown();
    expect(saved).toContain("9:00，Note:bring");
    expect(saved).not.toMatch(/^:::/m);
    const again = await open(saved);
    expect(again.markdown()).toBe(saved);
    expect(again.view.state.doc.textContent).toContain(":::note");
  });
});

describe("圖片大小與位置（#102）", () => {
  const BASE = "http://127.0.0.1:55321";
  const ours = `${BASE}/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001.png`;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE));
  afterEach(() => vi.unstubAllEnvs());

  /** 選取第一張圖片。 */
  function selectImage(view: EditorView) {
    let found = -1;
    view.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === "image") found = pos;
    });
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, found)));
  }

  it("大小存在圖片的標題，存檔再打開不變；置中跟著那一段；不認得的標題拿掉", async () => {
    const markdown = `:::center\n![練唱場地](${ours} "small")\n:::\n`;
    const { saved, root } = await roundTrip(markdown, { images: true });
    expect(saved).toBe(markdown);
    expect(root.querySelector("img[src]")?.getAttribute("data-size")).toBe("small");
    expect(root.querySelector("img[src]")?.getAttribute("title")).toBeNull();
    const other = await open(`![練唱場地](${ours} "練唱")`, { images: true });
    expect(other.markdown()).toBe(`![練唱場地](${ours})\n`);
  });

  it("點一下圖片改大小；滿版拿掉標題", async () => {
    const { view, markdown } = await open(`![練唱場地](${ours})`, { images: true });
    expect(run(view, setImageSize("medium"))).toBe(false);
    selectImage(view);
    run(view, setImageSize("large"));
    expect(markdown()).toBe(`![練唱場地](${ours} "large")\n`);
    expect(selectedImage(view.state)?.attrs.title).toBe("large");
    run(view, setImageSize(""));
    expect(markdown()).toBe(`![練唱場地](${ours})\n`);
  });

  it("插入的圖片自己一段：段落中間從游標分開，開頭、結尾放在前後，空段落換成圖片；插好後選取圖片", async () => {
    const image = (view: EditorView) => view.state.schema.nodes.image.create({ src: ours, alt: "圖" });
    const middle = await open("甲乙", { images: true });
    placeCursor(middle.view, "乙");
    run(middle.view, insertImageBlock(image(middle.view)));
    expect(middle.markdown()).toBe(`甲\n\n![圖](${ours})\n\n乙\n`);
    expect(selectedImage(middle.view.state)).not.toBeNull();

    const start = await open("甲", { images: true });
    placeCursor(start.view, "甲");
    run(start.view, insertImageBlock(image(start.view)));
    expect(start.markdown()).toBe(`![圖](${ours})\n\n甲\n`);

    const empty = await open("", { images: true });
    run(empty.view, insertImageBlock(image(empty.view)));
    expect(empty.markdown()).toBe(`![圖](${ours})\n`);
  });
});

describe("Codex 審查（#102）", () => {
  const BASE = "http://127.0.0.1:55321";
  const ours = `${BASE}/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001.png`;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE));
  afterEach(() => vi.unstubAllEnvs());

  it("複製貼上圖片保留大小", async () => {
    const { view, markdown } = await open("", { images: true });
    view.pasteHTML(`<p><img src="${ours}" alt="練唱場地" data-size="small"></p>`);
    expect(markdown()).toBe(`![練唱場地](${ours} "small")\n`);
  });

  it("選了好幾段換成標題，每一段的對齊各自不變", async () => {
    const { view, markdown } = await open(":::right\n甲\n:::\n\n:::center\n乙\n:::");
    selectText(view, "甲");
    const from = view.state.selection.from;
    placeCursor(view, "乙");
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, view.state.selection.from + 1)));
    run(view, toggleHeading);
    expect(markdown()).toBe(":::right\n# 甲\n:::\n\n:::center\n# 乙\n:::\n");
  });

  it("舊的純文字裡行首的 ::: 照樣是文字，不會變成對齊或消失", async () => {
    for (const text of [":::center", ":::center\n\n甲\n\n:::", "前言\n:::right\n後記"]) {
      const { view, markdown } = await open(plainTextToMarkdown(text));
      expect(view.state.doc.textContent).toContain(":::");
      expect(markdown()).not.toMatch(/^:::/m);
    }
  });

  it("貼上和文字同一段的圖片分開成自己一段；表格裡的圖片只留說明，也不能插圖片", async () => {
    const { view, markdown } = await open("", { images: true });
    view.pasteHTML(`<p>前<img src="${ours}" alt="練唱場地">後</p>`);
    expect(markdown()).toBe(`前\n\n![練唱場地](${ours})\n\n後\n`);

    const table = await open("| 甲 |\n| -- |\n| 乙 |", { images: true });
    placeCursor(table.view, "乙");
    expect(run(table.view, insertImageBlock(table.view.state.schema.nodes.image.create({ src: ours, alt: "圖" })))).toBe(false);
    const loaded = await open(`| 甲 |\n| -- |\n| 乙![練唱場地](${ours}) |`, { images: true });
    expect(loaded.markdown()).toContain("| 乙練唱場地 |");
  });

  it("載入時文字裡的圖片就分開，清單裡的對齊就拿掉（和編輯後一樣）", async () => {
    const images = await open(`前![練唱場地](${ours})後`, { images: true });
    expect(images.markdown()).toBe(`前\n\n![練唱場地](${ours})\n\n後\n`);
    const list = await open("- :::center\n  甲\n  :::");
    expect(list.markdown()).toBe("- 甲\n");
    expect(list.root.querySelector("[data-align]")).toBeNull();
  });

  it("引言裡不認得的 ::: 照原文，不帶出外層的「>」", async () => {
    const { view } = await open("> :::note\n> 甲\n> :::");
    // 換行在 textContent 裡是「\n」。
    expect(view.state.doc.textContent).toBe(":::note\n甲\n:::");
  });
});

describe("Codex 第二次審查（#102）", () => {
  const BASE = "http://127.0.0.1:55321";
  const ours = `${BASE}/storage/v1/object/public/highlight-images/00000000-0000-4000-8000-000000000102/00000000-0000-4000-8000-000000000001.png`;
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", BASE));
  afterEach(() => vi.unstubAllEnvs());

  it("不認得的 ::: 照原文：每行前綴長短不同、tab 縮排也不切到內文", async () => {
    const cases: [string, string][] = [
      ["  :::note\n甲乙丙\n:::", ":::note\n甲乙丙\n:::"],
      ["> :::note\n>甲\n>:::", ":::note\n甲\n:::"],
      ["- :::note\n\t甲\n\t:::", ":::note\n甲\n:::"],
    ];
    for (const [markdown, text] of cases) {
      const { view } = await open(markdown);
      expect(view.state.doc.textContent).toBe(text);
    }
  });

  it("圖片前面打字，字接在同一段；貼上圖片後繼續打字，接在後面的文字前", async () => {
    const { view, markdown } = await open(`![圖](${ours})\n\n後段`, { images: true });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dispatch(view.state.tr.insertText("甲"));
    view.dispatch(view.state.tr.insertText("乙"));
    expect(markdown()).toBe(`甲乙\n\n![圖](${ours})\n\n後段\n`);

    const pasted = await open("前後", { images: true });
    placeCursor(pasted.view, "後");
    pasted.view.pasteHTML(`<img src="${ours}" alt="圖">`);
    pasted.view.dispatch(pasted.view.state.tr.insertText("x"));
    expect(pasted.markdown()).toBe(`前\n\n![圖](${ours})\n\nx後\n`);
  });

  it("連結、粗體、標題裡的圖片載入時就分開，第一次編輯後也一樣", async () => {
    const cases: [string, string][] = [
      [`前[![圖](${ours})](https://example.com/a)後`, `前\n\n![圖](${ours})\n\n後\n`],
      [`**前![圖](${ours})後**`, `**前**\n\n![圖](${ours})\n\n**後**\n`],
      [`[甲![圖](${ours})乙](https://example.com/a)`, `[甲](https://example.com/a)\n\n![圖](${ours})\n\n[乙](https://example.com/a)\n`],
      [`# 前![圖](${ours})`, `# 前\n\n![圖](${ours})\n`],
      [`# ![圖](${ours})`, `![圖](${ours})\n`],
      [`- 前![圖](${ours})`, `- 前\n\n  ![圖](${ours})\n`],
    ];
    for (const [input, expected] of cases) {
      const { view, markdown } = await open(input, { images: true });
      expect(markdown()).toBe(expected);
      // 同一次修改裡打一個字再刪掉：內容不變，但 normalize 會跑一次，結果要一樣。
      const at = TextSelection.atStart(view.state.doc).from;
      view.dispatch(view.state.tr.insertText("x", at).delete(at, at + 1));
      expect(markdown()).toBe(expected);
    }
  });
});
