import { redirect } from "next/navigation";
import { getCurrentStaff } from "../staff/current-staff";
import { LandingPage } from "../landing-page";

/**
 * 後台的預覽報名首頁：照前台報名入口頁的樣子顯示目前年度，公告上線前也看得到；報名按鈕連到預覽報名表。
 * proxy 已經擋下沒登入的人；這裡再確認是工作人員。前台不受影響。
 */
export default async function PreviewHomePage() {
  if (!(await getCurrentStaff())) redirect("/staff/login");
  return <LandingPage preview />;
}
