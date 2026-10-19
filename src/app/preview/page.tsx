import { redirect } from "next/navigation";
import { getCurrentStaff } from "../staff/current-staff";
import { HomePage } from "../home-page";

/**
 * 後台的預覽首頁：照前台首頁的樣子顯示目前年度的內容，公告上線前也看得到。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。前台首頁不受影響。
 */
export default async function PreviewHomePage() {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  return <HomePage preview />;
}
