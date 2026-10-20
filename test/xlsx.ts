import { crc32, inflateRawSync } from "node:zlib";

/**
 * 讀回 src/lib/xlsx.ts 產生的 Excel 檔：每個工作表的名稱與每一格的文字（依列、欄）。
 * 照 zip 的中央目錄找檔案、檢查 CRC，再從工作表的 XML 取出文字，順便確認格子的位置沒有跳號。
 */
export function readXlsx(bytes: Uint8Array): { files: Map<string, string>; sheets: { name: string; rows: string[][] }[] } {
  const buffer = Buffer.from(bytes);
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("不是 zip 檔");
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) throw new Error("中央目錄壞了");
    const method = buffer.readUInt16LE(pointer + 10);
    const checksum = buffer.readUInt32LE(pointer + 16);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    pointer += 46 + nameLength + extraLength + commentLength;

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`${name} 的檔頭壞了`);
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    if (crc32(data) !== checksum) throw new Error(`${name} 的 CRC 不對`);
    files.set(name, data.toString("utf8"));
  }

  const workbook = files.get("xl/workbook.xml") ?? "";
  const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((match) => unescape(match[1]));
  const sheets = names.map((name, index) => ({ name, rows: rowsOf(files.get(`xl/worksheets/sheet${index + 1}.xml`) ?? "") }));
  return { files, sheets };
}

function rowsOf(xml: string): string[][] {
  return [...xml.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)].map((row, r) => {
    if (Number(row[1]) !== r + 1) throw new Error(`第 ${r + 1} 列的位置是 ${row[1]}`);
    return [...row[2].matchAll(/<c r="([A-Z]+)(\d+)"[^>]*><is><t[^>]*>([\s\S]*?)<\/t><\/is><\/c>/g)].map((cell, c) => {
      if (cell[2] !== row[1]) throw new Error(`${cell[1]}${cell[2]} 不在第 ${row[1]} 列`);
      if (columnIndex(cell[1]) !== c) throw new Error(`${cell[1]}${cell[2]} 不是第 ${c + 1} 欄`);
      return unescape(cell[3]);
    });
  });
}

function columnIndex(name: string): number {
  return [...name].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

// 照 Excel 讀檔的方式：先解開 XML 的跳脫（含 &#13;），再解開 _xHHHH_。
function unescape(text: string): string {
  return text
    .replace(/&#13;/g, "\r")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}
