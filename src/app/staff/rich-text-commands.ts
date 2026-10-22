import { setBlockType } from "@milkdown/kit/prose/commands";
import type { Node as ProseNode, NodeType, ResolvedPos } from "@milkdown/kit/prose/model";
import { liftListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import { canSplit } from "@milkdown/kit/prose/transform";
import { type Command, type EditorState, NodeSelection, TextSelection } from "@milkdown/kit/prose/state";
import { deleteColumn, deleteRow, deleteTable, isInTable } from "@milkdown/kit/prose/tables";
import type { EditorView } from "@milkdown/kit/prose/view";
import type { Alignment, ImageSize } from "@/lib/rich-text";

/* 所見即所得編輯器（#88）工具列的指令。 */

const isList = (node: ProseNode) => node.type.name === "ordered_list" || node.type.name === "bullet_list";

/** 這個位置所在的清單（最近的一層），沒有在清單裡是 null。 */
function listAt($pos: ResolvedPos) {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (isList(node)) return { node, pos: $pos.before(depth) };
  }
  return null;
}

/** 游標所在的清單（最近的一層），沒有在清單裡是 null。 */
export function currentList(state: EditorState) {
  return listAt(state.selection.$from);
}

/**
 * 選取範圍有清單也有清單外的段落（或跨了兩份清單）：選到的段落與清單項目全部變成一份這種清單。
 * 範圍裡有表格時不做。
 */
