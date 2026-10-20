import { describe, expect, it } from "vitest";
import { readXlsx } from "../../test/xlsx";
import { writeXlsx } from "./xlsx";

describe("Excel 檔", () => {
  it("每個工作表的每一格照原樣存下，中文、符號、前後空白都不變", () => {
    const sheets = [
      { name: "名單", rows: [["姓名", "備註"], ["王小美", "<b>&\"粗體\"</b>"], ["  前後空白  ", ""]] },
      { name: "場次對照", rows: [["場地", "第一場次"]] },
    ];
    const { sheets: read } = readXlsx(writeXlsx(sheets));
    expect(read).toEqual(sheets);
  });

  it("文字裡本來就有 _x000D_ 這種寫法、或有 CR 換行時，Excel 讀到的和原本一樣", () => {
    const rows = [["課程_x000D_名稱", "第一行\r\n第二行", "_x005F_"]];
    const { files, sheets } = readXlsx(writeXlsx([{ name: "名單", rows }]));
    expect(sheets[0].rows).toEqual(rows);
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("課程_x005F_x000D_名稱");
    expect(files.get("xl/worksheets/sheet1.xml")).toContain("第一行&#13;");
  });

  it("超過 26 欄時欄名接著 AA、AB", () => {
    const row = Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 欄`);
    const { files, sheets } = readXlsx(writeXlsx([{ name: "寬", rows: [row] }]));
    expect(sheets[0].rows).toEqual([row]);
    expect(files.get("xl/worksheets/sheet1.xml")).toContain('r="AD1"');
  });

  it("只有表頭、沒有資料列也是完整的檔案", () => {
    const { sheets } = readXlsx(writeXlsx([{ name: "名單", rows: [["姓名"]] }]));
    expect(sheets).toEqual([{ name: "名單", rows: [["姓名"]] }]);
  });

  it("XML 不允許的控制字元拿掉，不會讓 Excel 打不開", () => {
    const { sheets } = readXlsx(writeXlsx([{ name: "名單", rows: [["王\u0007小美"]] }]));
    expect(sheets[0].rows).toEqual([["王小美"]]);
  });

  it("檔案宣告為 UTF-8，列出每個工作表與表頭的粗體樣式", () => {
    const { files } = readXlsx(writeXlsx([{ name: "名單", rows: [["姓名"], ["王小美"]] }]));
    expect([...files.keys()].toSorted()).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
    ]);
    for (const xml of files.values()) expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('<c r="A2" t="inlineStr">');
  });
});
