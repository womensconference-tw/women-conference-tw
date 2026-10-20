import { crc32, deflateRawSync } from "node:zlib";

/*
 * 產生最簡單的 Excel 檔（.xlsx）：幾個工作表，每格都是文字，第一列是表頭（粗體、捲動時固定在上面）。
 * .xlsx 是一個 zip 檔，裡面放幾個 XML。只需要這麼一點功能，不另外裝套件。
 * 文字用 UTF-8 存，Excel 開啟中文不會變亂碼。
 */

export type Sheet = { name: string; rows: string[][] };

export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const files: [string, string][] = [
    ["[Content_Types].xml", contentTypes(sheets.length)],
    [
      "_rels/.rels",
      relationships([
        ["rId1", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument", "xl/workbook.xml"],
      ]),
    ],
    ["xl/workbook.xml", workbook(sheets)],
    [
      "xl/_rels/workbook.xml.rels",
      relationships([
        ...sheets.map(
          (_, index) =>
            [
              `rId${index + 1}`,
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet",
              `worksheets/sheet${index + 1}.xml`,
            ] as const,
        ),
        [
          `rId${sheets.length + 1}`,
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
          "styles.xml",
        ],
      ]),
    ],
    ["xl/styles.xml", STYLES],
    ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, worksheet(sheet.rows)] as [string, string]),
  ];
  return zip(files.map(([name, text]) => [name, Buffer.from(text, "utf8")]));
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

function contentTypes(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return (
    XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets +
    "</Types>"
  );
}

function relationships(items: (readonly [string, string, string])[]): string {
  return (
    XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`).join("") +
    "</Relationships>"
  );
}

function workbook(sheets: Sheet[]): string {
  return (
    XML_HEADER +
    `<workbook xmlns="${MAIN_NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
    sheets
      .map((sheet, index) => `<sheet name="${escape(sheetName(sheet.name))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
      .join("") +
    "</sheets></workbook>"
  );
}

// 第 0 個格式是一般文字，第 1 個是表頭的粗體。
const STYLES =
  XML_HEADER +
  `<styleSheet xmlns="${MAIN_NS}">` +
  '<fonts count="2"><font><sz val="12"/><name val="Calibri"/></font><font><b/><sz val="12"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  "</styleSheet>";

function worksheet(rows: string[][]): string {
  const freeze =
    rows.length > 0
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : "";
  const body = rows
    .map(
      (row, r) =>
        `<row r="${r + 1}">` +
        row
          .map(
            (value, c) =>
              `<c r="${columnName(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}>` +
              `<is><t xml:space="preserve">${escape(value)}</t></is></c>`,
          )
          .join("") +
        "</row>",
    )
    .join("");
  return XML_HEADER + `<worksheet xmlns="${MAIN_NS}">${freeze}<sheetData>${body}</sheetData></worksheet>`;
}

/** 第 0 欄是 A、第 25 欄是 Z、第 26 欄是 AA。 */
function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// XML 不允許的控制字元拿掉，其他特殊符號跳脫。Excel 把文字裡的 _xHHHH_ 當成跳脫的字元，
// 原本就是這幾個字的話，開頭的底線要寫成 _x005F_ 才會原樣顯示；CR 寫成 &#13;，XML 才不會把它換成 LF。
function escape(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r/g, "&#13;");
}

// Excel 的工作表名稱最多 31 個字，不能有 \ / ? * [ ] :。
function sheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
}

/** 把檔案壓成一個 zip（壓縮方式 deflate）。檔名都是英文，時間固定為 1980-01-01。 */
function zip(files: [string, Buffer][]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const fileName = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解開需要的版本
    local.writeUInt16LE(0x0800, 6); // 檔名是 UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // 時間
    local.writeUInt16LE(0x21, 12); // 日期 1980-01-01
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, fileName, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}
