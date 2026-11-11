import { getFlatBoard, flatCandidates } from "@/lib/master/flats";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { FlatsBoard } from "@/components/catalog/flats-board";
import { PageHeader, Page } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function FlatsPage() {
  const user = await getSessionUser();
  const canQueue = can(user.role, "catalog");
  const [board, candidates] = await Promise.all([getFlatBoard(), canQueue ? flatCandidates() : Promise.resolve([])]);
  return (
    <>
      <PageHeader eyebrow="Catalogue" title="Flats" />
      <Page>
        <p className="max-w-3xl text-body text-muted-foreground">
          Products that need a flat-lay. Upload the flat on its row: it becomes the product&apos;s flat in Origo and on
          Shopify straight away, and the row moves to Done. Stock shows where the garment is.
        </p>
        <FlatsBoard open={board.open} done={board.done} canQueue={canQueue} candidates={candidates} />
      </Page>
    </>
  );
}
