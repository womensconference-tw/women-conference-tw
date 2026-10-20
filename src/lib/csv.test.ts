import { describe, expect, it } from "vitest";
import { writeCsv } from "./csv";

// TextDecoder 會吃掉開頭的 BOM，下面比對的是 BOM 之後的文字。
describe("CSV 檔", () => {
  it("開頭有 UTF-8 BOM，Excel 開啟中文不會變亂碼；每列用 CRLF 分隔", () => {
    const bytes = writeCsv([
      ["姓名", "場地"],
      ["王小美", "台北金華教堂"],
    ]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(bytes.slice(3))).toBe("姓名,場地\r\n王小美,台北金華教堂\r\n");
  });

  it("有逗號、引號、換行的格子加上引號，引號重複一次", () => {
    const text = new TextDecoder().decode(writeCsv([["a,b", '說"好"', "第一行\n第二行", "  前後空白  "]]));
    expect(text).toBe('"a,b","說""好""","第一行\n第二行",  前後空白  \r\n');
  });

  it("開頭是 = + - @ 的格子前面加 '，Excel 不會當成公式執行", () => {
    const text = new TextDecoder().decode(writeCsv([["=1+1", "+886912345678", "-2", "@SUM(A1)", "王=小美"]]));
    expect(text).toBe("'=1+1,'+886912345678,'-2,'@SUM(A1),王=小美\r\n");
  });

  it("文字欄只有數字的格子寫成 =\"…\"，Excel 不會去掉開頭的 0 或在 + 前面顯示 '", () => {
    const rows = [
      ["姓名", "電話"],
      ["王小美", "0912345678"],
      ["王小華", "+886912345678"],
      ["0912", "=1+1"],
    ];
    const text = new TextDecoder().decode(writeCsv(rows, ["電話", "沒有這一欄"]));
    expect(text).toBe(
      '姓名,電話\r\n王小美,"=""0912345678"""\r\n王小華,"=""+886912345678"""\r\n0912,\'=1+1\r\n',
    );
  });
});
