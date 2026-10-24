import { redirect } from "next/navigation";
import { getCurrentStaff } from "@/app/staff/current-staff";
import { VenuePage } from "@/app/venue-page";

/**
 * 後台預覽的各教堂頁：預覽介紹頁的教堂按鈕連過來，公告上線前也看得到。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。
 */
export default async function PreviewVenuePage({ params }: PageProps<"/preview/highlights/[highlightId]/venues/[venueId]">) {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  const { highlightId, venueId } = await params;
  return <VenuePage highlightId={highlightId} venueId={venueId} preview />;
}