function mergeIntoList(type: NodeType): Command {
  return (state, dispatch) => {
    const { $from, $to } = state.selection;
    const range = $from.blockRange($to);
    if (!range) return false;
    const { list_item, paragraph } = state.schema.nodes;
    // 選取範圍在同一份清單裡（例如從一個項目選到它的下一層、或從下一層選到上一層的下一個項目）：層次不變，
    // 換掉這份清單和選到的每一層清單的種類。
    if (isList(range.parent) || range.parent.type === list_item) {
      if (dispatch) {
        const tr = state.tr;
        const listDepth = isList(range.parent) ? range.depth : range.depth - 1;
        tr.setNodeMarkup(range.$from.before(listDepth), type);
        // 只換選取範圍碰到的清單；範圍邊上的項目裡、沒選到的下一層清單不換。
        state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
          if (isList(node)) tr.setNodeMarkup(pos, type);
        });
        dispatch(tr);
      }
      return true;
    }
    const items: ProseNode[] = [];
    for (let index = range.startIndex; index < range.endIndex; index++) {
      const child = range.parent.child(index);
      if (isList(child)) child.forEach((item) => items.push(item));
      else if (child.type === list_item) items.push(child);
      else if (child.isTextblock) items.push(list_item.create(null, paragraph.create(null, child.content)));
      else return false;
    }
    if (dispatch) {
      const list = type.create(null, items);
      const tr = state.tr.replaceWith(range.start, range.end, list);
      tr.setSelection(TextSelection.between(tr.doc.resolve(range.start + 1), tr.doc.resolve(range.start + list.nodeSize - 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/**
 * 按了變成這種清單；已經是這種清單就拿掉清單，是另一種清單就換成這種（整份清單一起換，清單的編號方式是整份一樣的）。
 * 選取範圍跨出清單時，選到的全部變成這種清單。
 */
export function toggleList(type: NodeType): Command {
  return (state, dispatch) => {
    const list = currentList(state);
    const end = listAt(state.selection.$to);
    if (!list && !end) return wrapInList(type)(state, dispatch);
    if (!list || !end || list.pos !== end.pos) return mergeIntoList(type)(state, dispatch);
    if (list.node.type === type) return liftListItem(state.schema.nodes.list_item)(state, dispatch);
    dispatch?.(state.tr.setNodeMarkup(list.pos, type));
    return true;
  };
}

/** 標題與一般段落互換，對齊不變。 */
export const toggleHeading: Command = (state, dispatch) => {
  const { heading, paragraph } = state.schema.nodes;
  const { parent } = state.selection.$from;
  const align = parent.attrs.align ?? "";
  return parent.type === heading
    ? setBlockType(paragraph, { align })(state, dispatch)
    : setBlockType(heading, { level: 1, align })(state, dispatch);
};

/** 選取範圍碰到的最外層段落與標題（#102）。清單、表格裡的不能對齊，不算。 */
function alignableBlocks(state: EditorState) {
  const { from, to } = state.selection;
  const blocks: { node: ProseNode; pos: number }[] = [];
  state.doc.forEach((node, pos) => {
    const touched = pos < Math.max(to, from + 1) && pos + node.nodeSize > from;
    if (touched && (node.type.name === "paragraph" || node.type.name === "heading")) blocks.push({ node, pos });
  });
  return blocks;
}

/** 選到的段落與標題的對齊：都一樣時是那一種（靠左是 ""），不一樣或沒有能對齊的是 null。 */
export function currentAlignment(state: EditorState): Alignment | "" | null {
  const aligns = new Set(alignableBlocks(state).map(({ node }) => (node.attrs.align ?? "") as Alignment | ""));
  return aligns.size === 1 ? [...aligns][0] : null;
}

/** 選到的段落與標題改成這種對齊（靠左是 ""）。圖片的對齊跟著它那一段。 */
export function setAlignment(align: Alignment | ""): Command {
  return (state, dispatch) => {
    const blocks = alignableBlocks(state);
    if (blocks.length === 0) return false;
    if (dispatch) {
      const tr = state.tr;
      for (const { pos } of blocks) tr.setNodeAttribute(pos, "align", align);
      dispatch(tr);
    }
    return true;
  };
}

/** 選取的圖片（點一下圖片），沒有是 null。 */
export function selectedImage(state: EditorState): ProseNode | null {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === "image" ? selection.node : null;
}

/** 選取的圖片改成這個大小（滿版是 ""）。 */
export function setImageSize(size: ImageSize | ""): Command {
  return (state, dispatch) => {
    if (!selectedImage(state)) return false;
    const pos = state.selection.from;
    if (dispatch) {
      const tr = state.tr.setNodeAttribute(pos, "title", size);
      dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    }
    return true;
  };
}

/**
 * 插入圖片，圖片自己一段（對齊跟著那一段）：游標在段落中間時從游標分開，圖片放在中間；段落是空的就換成圖片。
 * 表格的格子不能分段，圖片插在游標的位置。插好之後選取圖片，馬上可以改大小。
 */
export function insertImageBlock(image: ProseNode): Command {
  return (state, dispatch) => {
    const { paragraph } = state.schema.nodes;
    const tr = state.tr.deleteSelection();
    const $pos = tr.selection.$from;
    const parent = $pos.parent;
    let imagePos: number;
    if (parent.content.size === 0 && parent.isTextblock) {
      tr.replaceWith($pos.before(), $pos.after(), paragraph.create(null, image));
      imagePos = $pos.before() + 1;
    } else if (!canSplit(tr.doc, $pos.pos)) {
      tr.replaceSelectionWith(image, false);
      imagePos = tr.selection.from - image.nodeSize;
    } else {
      const atStart = $pos.parentOffset === 0;
      const atEnd = $pos.parentOffset === parent.content.size;
      let at: number;
      if (atStart) at = $pos.before();
      else if (atEnd) at = $pos.after();
      else {
        tr.split($pos.pos);
        at = $pos.pos + 1;
      }
      tr.insert(at, paragraph.create(null, image));
      imagePos = at + 1;
    }
    if (dispatch) dispatch(tr.setSelection(NodeSelection.create(tr.doc, imagePos)).scrollIntoView());
    return true;
  };
}

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

/**
 * 刪除游標所在的列。表格一定要有標題列和至少一列資料：刪的是標題列時，下一列變成標題列；
 * 只剩兩列時刪掉整個表格。
 */
export const deleteTableRow: Command = (state, dispatch) => {
  if (!isInTable(state)) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return node.childCount <= 2 ? deleteTable(state, dispatch) : deleteRow(state, dispatch);
    if (node.type.name !== "table_header_row") continue;
    const table = $from.node(depth - 1);
    if (table.childCount <= 2) return deleteTable(state, dispatch);
    if (dispatch) {
      const { table_header } = state.schema.nodes;
      const next = table.child(1);
      const cells: ProseNode[] = [];
      next.forEach((cell) => cells.push(table_header.create(cell.attrs, cell.content)));
      const start = $from.before(depth);
      const tr = state.tr.replaceWith(start, start + node.nodeSize + next.nodeSize, node.type.create(node.attrs, cells));
      tr.setSelection(TextSelection.near(tr.doc.resolve(start + 1)));
      dispatch(tr.scrollIntoView());
    }
    return true;
  }
  return false;
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
