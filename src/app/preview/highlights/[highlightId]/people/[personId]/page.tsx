import { redirect } from "next/navigation";
import { PersonPage } from "@/app/person-page";
import { getCurrentStaff } from "@/app/staff/current-staff";

/**
 * 後台預覽的個人介紹頁：預覽介紹頁的卡片連過來，公告上線前也看得到。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。
 */
export default async function PreviewPersonPage({ params }: PageProps<"/preview/highlights/[highlightId]/people/[personId]">) {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  const { highlightId, personId } = await params;
  return <PersonPage highlightId={highlightId} personId={personId} preview />;
}
