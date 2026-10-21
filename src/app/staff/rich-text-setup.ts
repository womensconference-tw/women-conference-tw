import {
  defaultValueCtx,
  editorStateCtx,
  editorViewCtx,
  Editor,
  editorViewOptionsCtx,
  parserCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  serializerCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { history } from "@milkdown/kit/plugin/history";
import {
  bulletListSchema,
  docSchema,
  hardbreakAttr,
  hardbreakKeymap,
  hardbreakSchema,
  headingAttr,
  headingIdGenerator,
  headingSchema,
  insertHardbreakCommand,
  liftListItemCommand,
  listItemKeymap,
  listItemSchema,
  orderedListSchema,
  paragraphAttr,
  paragraphSchema,
  sinkListItemCommand,
  splitListItemCommand,
  strongAttr,
  strongKeymap,
  strongSchema,
  textSchema,
  bulletListAttr,
  orderedListAttr,
  listItemAttr,
  linkAttr,
  linkSchema,
  liftFirstListItemCommand,
  toggleStrongCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  bulletListKeymap,
  orderedListKeymap,
} from "@milkdown/kit/preset/commonmark";
import {
  remarkGFMPlugin,
  tableCellSchema,
  tableEditingPlugin,
  tableHeaderRowSchema,
  tableHeaderSchema,
  tableKeymap,
  tablePasteRule,
  tableRowSchema,
  tableSchema,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  exitTable,
  insertTableCommand,
} from "@milkdown/kit/preset/gfm";
import { Fragment, type Node as ProseNode } from "@milkdown/kit/prose/model";
import { EditorState, Plugin } from "@milkdown/kit/prose/state";
import { TableMap } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, $remark } from "@milkdown/kit/utils";
import { joinListItemChildren, remarkRichText } from "@/lib/rich-text";
import { SAFE_URL } from "@/lib/safe-url";

/*
 * 所見即所得編輯器（#88）的 Milkdown 設定。只載入支援的格式：標題、粗體、編號清單、項目清單、表格、連結與換行。
 * 從 Word、Google 文件貼上時，瀏覽器給的 HTML 只會留下這些格式（其他的不在編輯器的格式表裡，自動去掉）；
 * 貼上 Markdown 或載入存檔內容時，remarkRichText 先把其他寫法改成文字。
 * 不載入 Milkdown 的「保留空行」外掛：它會把空白段落存成 <br />，HTML 不能進到存檔內容。
 */

const remarkRichTextPlugin = $remark("remarkRichText", () => remarkRichText);

/**
 * 表格有合併的儲存格（從 Word、Google 文件貼上）時拆開：Markdown 表格不能合併，合併的文字放在左上那一格，
 * 其他格留空，後面的文字才不會跑到別的欄。沒有合併時傳回 null。
 */
function unmergeTable(table: ProseNode): ProseNode | null {
  let merged = false;
  table.descendants((node) => {
    if (node.attrs.colspan > 1 || node.attrs.rowspan > 1) merged = true;
    return !merged;
  });
  if (!merged) return null;
  const map = TableMap.get(table);
  const rows: ProseNode[] = [];
  for (let r = 0; r < map.height; r++) {
    const row = table.child(r);
    // 整列被上面的合併格蓋住時，這一列沒有自己的儲存格，依列的種類決定。
    const { table_header, table_cell } = table.type.schema.nodes;
    const cellType = row.type.name === "table_header_row" ? table_header : table_cell;
    const cells: ProseNode[] = [];
    for (let c = 0; c < map.width; c++) {
      const pos = map.map[r * map.width + c];
      const rect = map.findCell(pos);
      const cell = table.nodeAt(pos)!;
      const attrs = { ...cell.attrs, colspan: 1, rowspan: 1, colwidth: null };
      cells.push(rect.left === c && rect.top === r ? cellType.create(attrs, cell.content) : cellType.createAndFill(attrs)!);
    }
    rows.push(row.type.create(row.attrs, cells));
  }
  return table.type.create(table.attrs, rows);
}

/**
 * 內容變了之後的整理，讓編輯器裡看到的和存出來的 Markdown 一樣：
 * - 表格合併的儲存格拆開；一格裡的換行（Markdown 存不了）改成空白。
 * - 清單存成緊密清單（項目之間不空行），新增的項目才不會在公開頁面多出段落間距。項目裡的表格前後要不要空行由
 *   joinListItemChildren 決定。
 * - 貼上或拖進來的連結和公開頁面一樣只接受 http(s)，其他的拿掉連結、只留文字。
 * 外掛自己補的修改，ProseMirror 不會再交給它看一次，所以一次做完：先拆合併格，再整理拆好的文件。
 */
