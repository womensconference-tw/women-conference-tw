import { redirect } from "next/navigation";
import { HighlightPage } from "@/app/highlight-page";
import { getCurrentStaff } from "@/app/staff/current-staff";

/**
 * 後台預覽的大會特色介紹頁：預覽首頁的卡片連過來，公告上線前也看得到。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。
 */
export default async function PreviewHighlightPage({ params }: PageProps<"/preview/highlights/[highlightId]">) {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  const { highlightId } = await params;
  return <HighlightPage id={highlightId} preview />;
}
