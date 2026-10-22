import type { Metadata } from "next";
import { CommitteePageContent } from "../committee-pages";
import { loadCommittee } from "../committee-site";

export const metadata: Metadata = { title: "會議記錄" };

export default async function CommitteeMeetingsPage({ searchParams }: PageProps<"/committee/meetings">) {
  return <CommitteePageContent page="meetings" {...await loadCommittee(searchParams)} />;
}