const normalize = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const { link } = state.schema.marks;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "table") return true;
          const unmerged = unmergeTable(node);
          if (unmerged) tr.replaceWith(tr.mapping.map(pos), tr.mapping.map(pos + node.nodeSize), unmerged);
          return false;
        });
        const doc = tr.doc;
        const base = tr.steps.length;
        const map = (pos: number) => tr.mapping.slice(base).map(pos);
        doc.descendants((node, pos) => {
          if (node.type.name === "hardbreak" && doc.resolve(pos).node(-1).type.spec.tableRole) {
            tr.replaceWith(map(pos), map(pos + node.nodeSize), state.schema.text(" "));
            return false;
          }
          if (node.attrs.spread === true) tr.setNodeAttribute(map(pos), "spread", false);
          const mark = link.isInSet(node.marks);
          if (mark && !SAFE_URL.test(mark.attrs.href)) tr.removeMark(map(pos), map(pos + node.nodeSize), mark);
        });
        return tr.docChanged ? tr : null;
      },
    }),
);

/**
 * 從 VS Code 複製的文字，Milkdown 會想建立程式碼區塊，但編輯器沒有載入程式碼區塊，貼上會失敗。
 * 改成一般的純文字貼上。
 */
const plainVsCodePaste = $prose(
  () =>
    new Plugin({
      props: {
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          if (!data?.getData("vscode-editor-data")) return false;
          return view.pasteText(data.getData("text/plain"));
        },
      },
    }),
);

export const richTextPlugins: MilkdownPlugin[] = [
  docSchema,
  paragraphAttr,
  paragraphSchema,
  headingIdGenerator,
  headingAttr,
  headingSchema,
  hardbreakAttr,
  hardbreakSchema,
  bulletListAttr,
  bulletListSchema,
  orderedListAttr,
  orderedListSchema,
  listItemAttr,
  listItemSchema,
  strongAttr,
  strongSchema,
  linkAttr,
  linkSchema,
  textSchema,
  tableSchema,
  tableHeaderRowSchema,
  tableRowSchema,
  tableHeaderSchema,
  tableCellSchema,

  remarkGFMPlugin,
  remarkRichTextPlugin,
  tableEditingPlugin,
  tablePasteRule,
  normalize,

  insertHardbreakCommand,
  wrapInOrderedListCommand,
  wrapInBulletListCommand,
  sinkListItemCommand,
  splitListItemCommand,
  liftListItemCommand,
  liftFirstListItemCommand,
  toggleStrongCommand,
  insertTableCommand,
  goToNextTableCellCommand,
  goToPrevTableCellCommand,
  exitTable,

  hardbreakKeymap,
  listItemKeymap,
  orderedListKeymap,
  bulletListKeymap,
  strongKeymap,
  tableKeymap,

  plainVsCodePaste,
  clipboard,
  history,
].flat();

/**
 * 建立編輯器。attributes 是編輯區的 HTML 屬性（無障礙名稱、樣式）；onUpdate 在內容或游標位置變了時呼叫，
 * 工具列依此更新按鈕狀態。
 */
export function createRichTextEditor(
  root: HTMLElement,
  markdown: string,
  attributes: Record<string, string> = {},
  onUpdate: (view: EditorView) => void = () => {},
) {
  const updates = $prose(
    () =>
      new Plugin({
        view: (view) => {
          onUpdate(view);
          return { update: (view) => onUpdate(view) };
        },
      }),
  );
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes }));
      // 項目清單和舊的樣式按鈕一樣用「-」。
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
        join: [joinListItemChildren, ...(prev.join ?? [])],
      }));
    })
    .use(richTextPlugins)
    .use(updates)
    .create();
}

/**
 * 存檔前拿掉清單項目裡第一段以外的空段落（例如貼上的 <li><p></p><p></p><table>）。空段落存出來是空行，
 * 「1.」後面空一行，後面的表格或下一層清單就不在這個項目裡了。只在存出的內容拿掉，編輯器裡的文件不動，
 * 打字打到段落暫時空了也不會被刪。
 */
function withoutEmptyListParagraphs(node: ProseNode): ProseNode {
  if (node.isTextblock || node.isLeaf) return node;
  const children: ProseNode[] = [];
  node.forEach((child, _offset, index) => {
    const empty = child.type.name === "paragraph" && child.content.size === 0;
    if (node.type.name === "list_item" && index > 0 && empty) return;
    children.push(withoutEmptyListParagraphs(child));
  });
  return node.copy(Fragment.from(children));
}

/** 編輯器目前的內容存成 Markdown。 */
export function editorMarkdown(editor: Editor): string {
  return editor.action((ctx) => ctx.get(serializerCtx)(withoutEmptyListParagraphs(ctx.get(editorViewCtx).state.doc)));
}

/** Markdown 載入編輯器再存回來的樣子，用來比對內容有沒有改。 */
export function normalizeMarkdown(editor: Editor, markdown: string): string {
  return editor.action((ctx) => ctx.get(serializerCtx)(withoutEmptyListParagraphs(ctx.get(parserCtx)(markdown))));
}

/**
 * 整個換成另一份 Markdown（別人更新了、捨棄草稿）。復原紀錄一併清掉，按 Ctrl+Z 不會回到被換掉的內容。
 */
export function replaceMarkdown(editor: Editor, markdown: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const state = EditorState.create({ doc: ctx.get(parserCtx)(markdown), plugins: view.state.plugins });
    view.updateState(state);
    // Milkdown 平常在每個 transaction 記下目前的狀態，直接換狀態時要自己記。
    ctx.set(editorStateCtx, state);
  });
}
