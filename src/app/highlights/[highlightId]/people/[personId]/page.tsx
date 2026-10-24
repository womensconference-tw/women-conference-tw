import { PersonPage } from "@/app/person-page";

export default async function PublicPersonPage({ params }: PageProps<"/highlights/[highlightId]/people/[personId]">) {
  const { highlightId, personId } = await params;
  return <PersonPage highlightId={highlightId} personId={personId} preview={false} />;
}
