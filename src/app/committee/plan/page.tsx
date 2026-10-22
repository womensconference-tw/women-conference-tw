import type { Metadata } from "next";
import { CommitteePageContent } from "../committee-pages";
import { loadCommittee } from "../committee-site";

export const metadata: Metadata = { title: "執行計畫" };

export default async function CommitteePlanPage({ searchParams }: PageProps<"/committee/plan">) {
  return <CommitteePageContent page="plan" {...await loadCommittee(searchParams)} />;
}
