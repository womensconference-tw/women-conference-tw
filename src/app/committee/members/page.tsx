import type { Metadata } from "next";
import { CommitteePageContent } from "../committee-pages";
import { loadCommittee } from "../committee-site";

export const metadata: Metadata = { title: "籌備委員" };

export default async function CommitteeMembersPage({ searchParams }: PageProps<"/committee/members">) {
  return <CommitteePageContent page="members" {...await loadCommittee(searchParams)} />;
}
