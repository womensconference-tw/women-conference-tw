/*
 * 籌備委員會文字頁編輯框上方的樣式按鈕（#75）：不會 Markdown 的人按按鈕，
 * 就在游標位置插入（或包住選取的文字）對應的 Markdown。
 * 這裡只算出要換掉哪一段文字、換成什麼、換完選取哪裡，實際改編輯框的是 MarkdownEditor。
 */

export type MarkdownFormat = "heading" | "bold" | "orderedList" | "bulletList" | "indent" | "outdent" | "link" | "table";

/** 把 from 到 to 這段換成 insert；換完後選取 selectionStart 到 selectionEnd（以換完的全文計）。 */
export type MarkdownEdit = { from: number; to: number; insert: string; selectionStart: number; selectionEnd: number };

/** 一層清單縮排的空白數；四格對 1. 與 - 開頭的清單都夠，也夠兩位數的 10. 。 */
const INDENT = "    ";
const LIST_MARKER = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const ORDERED_MARKER = /^\s*\d+[.)]\s/;
const BULLET_MARKER = /^\s*[-*+]\s/;
const HEADING_MARKER = /^#{1,6}\s+/;

export function applyEdit(value: string, edit: MarkdownEdit) {
  return {
    value: value.slice(0, edit.from) + edit.insert + value.slice(edit.to),
    selectionStart: edit.selectionStart,
    selectionEnd: edit.selectionEnd,
  };
}

export function formatMarkdown(format: MarkdownFormat, value: string, start: number, end: number): MarkdownEdit {
  switch (format) {
    case "bold":
      return wrap(start, end, value.slice(start, end) || "粗體文字", "**", "**");
    case "link": {
      const text = value.slice(start, end);
      if (!text) return wrap(start, end, "連結文字", "[", "](https://)");
      const insert = `[${text}](https://)`;
      const urlStart = start + text.length + 3;
      return { from: start, to: end, insert, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
    }
    case "table":
      return insertTable(value, start, end);
    case "heading":
      return editLines(value, start, end, (lines) =>
        lines.every((line) => !line || HEADING_MARKER.test(line)) && lines.some((line) => line)
          ? lines.map((line) => line.replace(HEADING_MARKER, ""))
          : lines.map((line) => (line || lines.length === 1 ? `# ${line}` : line)),
      );
    case "orderedList":
      return editLines(value, start, end, (lines, above) =>
        allMatch(lines, ORDERED_MARKER) ? lines.map(stripListMarker) : numberLines(lines, above, true),
      );
    case "bulletList":
      return editLines(value, start, end, (lines) =>
        allMatch(lines, BULLET_MARKER)
          ? lines.map(stripListMarker)
          : lines.map((line) => (line || lines.length === 1 ? addMarker(line, "- ") : line)),
      );
    // 換層後重新編號：往內縮的成為下一層的 1. 2.（才會顯示 A. B.），往外移的接著上一層的編號。
    case "indent":
      return editLines(value, start, end, (lines, above) =>
        numberLines(
          lines.map((line) => (line || lines.length === 1 ? INDENT + line : line)),
          above,
          false,
        ),
      );
    case "outdent":
      return editLines(value, start, end, (lines, above) =>
        numberLines(
          lines.map((line) => line.replace(/^(?: {1,4}|\t)/, "")),
          above,
          false,
        ),
      );
  }
}

/** 用 before、after 包住 text；換完選取 text，直接打字就換掉。 */
function wrap(start: number, end: number, text: string, before: string, after: string): MarkdownEdit {
  const selectionStart = start + before.length;
  return { from: start, to: end, insert: before + text + after, selectionStart, selectionEnd: selectionStart + text.length };
}

/**
 * 對選取範圍涵蓋的每一行做 transform。選取的結尾剛好在下一行開頭時，不算那一行。
 * transform 也拿到上面同一段（到空行為止）的各行，編號時接著上面的清單。
 * 原本只是游標的話，游標放在改好的那幾行最後，接著打字；有選取的話，選起改好的那幾行。
 */
function editLines(
  value: string,
  start: number,
  end: number,
  transform: (lines: string[], above: string[]) => string[],
): MarkdownEdit {
  // start 是 0 時不能找 start - 1：lastIndexOf 會把負數當成 0，第一個字是換行時就找錯行。
  const from = start === 0 ? 0 : value.lastIndexOf("\n", start - 1) + 1;
  const lastChar = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const lineEnd = value.indexOf("\n", lastChar);
  const to = lineEnd === -1 ? value.length : lineEnd;
  const before = value.slice(0, from).split("\n").slice(0, -1);
  const blank = before.findLastIndex((line) => !line.trim());
  const insert = transform(value.slice(from, to).split("\n"), before.slice(blank + 1)).join("\n");
  const blockEnd = from + insert.length;
  return { from, to, insert, selectionStart: start === end ? blockEnd : from, selectionEnd: blockEnd };
}

function allMatch(lines: string[], marker: RegExp) {
  const filled = lines.filter((line) => line.trim());
  return filled.length > 0 && filled.every((line) => marker.test(line));
}

function stripListMarker(line: string) {
  return line.replace(LIST_MARKER, "$1");
}

function addMarker(line: string, marker: string) {
  const stripped = stripListMarker(line);
  const indent = stripped.match(/^\s*/)![0];
  return indent + marker + stripped.slice(indent.length);
}

/**
 * 依序編號；每一層（縮排）各自從 1 開始，回到外層時接著外層的編號，above 是接在上面的清單。
 * all 是 false 時只重新編號原本就是編號清單的行，其他行不加編號。
 */
function numberLines(lines: string[], above: string[], all: boolean) {
  const levels: { indent: number; count: number }[] = [];
  const next = (line: string, numbered: boolean) => {
    const indent = stripListMarker(line).match(/^\s*/)![0].length;
    while (levels.length && levels[levels.length - 1].indent > indent) levels.pop();
    const top = levels[levels.length - 1];
    if (!numbered) {
      if (top?.indent === indent) levels.pop();
      return line;
    }
    if (top?.indent === indent) top.count++;
    else levels.push({ indent, count: 1 });
    return addMarker(line, `${levels[levels.length - 1].count}. `);
  };
  for (const line of above) next(line, ORDERED_MARKER.test(line));
  return lines.map((line) => {
    if (!line && lines.length > 1) return line;
    return next(line, all || ORDERED_MARKER.test(line));
  });
}
const TABLE_HEADING = "欄位一";
const TABLE = `| ${TABLE_HEADING} | 欄位二 |\n| --- | --- |\n| 內容 | 內容 |\n`;

/** 插入兩欄的表格範本，前後空一行（Markdown 的表格要和前後文字隔開才排得出來），選起第一個標題。 */
function insertTable(value: string, start: number, end: number): MarkdownEdit {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const prefix = !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const suffix = !after || after.startsWith("\n") ? "" : "\n";
  const selectionStart = start + prefix.length + 2;
  return { from: start, to: end, insert: prefix + TABLE + suffix, selectionStart, selectionEnd: selectionStart + TABLE_HEADING.length };
}
