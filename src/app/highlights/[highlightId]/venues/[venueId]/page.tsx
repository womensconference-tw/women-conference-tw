import { VenuePage } from "@/app/venue-page";

export default async function PublicVenuePage({ params }: PageProps<"/highlights/[highlightId]/venues/[venueId]">) {
  const { highlightId, venueId } = await params;
  return <VenuePage highlightId={highlightId} venueId={venueId} preview={false} />;
}
