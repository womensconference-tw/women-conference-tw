import { setBlockType } from "@milkdown/kit/prose/commands";
import type { NodeType } from "@milkdown/kit/prose/model";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { type Command, type EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { deleteColumn, deleteRow, deleteTable, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";

/* 所見即所得編輯器（#88）工具列的指令。 */

/** 游標所在的清單（最近的一層），沒有在清單裡是 null。 */
export function currentList(state: EditorState) {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "ordered_list" || node.type.name === "bullet_list") return { node, pos: $from.before(depth) };
  }
  return null;
}

/** 按了變成這種清單；已經是這種清單就拿掉清單，是另一種清單就換成這種。 */
export function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const list = currentList(state);
    if (!list) return wrapInList(type)(state, dispatch);
    if (list.node.type === type) return liftListItem(state.schema.nodes.list_item)(state, dispatch);
    dispatch?.(state.tr.setNodeMarkup(list.pos, type));
    return true;
  };
}

/** 標題與一般段落互換。 */
export const toggleHeading: Command = (state, dispatch) => {
  const { heading, paragraph } = state.schema.nodes;
  return state.selection.$from.parent.type === heading
    ? setBlockType(paragraph)(state, dispatch)
    : setBlockType(heading, { level: 1 })(state, dispatch);
};

/** 插入三列兩欄（含標題列）的表格，游標放在第一格。 */
export const insertTable: Command = (state, dispatch) => {
  if (isInTable(state)) return false;
  const { table, table_header_row, table_row, table_header, table_cell, paragraph } = state.schema.nodes;
  const cells = (type: NodeType) => [type.create(null, paragraph.create()), type.create(null, paragraph.create())];
  const node = table.create(null, [
    table_header_row.create(null, cells(table_header)),
    table_row.create(null, cells(table_cell)),
    table_row.create(null, cells(table_cell)),
  ]);
  if (dispatch) {
    const tr = state.tr.replaceSelectionWith(node);
    // 插入的位置可能在游標所在段落的後面，找到剛插入的表格。
    let tablePos = -1;
    tr.doc.descendants((child, pos) => {
      if (child === node) tablePos = pos;
      return tablePos < 0;
    });
    if (tablePos >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 1)));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** 刪除游標所在的列；只剩標題列時刪掉整個表格，表格不會沒有標題列。 */
export const deleteTableRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table_header_row") return deleteTable(state, dispatch);
    if (node.type.name === "table") break;
  }
  return deleteRow(state, dispatch);
};

/** 只剩一欄時刪掉整個表格。 */
export const deleteTableColumn: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return node.firstChild?.childCount === 1 ? deleteTable(state, dispatch) : deleteColumn(state, dispatch);
  }
  return false;
};

/** 游標所在（或選取範圍開頭）的連結網址。 */
export function currentLink(state: EditorState): string {
  const { link } = state.schema.marks;
  const marks = state.selection.empty ? (state.storedMarks ?? state.selection.$from.marks()) : state.selection.$from.marksAcross(state.selection.$to) ?? [];
  return (link.isInSet(marks)?.attrs.href as string | undefined) ?? "";
}

/** 選取範圍（沒選取時是游標所在的整個連結）加上或拿掉連結。 */
export function setLink(view: EditorView, href: string) {
  const { state } = view;
  const { link } = state.schema.marks;
  let { from, to } = state.selection;
  if (state.selection.empty) {
    // 游標在連結裡：改這整個連結的網址。
    const $pos = state.selection.$from;
    const mark = link.isInSet($pos.marks());
    if (mark) {
      const parent = $pos.parent;
      const start = $pos.start();
      let offset = 0;
      for (let index = 0; index < parent.childCount; index++) {
        const child = parent.child(index);
        const end = offset + child.nodeSize;
        if (mark.isInSet(child.marks) && start + offset <= $pos.pos && $pos.pos <= start + end) {
          from = start + offset;
          to = start + end;
          // 連在一起的同一個連結。
          for (let next = index + 1; next < parent.childCount && mark.isInSet(parent.child(next).marks); next++)
            to += parent.child(next).nodeSize;
          for (let prev = index - 1; prev >= 0 && mark.isInSet(parent.child(prev).marks); prev--)
            from -= parent.child(prev).nodeSize;
          break;
        }
        offset = end;
      }
    }
  }
  const tr = state.tr;
  if (from === to) {
    // 沒選文字：把網址當成連結文字插進去。
    if (href) tr.insertText(href, from).addMark(from, from + href.length, link.create({ href }));
  } else {
    tr.removeMark(from, to, link);
    if (href) tr.addMark(from, to, link.create({ href }));
  }
  view.dispatch(tr.scrollIntoView());
}
