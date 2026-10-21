import type { Break, Nodes, Parent, PhrasingContent, Root, RootContent, Text } from "mdast";
import { toMarkdown } from "mdast-util-to-markdown";
import { SAFE_URL } from "./safe-url";

/*
 * 籌備委員會文字頁與大會特色介紹內容的所見即所得編輯器（#88）讀 Markdown 時的整理，不依賴編輯器，前後台都能用。
 * 編輯器只認得標題、粗體、編號清單、項目清單、表格、連結與換行；其他寫法（引言、程式碼、斜體、刪除線、圖片、HTML 等）
 * 在載入、貼上時改成文字，存檔內容就只會有這幾種格式。
 */

/** 不支援的節點裡的文字，換行變成換行節點。 */
function textWithBreaks(value: string): PhrasingContent[] {
  const out: PhrasingContent[] = [];
  value.split(/\r?\n|\r/).forEach((line, index) => {
    if (index > 0) out.push({ type: "break" } satisfies Break);
    if (line) out.push({ type: "text", value: line } satisfies Text);
  });
  return out;
}

type Definitions = Map<string, string>;

/** 整理一串子節點，傳回換掉之後的子節點。 */
function cleanChildren(children: RootContent[], definitions: Definitions, block: boolean): RootContent[] {
  return children.flatMap((child) => clean(child, definitions, block));
}

function clean(node: RootContent, definitions: Definitions, block: boolean): RootContent[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "strong":
    case "tableCell":
    case "tableRow":
      node.children = cleanChildren(node.children, definitions, false) as typeof node.children;
      return [node];
    case "list":
      node.spread = false;
      node.children = cleanChildren(node.children, definitions, true) as typeof node.children;
      return [node];
    case "listItem": {
      // 「- [ ]」待辦清單沒有對應的按鈕，打勾的框留成文字。
      if (node.checked != null) {
        const first = node.children[0];
        const box: Text = { type: "text", value: node.checked ? "[x] " : "[ ] " };
        if (first?.type === "paragraph") first.children.unshift(box);
        else node.children.unshift({ type: "paragraph", children: [box] });
        node.checked = null;
      }
      node.children = cleanChildren(node.children, definitions, true) as typeof node.children;
      // 存成緊密清單；第一段之後除了下一層清單還有別的（例如表格）時，要空行分隔才讀得回來。
      node.spread = node.children.slice(1).some((child) => child.type !== "list");
      return [node];
    }
    case "table":
      node.children = cleanChildren(node.children, definitions, true) as typeof node.children;
      return [node];
    case "text":
      return textWithBreaks(node.value);
    case "break":
      return [node];
    case "link":
      node.children = cleanChildren(node.children, definitions, false) as typeof node.children;
      // 和公開頁面一樣只接受 http(s)，其他的只留文字。
      return SAFE_URL.test(node.url) ? [{ ...node, title: null }] : node.children;
    case "linkReference": {
      const url = definitions.get(node.identifier);
      const children = cleanChildren(node.children, definitions, false) as PhrasingContent[];
      return url && SAFE_URL.test(url) ? [{ type: "link", url, children }] : children;
    }
    case "emphasis":
    case "delete":
      return cleanChildren(node.children, definitions, false);
    case "blockquote":
    case "footnoteDefinition":
      return cleanChildren(node.children, definitions, true);
    case "inlineCode":
    case "html":
      return wrap(textWithBreaks(node.value), block);
    case "code":
      return [{ type: "paragraph", children: textWithBreaks(node.value) }];
    case "image":
    case "imageReference":
      return node.alt ? wrap([{ type: "text", value: node.alt }], block) : [];
    default:
      // 分隔線、連結定義、註腳編號等。
      return [];
  }
}

/** 區塊位置（例如 HTML 區塊）的文字要包成段落。 */
function wrap(children: PhrasingContent[], block: boolean): RootContent[] {
  if (!block) return children;
  return children.length ? [{ type: "paragraph", children }] : [];
}

function collectDefinitions(node: Nodes, definitions: Definitions) {
  if (node.type === "definition") definitions.set(node.identifier, node.url);
  if ("children" in node) for (const child of (node as Parent).children) collectDefinitions(child, definitions);
}

/** remark 外掛：把 Markdown 整理成編輯器認得的格式。 */
export function remarkRichText() {
  return (tree: Root) => {
    const definitions: Definitions = new Map();
    collectDefinitions(tree, definitions);
    tree.children = cleanChildren(tree.children, definitions, true);
  };
}

/**
 * 改版前存的純文字（committee_texts.markdown = false），轉成照樣顯示的 Markdown：空一行分段，換行保留，
 * 原本的 * 或 # 跳脫成文字。
 */
export function plainTextToMarkdown(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n(?:[ \t]*\n)+/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim());
  if (!paragraphs.length) return "";
  const tree: Root = {
    type: "root",
    children: paragraphs.map((block) => ({ type: "paragraph", children: textWithBreaks(block) })),
  };
  return toMarkdown(tree);
}

