import { writeCsv } from "@/lib/csv";
import { exportStaffCsv, isStaffExportKind, staffExportFileName, TEXT_COLUMNS } from "@/lib/staff-export";
import { createClient } from "@/lib/supabase/server";

/**
 * 下載 CSV（#20）：?kind=badges|roster|full_roster|stake_summary&year=2026。
 * 誰能下載哪一種、範圍內有哪些報名，由 exportStaffCsv 與資料庫的權限規則判斷；失敗時回傳錯誤代碼，畫面換成說明。
 * 不記匯出紀錄、不改資料，所以用 GET；別的網站放的連結頂多讓工作人員自己的瀏覽器多下載一份。
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const year = Number(params.get("year"));
  if (!isStaffExportKind(kind) || !Number.isInteger(year)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const result = await exportStaffCsv(await createClient(), kind, year);
  if (!result.ok) return Response.json({ error: result.error }, { status: result.error === "not_allowed" ? 403 : 404 });

  const fileName = staffExportFileName(kind, year);
  return new Response(new Blob([writeCsv(result.rows, TEXT_COLUMNS) as Uint8Array<ArrayBuffer>]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${year}-${kind}.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}
