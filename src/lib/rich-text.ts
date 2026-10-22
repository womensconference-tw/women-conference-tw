import type { Break, Heading, Image, Nodes, Paragraph, Parent, Parents, PhrasingContent, Root, RootContent, Text } from "mdast";
import { type ContainerDirective, directiveFromMarkdown, directiveToMarkdown } from "mdast-util-directive";
import { toMarkdown } from "mdast-util-to-markdown";
import { directive } from "micromark-extension-directive";
import type { Processor } from "unified";
import type { VFile } from "vfile";
import { isHighlightImageUrl } from "./highlight-images";
import { SAFE_URL } from "./safe-url";

/*
 * 籌備委員會文字頁與大會特色介紹內容的所見即所得編輯器（#88）讀 Markdown 時的整理，不依賴編輯器，前後台都能用。
 * 編輯器只認得標題、粗體、編號清單、項目清單、表格、連結與換行；其他寫法（引言、程式碼、斜體、刪除線、圖片、HTML 等）
 * 在載入、貼上時改成文字，存檔內容就只會有這幾種格式。大會特色的編輯器另外留下從後台上傳的圖片（#102）。
 *
 * 對齊與圖片大小（#102）：Markdown 本身記不了，用常見的擴充寫法（directive 的區塊寫法）。
 * - 置中、靠右的段落或標題用「:::center」「:::right」那一行和「:::」那一行包住；靠左是預設，不另外記。
 *   只有最外層的段落與標題能對齊，清單、表格裡的不行。
 * - 圖片大小存在圖片的標題：![說明](網址 "small")，small、medium、large 是內容寬度的 1/3、1/2、2/3，沒有標題是滿版。
 *   圖片自己一段，對齊跟著那一段。
 * - 其他 ::: 寫法（例如 :::note），照原文當成文字。
 */

/** 段落與標題的對齊；靠左是預設，不在這裡。 */
export const ALIGNMENTS = ["center", "right"] as const;
export type Alignment = (typeof ALIGNMENTS)[number];
export const isAlignment = (value: unknown): value is Alignment => ALIGNMENTS.includes(value as Alignment);

