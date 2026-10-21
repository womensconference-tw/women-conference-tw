/*
 * 產生 CSV 檔（#20）：開頭加 UTF-8 BOM，Excel 直接開啟時才認得是 UTF-8，中文不會變亂碼。
 * 每列用 CRLF 分隔；有逗號、引號、換行的格子加上引號。
 */

const BOM = "\ufeff";

/**
 * rows 的第一列是表頭。textColumns 是要當成文字的欄名（例如電話）：Excel 會把只有數字的格子當成數字，
 * 去掉開頭的 0；這些欄只有數字（可有開頭的 +）的格子改寫成 ="0912345678"，Excel 照原樣顯示。
 */
export function writeCsv(rows: string[][], textColumns: string[] = []): Uint8Array {
  const text = new Set(textColumns.map((name) => rows[0]?.indexOf(name)).filter((index) => index !== -1));
  const lines = rows.map(
    (row, rowIndex) =>
      row
        .map((value, index) =>
          rowIndex > 0 && text.has(index) && /^\+?\d+$/.test(value) ? quote(`="${value}"`) : cell(value),
        )
        .join(",") + "\r\n",
  );
  return new TextEncoder().encode(BOM + lines.join(""));
}

function cell(value: string): string {
  // 開頭是 = + - @ 時 Excel 會當成公式執行（姓名、課程名稱是別人填的），前面加 ' 當成文字。
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? quote(text) : text;
}

function quote(text: string): string {
  return `"${text.replace(/"/g, '""')}"`;
}
