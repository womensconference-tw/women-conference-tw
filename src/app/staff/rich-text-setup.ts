import {
  defaultValueCtx,
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
import { Plugin } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose, $remark } from "@milkdown/kit/utils";
import { remarkRichText } from "@/lib/rich-text";
import { SAFE_URL } from "@/lib/safe-url";

/*
 * 所見即所得編輯器（#88）的 Milkdown 設定。只載入支援的格式：標題、粗體、編號清單、項目清單、表格、連結與換行。
 * 從 Word、Google 文件貼上時，瀏覽器給的 HTML 只會留下這些格式（其他的不在編輯器的格式表裡，自動去掉）；
 * 貼上 Markdown 或載入存檔內容時，remarkRichText 先把其他寫法改成文字。
 * 不載入 Milkdown 的「保留空行」外掛：它會把空白段落存成 <br />，HTML 不能進到存檔內容。
 */

const remarkRichTextPlugin = $remark("remarkRichText", () => remarkRichText);

/**
 * 內容變了之後的整理：
 * - 貼上或拖進來的連結和公開頁面一樣只接受 http(s)，其他的拿掉連結、只留文字。
 * - 清單一律存成緊密清單（項目之間不空行），新增的項目才不會在公開頁面多出段落間距。
 */
const normalize = $prose(
  () =>
    new Plugin({
      appendTransaction: (transactions, _old, state) => {
        if (!transactions.some((tr) => tr.docChanged)) return null;
        const { link } = state.schema.marks;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (node.attrs.spread === true) tr.setNodeAttribute(pos, "spread", false);
          const mark = link.isInSet(node.marks);
          if (mark && !SAFE_URL.test(mark.attrs.href)) tr.removeMark(pos, pos + node.nodeSize, mark);
        });
        return tr.docChanged ? tr : null;
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
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, bullet: "-" as const }));
    })
    .use(richTextPlugins)
    .use(updates)
    .create();
}

/** 編輯器目前的內容存成 Markdown。 */
export function editorMarkdown(editor: Editor): string {
  return editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
}

/** Markdown 載入編輯器再存回來的樣子，用來比對內容有沒有改。 */
export function normalizeMarkdown(editor: Editor, markdown: string): string {
  return editor.action((ctx) => ctx.get(serializerCtx)(ctx.get(parserCtx)(markdown)));
}

/** 整個換成另一份 Markdown（別人更新了、捨棄草稿）。 */
export function replaceMarkdown(editor: Editor, markdown: string) {
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const doc = ctx.get(parserCtx)(markdown);
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
  });
}
