/*
 * 籌備委員會文字頁編輯框上方的樣式按鈕（#75）：不會 Markdown 的人按按鈕，
 * 就在游標位置插入（或包住選取的文字）對應的 Markdown。
 * 這裡只算出要換掉哪一段文字、換成什麼、換完選取哪裡，實際改編輯框的是 MarkdownEditor。
 */

import type { Nodes, Strong } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

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
      return bold(value, start, end);
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
          lines.map(outdentLine),
          above,
          false,
        ),
      );
  }
}

/**
 * 粗體。用顯示頁面時同一套 Markdown 規則（GitHub 風格）讀懂內容，只在段落、標題、表格每一格的文字上加 **：
 * 換行、前後空白、引言、清單、標題、表格的 | 都留在 ** 外面，程式碼區塊整段略過（Codex 審查）。
 * 選取範圍切在連結、程式碼等中間時，整個一起加粗；裡面本來就有的粗體拿掉星號，免得變成「****」。
 * 段落跨多行時逐行加粗，續行開頭的 > 與縮排留在外面。
 * 頭尾是標點、旁邊緊接著字時，Markdown 不把 ** 當成粗體，標點移到 ** 外面（例如「（**乙**）」）。
 * 只加粗了一段時選起那段文字，直接打字就換掉；加粗了好幾段時選起整段。
 */