/** 圖片大小；滿版是預設，不在這裡。 */
export const IMAGE_SIZES = ["small", "medium", "large"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const isImageSize = (value: unknown): value is ImageSize => IMAGE_SIZES.includes(value as ImageSize);

declare module "mdast" {
  interface ParagraphData {
    /** 編輯器讀進來時的對齊（:::center 包住的段落）。 */
    align?: Alignment;
  }
  interface HeadingData {
    align?: Alignment;
  }
}

/**
 * remark 外掛：讀寫「:::名稱」那一行和「:::」那一行包住的區塊。只載入區塊寫法，不載入 directive 的「:名稱」「::名稱」：
 * 那兩種會把文字裡的「Note:bring」讀成指令，存檔時也會在幾乎每個冒號前加反斜線（例如 9\:00、網址裡的 \:）。
 */
export function remarkContainerDirective(this: Processor) {
  const data = this.data();
  const flow = directive().flow![58];
  const container = (Array.isArray(flow) ? flow : [flow]).find((construct) => construct?.concrete)!;
  (data.micromarkExtensions ??= []).push({ flow: { 58: container } });
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(containerDirectiveToMarkdown());
}

/** 存檔時的 ::: 區塊。冒號只留行首的跳脫規則：行首的「:::」要跳脫，才不會讀回來變成區塊。 */
function containerDirectiveToMarkdown() {
  const extension = directiveToMarkdown();
  return { ...extension, unsafe: extension.unsafe?.filter((rule) => rule.character !== ":" || rule.atBreak) };
}

/** 「:::center」「:::right」只寫了名稱（沒有 [說明] 或 {屬性}）才是對齊。 */
function isAlignDirective(node: ContainerDirective): boolean {
  if (!isAlignment(node.name)) return false;
  if (node.attributes && Object.keys(node.attributes).length > 0) return false;
  return !node.children.some((child) => child.type === "paragraph" && child.data?.directiveLabel);
}

/**
 * 不是對齊的 ::: 寫法，照原文。在引言、清單裡時，第二行起每一行開頭的「>」、空白、tab 是外層的，不算進來（Codex 審查）。
 * 外層的前綴每行長短可能不同（「> 」或「>」、省略的縮排、懶惰續行），所以只拿掉這幾種字元，最多和第一行的前綴一樣長，
 * 不會切到內文。
 */
function directiveSource(node: ContainerDirective, source: string): string {
  const { start, end } = node.position ?? {};
  if (!start || !end) return "";
  const lines = source.split(/\r?\n|\r/).slice(start.line - 1, end.line);
  lines[lines.length - 1] = lines[lines.length - 1].slice(0, end.column - 1);
  const prefix = start.column - 1;
  return lines
    .map((line, index) => {
      if (index === 0) return line.slice(prefix);
      let cut = 0;
      while (cut < prefix && /[ \t>]/.test(line[cut] ?? "")) cut++;
      return line.slice(cut);
    })
    .join("\n");
}

type Piece = { image: Image } | { content: PhrasingContent[] };

const containsImage = (node: PhrasingContent): boolean =>
  node.type === "image" || ("children" in node && node.children.some(containsImage));

/**
 * 一串行內內容依圖片切開。連結、粗體裡的圖片也拿出來（Codex 審查）：編輯器的圖片不能有連結或粗體，
 * 前後的文字保留原本的連結、粗體。
 */
function splitAtImages(children: PhrasingContent[]): Piece[] {
  const pieces: Piece[] = [];
  const addContent = (node: PhrasingContent) => {
    const last = pieces.at(-1);
    if (last && "content" in last) last.content.push(node);
    else pieces.push({ content: [node] });
  };
  for (const child of children) {
    if (child.type === "image") pieces.push({ image: child });
    else if ((child.type === "link" || child.type === "strong") && containsImage(child)) {
      for (const piece of splitAtImages(child.children)) {
        if ("image" in piece) pieces.push(piece);
        else addContent({ ...child, children: piece.content } as PhrasingContent);
      }
    } else addContent(child);
  }
  return pieces;
}

/**
 * 圖片自己一段（Codex 審查）：段落或標題裡的圖片和文字分開，圖片各自成為一個段落，前後的文字留在原本的段落或標題。
 * 分開處的換行拿掉。和編輯器的 separateImageNodes 結果一樣，載入後第一次編輯版面才不會變。
 */
function separateImages(node: Paragraph | Heading): RootContent[] {
  if (!node.children.some(containsImage)) return [node];
  const pieces = splitAtImages(node.children);
  if (pieces.length === 1 && "image" in pieces[0] && node.type === "paragraph" && node.children.length === 1) return [node];
  const out: RootContent[] = [];
  for (const piece of pieces) {
    if ("image" in piece) {
      out.push({ type: "paragraph", children: [piece.image] });
      continue;
    }
    const run = [...piece.content];
    while (run[0]?.type === "break") run.shift();
    while (run.at(-1)?.type === "break") run.pop();
    if (run.some((child) => child.type !== "text" || child.value.trim())) out.push({ ...node, children: run });
  }
  return out;
}

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

/**
 * definitions：連結定義（[a]: 網址）；images：大會特色的編輯器，留下從後台上傳的圖片（#102）；
 * source：原本的 Markdown，不認得的指令寫法照原文；root：在最外層（不在清單、表格、引言裡），只有這裡能對齊。
 */
type Context = { definitions: Definitions; images: boolean; source: string; root: boolean };

/** 整理一串子節點，傳回換掉之後的子節點。 */
function cleanChildren(children: RootContent[], context: Context, block: boolean): RootContent[] {
  return children.flatMap((child) => clean(child, context, block));
}

function clean(node: RootContent, context: Context, block: boolean): RootContent[] {
  switch (node.type) {
    case "paragraph":
    case "heading":
      node.children = cleanChildren(node.children, context, false) as typeof node.children;
      return separateImages(node);
    case "strong":
    case "tableRow":
      node.children = cleanChildren(node.children, context, false) as typeof node.children;
      return [node];
    case "tableCell":
      // 表格的格子裡不放圖片（自己一段做不到），只留圖片說明。
      node.children = cleanChildren(node.children, { ...context, images: false }, false) as typeof node.children;
      return [node];
    case "list":
      node.spread = false;
      node.children = cleanChildren(node.children, { ...context, root: false }, true) as typeof node.children;
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
      node.spread = false;
      node.children = cleanChildren(node.children, { ...context, root: false }, true) as typeof node.children;
      // 編輯器的清單項目一定以段落開頭；「1.」後面直接接表格時補一個空段落。
      if (node.children[0]?.type !== "paragraph") node.children.unshift({ type: "paragraph", children: [] });
      return [node];
    }
    case "table":
      node.children = cleanChildren(node.children, { ...context, root: false }, true) as typeof node.children;
      return [node];
    case "text":
      return textWithBreaks(node.value);
    case "break":
      return [node];
    case "link":
      node.children = cleanChildren(node.children, context, false) as typeof node.children;
      // 和公開頁面一樣只接受 http(s)，其他的只留文字。
      return SAFE_URL.test(node.url) ? [{ ...node, title: null }] : node.children;
    case "linkReference": {
      const url = context.definitions.get(node.identifier);
      const children = cleanChildren(node.children, context, false) as PhrasingContent[];
      return url && SAFE_URL.test(url) ? [{ type: "link", url, children }] : children;
    }
    case "emphasis":
    case "delete":
      return cleanChildren(node.children, context, false);
    case "blockquote":
    case "footnoteDefinition":
      return cleanChildren(node.children, { ...context, root: false }, true);
    case "inlineCode":
    case "html":
      return wrap(textWithBreaks(node.value), block);
    case "code":
      return [{ type: "paragraph", children: textWithBreaks(node.value) }];
    case "image":
    case "imageReference": {
      const url = node.type === "image" ? node.url : context.definitions.get(node.identifier);
      // 圖片只留從後台上傳的（#102），其他的只留圖片說明。
      if (context.images && url && isHighlightImageUrl(url)) {
        const title = node.type === "image" && isImageSize(node.title) ? node.title : null;
        return [{ type: "image", url, alt: node.alt ?? "", title }];
      }
      return node.alt ? wrap([{ type: "text", value: node.alt }], block) : [];
    }
    case "containerDirective":
      if (block && isAlignDirective(node)) {
        const children = cleanChildren(node.children, context, true);
        // 清單、表格、引言裡的對齊存不了（Codex 審查），只留內容。
        if (!context.root) return children;
        for (const child of children) {
          if (child.type === "paragraph" || child.type === "heading") child.data = { ...child.data, align: node.name as Alignment };
        }
        return children;
      }
      return wrap(textWithBreaks(directiveSource(node, context.source)), block);
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

/** remark 外掛：把 Markdown 整理成編輯器認得的格式。images：留下從後台上傳的圖片（大會特色的編輯器，#102）。 */
export function remarkRichText({ images = false }: { images?: boolean } = {}) {
  return (tree: Root, file: VFile) => {
    const definitions: Definitions = new Map();
    collectDefinitions(tree, definitions);
    tree.children = cleanChildren(tree.children, { definitions, images, source: String(file), root: true }, true);
  };
}

/**
 * remark 外掛（公開頁面，排在 remarkContainerDirective 後面）：「:::center」「:::right」包住的段落與標題記下對齊
 * （HTML 的 data-align），其他 ::: 寫法照原文當成文字。和編輯器一樣只有最外層的能對齊，清單、表格、引言裡的只留內容。
 */
export function remarkAlign() {
  return (tree: Root, file: VFile) => resolveDirectives(tree, String(file), true);
}

function resolveDirectives(parent: Parent, source: string, root: boolean) {
  parent.children = parent.children.flatMap((child): RootContent[] => {
    if (child.type === "containerDirective" && isAlignDirective(child)) {
      resolveDirectives(child, source, root);
      if (!root) return child.children;
      for (const block of child.children) {
        if (block.type === "paragraph" || block.type === "heading") {
          block.data = { ...block.data, hProperties: { ...block.data?.hProperties, dataAlign: child.name } };
        }
      }
      return child.children;
    }
    if (child.type === "containerDirective") {
      return [{ type: "paragraph", children: [{ type: "text", value: directiveSource(child, source) }] }];
    }
    if ("children" in child) resolveDirectives(child, source, false);
    return [child];
  });
}

/**
 * 改版前存的純文字（committee_texts.markdown = false），轉成照樣顯示的 Markdown：空一行分段，換行保留，
 * 原本的 *、# 與行首的 ::: 跳脫成文字。
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
  // 行首的「:::」跳脫，才不會被讀成對齊或其他區塊（Codex 審查）。
  return toMarkdown(tree, { extensions: [containerDirectiveToMarkdown()] });
}

/**
 * 存檔時清單項目裡各段之間要不要空行（mdast-util-to-markdown 的 join）。清單存成緊密清單，但表格前後一定要空行，
 * 否則表格後面的文字會被讀成表格的一列。項目開頭是空段落（例如刪光了表格前的文字）時不空行：
 * 「1.」後面空一行，表格就不在清單裡了。
 */
export function joinListItemChildren(left: Nodes, right: Nodes, parent: Parents): number | undefined {
  if (parent.type !== "listItem") return undefined;
  // Milkdown 存出的空段落沒有 children。
  if (left.type === "paragraph" && !left.children?.length) return 0;
  if (left.type === "paragraph" && right.type === "list") return 0;
  return 1;
}
