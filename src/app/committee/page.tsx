import type { Metadata } from "next";
import { CommitteePageContent } from "./committee-pages";
import { loadCommittee } from "./committee-site";

export const metadata: Metadata = { title: "大會簡介" };

/** 公開頁面的首頁是大會簡介。 */
export default async function CommitteeIntroductionPage({ searchParams }: PageProps<"/committee">) {
  return <CommitteePageContent page="introduction" {...await loadCommittee(searchParams)} />;
}
