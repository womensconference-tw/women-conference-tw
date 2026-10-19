import { describe, expect, it } from "vitest";
import { applyEdit, formatMarkdown, type MarkdownFormat } from "./markdown-format";

/*
 * 籌備委員會文字頁編輯框上方的樣式按鈕（#75）：按了在游標位置插入、或包住選取的文字。
 * 用「^」標出選取範圍的開頭與結尾（只有一個「^」就是游標）。
 */

function run(format: MarkdownFormat, marked: string) {
  const start = marked.indexOf("^");
  const rest = marked.slice(0, start) + marked.slice(start + 1);
  const second = rest.indexOf("^", start);
  const end = second === -1 ? start : second;
  const value = second === -1 ? rest : rest.slice(0, second) + rest.slice(second + 1);
  const result = applyEdit(value, formatMarkdown(format, value, start, end));
  const { value: text, selectionStart: s, selectionEnd: e } = result;
  return s === e ? `${text.slice(0, s)}^${text.slice(s)}` : `${text.slice(0, s)}^${text.slice(s, e)}^${text.slice(e)}`;
}

describe("粗體", () => {
  it("包住選取的文字", () => expect(run("bold", "這是^重點^文字")).toBe("這是**^重點^**文字"));
  it("沒有選取時插入範例並選起來，直接打字就換掉", () => expect(run("bold", "這是^")).toBe("這是**^粗體文字^**"));
  it("選取到行尾的換行時，換行留在星號外面（Codex 審查）", () => expect(run("bold", "^甲\n^乙")).toBe("**^甲^**\n乙"));
  it("選取多段時，每段各自加粗，空行不動（Codex 審查）", () =>
    expect(run("bold", "^甲\n\n乙^")).toBe("^**甲**\n\n**乙**^"));
  it("表格列在每一格裡加粗，分隔線不動（Codex 審查）", () =>
    expect(run("bold", "^| 組別 | 姓名 |\n| --- | --- |\n| 課務組 | 測試甲 |^")).toBe(
      "^| **組別** | **姓名** |\n| --- | --- |\n| **課務組** | **測試甲** |^",
    ));
  it("引言的 > 留在星號外面（Codex 審查）", () => expect(run("bold", "^> 注意^")).toBe("> **^注意^**"));
  it("程式碼區塊整段不加粗（Codex 審查）", () =>
    expect(run("bold", "^前言\n```\n程式\n```\n後記^")).toBe("^**前言**\n```\n程式\n```\n**後記**^"));
  it("選取從程式碼區塊裡面開始時，裡面的行也不加粗", () =>
    expect(run("bold", "```\n^程式\n```\n後記^")).toBe("```\n程式\n```\n**^後記^**"));
  it("前後的空白留在星號外面，清單符號也不包進去", () =>
    expect(run("bold", "^- 甲 \n    1. 乙^")).toBe("^- **甲** \n    1. **乙**^"));
});

describe("標題", () => {
  it("在游標所在那一行開頭加上 #", () => expect(run("heading", "前言\n宗^旨\n內容")).toBe("前言\n# 宗旨^\n內容"));
  it("已經是標題就取消", () => expect(run("heading", "# 宗^旨")).toBe("宗旨^"));
});

describe("編號清單", () => {
  it("選取的每一行依序編號", () => expect(run("orderedList", "^甲\n乙\n丙^")).toBe("^1. 甲\n2. 乙\n3. 丙^"));
  it("空白行插入 1. ，游標放在後面", () => expect(run("orderedList", "前言\n^")).toBe("前言\n1. ^"));
  it("項目清單換成編號清單，保留縮排，每一層各自從 1 開始", () =>
    expect(run("orderedList", "^- 甲\n    - 乙\n    - 丙\n- 丁^")).toBe("^1. 甲\n    1. 乙\n    2. 丙\n2. 丁^"));
  it("已經是編號清單就取消", () => expect(run("orderedList", "^1. 甲\n2. 乙^")).toBe("^甲\n乙^"));
  it("選取到下一行開頭時，不動下一行", () => expect(run("orderedList", "^甲\n^乙")).toBe("^1. 甲^\n乙"));
});

describe("項目清單", () => {
  it("選取的每一行加上 - ", () => expect(run("bulletList", "^甲\n乙^")).toBe("^- 甲\n- 乙^"));
  it("編號清單換成項目清單", () => expect(run("bulletList", "1. 甲^")).toBe("- 甲^"));
});

describe("縮排（多層清單）", () => {
  it("往內縮四格，變成下一層", () => expect(run("indent", "1. 甲\n^1. 乙\n2. 丙^")).toBe("1. 甲\n^    1. 乙\n    2. 丙^"));
  it("先編號再往內縮，下一層從 1 開始（才會顯示 A. B.，不是 B. C.）", () =>
    expect(run("indent", "1. 甲\n^2. 乙\n3. 丙^\n4. 丁")).toBe("1. 甲\n^    1. 乙\n    2. 丙^\n4. 丁"));
  it("往外移四格，回到上一層，接著上一層的編號", () => expect(run("outdent", "1. 甲\n    1. 乙^")).toBe("1. 甲\n2. 乙^"));
  it("縮排到已有的下一層後面，接著那一層的編號", () =>
    expect(run("indent", "1. 甲\n    1. 乙\n2. 丙^")).toBe("1. 甲\n    1. 乙\n    2. 丙^"));
  it("不足四格就移掉全部空白", () => expect(run("outdent", "  - 乙^")).toBe("- 乙^"));
  it("空格加 Tab 的縮排也算一層，整層移掉（Codex 審查）", () =>
    expect(run("outdent", "1. 甲\n \t1. 乙^")).toBe("1. 甲\n2. 乙^"));
});

describe("游標在最前面", () => {
  it("第一行是空行時，只改第一行", () => expect(run("heading", "^\n甲")).toBe("# ^\n甲"));
});

describe("連結", () => {
  it("選取的文字當連結文字，選起網址讓人貼上", () =>
    expect(run("link", "請看^舊網站^。")).toBe("請看[舊網站](^https://^)。"));
  it("沒有選取時插入範例，選起連結文字", () => expect(run("link", "^")).toBe("[^連結文字^](https://)"));
});

describe("表格", () => {
  it("在空白的地方插入兩欄的表格範本，選起第一個標題", () =>
    expect(run("table", "^")).toBe("| ^欄位一^ | 欄位二 |\n| --- | --- |\n| 內容 | 內容 |\n"));
  it("前後有文字時空一行，表格才排得出來", () =>
    expect(run("table", "前言^\n後記")).toBe("前言\n\n| ^欄位一^ | 欄位二 |\n| --- | --- |\n| 內容 | 內容 |\n\n後記"));
});
