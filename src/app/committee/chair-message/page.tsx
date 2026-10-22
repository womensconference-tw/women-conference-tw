import type { Metadata } from "next";
import { CommitteePageContent } from "../committee-pages";
import { loadCommittee } from "../committee-site";

export const metadata: Metadata = { title: "主席的話" };

export default async function CommitteeChairMessagePage({ searchParams }: PageProps<"/committee/chair-message">) {
  return <CommitteePageContent page="chairMessage" {...await loadCommittee(searchParams)} />;
}
