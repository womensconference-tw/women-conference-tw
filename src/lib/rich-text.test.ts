import { fromMarkdown } from "mdast-util-from-markdown";
import { describe, expect, it } from "vitest";
import { plainTextToMarkdown } from "./rich-text";

/*
 * 改版前存的純文字轉成照樣顯示的 Markdown（#88）。
 */

describe("plainTextToMarkdown", () => {
  it("空一行分段，換行保留，Markdown 符號跳脫成文字", () => {
    const markdown = plainTextToMarkdown("一、宗旨\r\n1. 本會\n    縮排\n\n \n# 不是標題\n**不是粗體** <b>x</b> [a](javascript:x)\n");
    const tree = fromMarkdown(markdown);
    expect(tree.children.map((node) => node.type)).toEqual(["paragraph", "paragraph"]);
    // 行首的空白存成 &#x20;（字元參照，顯示成空白），不會變成程式碼區塊。
    expect(markdown).toBe(
      "一、宗旨\\\n1\\. 本會\\\n&#x20;   縮排\n\n\\# 不是標題\\\n\\*\\*不是粗體\\*\\* \\<b>x\\</b> \\[a]\\(javascript:x)\n",
    );
  });

  it("空白內容是空字串", () => {
    expect(plainTextToMarkdown(" \n\n ")).toBe("");
  });
});
