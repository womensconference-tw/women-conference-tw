import type { Metadata } from "next";
import { CommitteePageContent } from "../committee-pages";
import { loadCommittee } from "../committee-site";

export const metadata: Metadata = { title: "工作團隊" };

export default async function CommitteeTeamPage({ searchParams }: PageProps<"/committee/team">) {
  return <CommitteePageContent page="team" {...await loadCommittee(searchParams)} />;
}