function bold(value: string, start: number, end: number): MarkdownEdit {
  const text = value.slice(start, end);
  const unchanged = { from: start, to: end, insert: text, selectionStart: start, selectionEnd: end };
  const tree = fromMarkdown(value, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  if (!text.trim()) return insideCode(tree, start) ? unchanged : wrap(start, end, "粗體文字", "**", "**");

  const segments: { from: number; to: number; strong: Strong[]; text: [number, number][] }[] = [];
  const visit = (node: Nodes, rangeStart = start, rangeEnd = end) => {
    if (node.type === "paragraph" || node.type === "heading" || node.type === "tableCell" || node.type === "link") {
      const children = node.children;
      if (!children.length) return;
      let from = Math.max(rangeStart, offset(children[0], "start"));
      let to = Math.min(rangeEnd, offset(children[children.length - 1], "end"));
      for (const child of children) {
        if (child.type === "text") continue;
        if (offset(child, "start") < from && from < offset(child, "end")) from = offset(child, "start");
        if (offset(child, "start") < to && to < offset(child, "end")) to = offset(child, "end");
      }
      // 選取的剛好是整個連結時，粗體放進連結文字裡：「看**[連結](網址)**。」顯示不出粗體，「看[**連結**](網址)。」可以。
      const covered = children.filter((child) => offset(child, "start") < to && offset(child, "end") > from);
      const [only] = covered;
      if (covered.length === 1 && only.type === "link" && offset(only, "start") === from && offset(only, "end") === to) {
        return visit(only, from, to);
      }
      const strong = children.filter(
        (child): child is Strong => child.type === "strong" && offset(child, "start") >= from && offset(child, "end") <= to,
      );
      if (from < to) segments.push({ from, to, strong, text: textRanges(children) });
      return;
    }
    if ("children" in node) node.children.forEach((child) => visit(child));
  };
  visit(tree);
  if (!segments.length) return unchanged;

  const from = Math.min(start, segments[0].from);
  const to = Math.max(end, segments[segments.length - 1].to);
  let insert = "";
  let cursor = from;
  const bolded: { start: number; length: number }[] = [];
  for (const segment of segments) {
    insert += value.slice(cursor, segment.from);
    // 拿掉裡面本來就有的粗體符號（** 或 __）。
    // rawOffsets 記下每個字在原文的位置，判斷是不是一般文字。
    let raw = "";
    const rawOffsets: number[] = [];
    const keep = (from: number, to: number) => {
      raw += value.slice(from, to);
      for (let index = from; index < to; index++) rawOffsets.push(index);
    };
    let at = segment.from;
    for (const node of segment.strong) {
      const [nodeStart, nodeEnd] = [offset(node, "start"), offset(node, "end")];
      keep(at, nodeStart);
      keep(nodeStart + 2, nodeEnd - 2);
      at = nodeEnd;
    }
    keep(at, segment.to);
    // 只有一般文字裡的空白與標點可以移到 ** 外面；連結、程式碼的符號移出去就壞了。
    const movable = (rawIndex: number, char: string) =>
      isBlankOrPunctuation(char) && segment.text.some(([textStart, textEnd]) => textStart <= rawOffsets[rawIndex] && rawOffsets[rawIndex] < textEnd);
    let lineStart = 0;
    const lines = raw.split("\n");
    lines.forEach((line, index) => {
      if (index > 0) {
        insert += "\n";
        lineStart += lines[index - 1].length + 1;
      }
      const atLineStart = index > 0 || segment.from === 0 || value[segment.from - 1] === "\n";
      const prefix = atLineStart ? line.match(/^[ \t]*(?:>[ \t]*)*/)![0] : "";
      // 前後的字（取兩個 UTF-16 單位，emoji 這種佔兩個的字才完整）。
      const textBefore = () => (value.slice(0, from) + insert).slice(-2);
      const textAfter = (rest: string) => rest || (index === lines.length - 1 ? value.slice(segment.to, segment.to + 2) : "\n");
      insert += prefix;
      let content = line.slice(prefix.length);
      let contentStart = lineStart + prefix.length;
      // 頭尾的空白與擋住粗體的標點移到 ** 外面。
      let head = "";
      while (content && !opensBold(textBefore() + head, content)) {
        const char = firstChar(content);
        if (!movable(contentStart, char)) break;
        head += char;
        content = content.slice(char.length);
        contentStart += char.length;
      }
      let tail = "";
      while (content && !closesBold(content, textAfter(tail))) {
        const char = lastChar(content);
        if (!movable(contentStart + content.length - char.length, char)) break;
        tail = char + tail;
        content = content.slice(0, -char.length);
      }
      if (!content || !opensBold(textBefore() + head, content) || !closesBold(content, textAfter(tail))) {
        insert += head + content + tail;
        return;
      }
      insert += head;
      bolded.push({ start: from + insert.length + 2, length: content.length });
      insert += `**${content}**${tail}`;
    });
    cursor = segment.to;
  }
  insert += value.slice(cursor, to);

  if (bolded.length === 1) {
    const [only] = bolded;
    return { from, to, insert, selectionStart: only.start, selectionEnd: only.start + only.length };
  }
  return { from, to, insert, selectionStart: from, selectionEnd: from + insert.length };
}

/** 段落裡一般文字（含粗體、斜體、刪除線裡的文字）在原文的位置範圍。 */
function textRanges(children: Nodes[]): [number, number][] {
  return children.flatMap((child): [number, number][] => {
    if (child.type === "text") return [[offset(child, "start"), offset(child, "end")]];
    if (child.type === "strong" || child.type === "emphasis" || child.type === "delete") return textRanges(child.children);
    return [];
  });
}

/** 位置在程式碼區塊或 HTML 區塊裡面（這些地方顯示不出粗體）。 */
function insideCode(node: Nodes, at: number): boolean {
  if (node.type === "code" || node.type === "html" || node.type === "inlineCode") {
    return offset(node, "start") < at && at < offset(node, "end");
  }
  return "children" in node && node.children.some((child) => insideCode(child, at));
}

const firstChar = (text: string) => String.fromCodePoint(text.codePointAt(0)!);
const lastChar = (text: string) => Array.from(text.slice(-2)).pop()!;
const isBlank = (char: string) => !char || /\s/u.test(char);
const isPunctuation = (char: string) => /[\p{P}\p{S}]/u.test(char);
const isBlankOrPunctuation = (char: string) => isBlank(char) || isPunctuation(char);

/** 開頭的 ** 算不算粗體（CommonMark 的 left-flanking 規則）；before 是前面的文字，content 是要加粗的文字。 */
function opensBold(before: string, content: string) {
  const previous = before ? lastChar(before) : "";
  const next = firstChar(content);
  return !isBlank(next) && (!isPunctuation(next) || isBlankOrPunctuation(previous));
}

/** 結尾的 ** 算不算粗體（right-flanking 規則）；after 是後面的文字。 */
function closesBold(content: string, after: string) {
  const previous = lastChar(content);
  const next = after ? firstChar(after) : "";
  return !isBlank(previous) && (!isPunctuation(previous) || isBlankOrPunctuation(next));
}

function offset(node: Nodes, side: "start" | "end") {
  return node.position![side].offset!;
}

/** 往外移一層：移掉開頭最多一層（四格）的縮排，Tab 算到下一個四格的位置。 */
function outdentLine(line: string) {
  let column = 0;
  let index = 0;
  while (index < line.length && column < INDENT.length) {
    if (line[index] === " ") column++;
    else if (line[index] === "\t") column += INDENT.length - (column % INDENT.length);
    else break;
    index++;
  }
  return line.slice(index);
}

/** 縮排有幾格，Tab 算到下一個四格的位置。 */
function indentWidth(line: string) {
  let column = 0;
  for (const char of line.match(/^\s*/)![0]) column = char === "\t" ? column + INDENT.length - (column % INDENT.length) : column + 1;
  return column;
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
    const indent = indentWidth(stripListMarker(line));
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
