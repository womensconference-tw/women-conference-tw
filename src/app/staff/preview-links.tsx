import Link from "next/link";

/** 首頁內容、場地與課程頁面上的預覽連結：另開分頁，公告上線、報名開放前也能先看看前台的樣子。 */
export function PreviewLinks() {
  return (
    <p className="flex flex-wrap gap-x-6 gap-y-2">
      <Link href="/preview" target="_blank" className="font-semibold underline">
        預覽首頁
      </Link>
      <Link href="/preview/register" target="_blank" className="font-semibold underline">
        預覽報名表
      </Link>
    </p>
  );
}
