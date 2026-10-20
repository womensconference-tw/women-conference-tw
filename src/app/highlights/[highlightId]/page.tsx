import { HighlightPage } from "@/app/highlight-page";

export default async function PublicHighlightPage({ params }: PageProps<"/highlights/[highlightId]">) {
  const { highlightId } = await params;
  return <HighlightPage id={highlightId} preview={false} />;
}
