import { UUID_PATTERN } from "@/lib/registration";
import { createClient } from "@/lib/supabase/server";
import { exportYearExcel, yearExcelFileName, type YearExportError } from "@/lib/year-export";

const STATUS: Record<YearExportError, number> = {
  not_admin: 403,
  not_found: 404,
  conference_not_ended: 409,
  personal_data_cleared: 409,
  unavailable: 500,
};

/**
 * 下載年度 Excel（#26）。用 POST，別的網站放的連結或圖片沒辦法替總管理員下載、多記一筆匯出紀錄。
 * 是不是總管理員、大會結束了沒、清除了沒，由資料庫判斷；失敗時回傳錯誤代碼，畫面換成說明。
 * 回應的標頭 X-Export-Id 是這次的匯出紀錄編號。
 */
export async function POST(_request: Request, ctx: RouteContext<"/staff/years/[conferenceId]/excel">) {
  const { conferenceId } = await ctx.params;
  if (!UUID_PATTERN.test(conferenceId)) return Response.json({ error: "not_found" }, { status: 404 });
  const supabase = await createClient();
  const { data: year } = await supabase.from("conferences").select("year").eq("id", conferenceId).maybeSingle();
  if (!year) return Response.json({ error: "not_found" }, { status: 404 });

  const result = await exportYearExcel(supabase, conferenceId);
  if (!result.ok) return Response.json({ error: result.error }, { status: STATUS[result.error] });

  const fileName = yearExcelFileName(year.year);
  return new Response(new Blob([result.bytes as Uint8Array<ArrayBuffer>]), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${year.year}.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
      "X-Export-Id": result.exportId,
    },
  });
}
