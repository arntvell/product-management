import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDraft, DraftNotFoundError } from "@/lib/master/drafts";
import { listBrands, listSeasons, listManufacturers } from "@/lib/master/queries";
import { listSizeSystems } from "@/lib/master/size-systems";
import { prisma } from "@/lib/db";
import { ProductWizard } from "@/components/catalog/product-wizard/product-wizard";

export const dynamic = "force-dynamic";

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let draft;
  try {
    draft = await getDraft(id);
  } catch (err) {
    if (err instanceof DraftNotFoundError) notFound();
    throw err;
  }
  if (draft.status === "COMPLETED") redirect(`/catalog/products/drafts/${id}/done`);
  if (draft.status === "DISCARDED") redirect("/catalog/products/drafts");

  const [brandRows, seasons, sizeSystems, manufacturers] = await Promise.all([
    prisma.brand.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, isLivid: true, skuToken: true },
    }),
    listSeasons(),
    listSizeSystems(),
    listManufacturers(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{draft.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            External brands only — Livid product arrives through the Threadflow feed.
          </p>
        </div>
        <Link
          href="/catalog/products/drafts"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          All drafts
        </Link>
      </div>

      {draft.status === "FINALIZING" ? (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          This draft was interrupted while being created. Pressing create again will finish
          it — the ids were reserved before the write, so nothing can be created twice.
        </div>
      ) : null}

      <ProductWizard
        draftId={draft.id}
        initialPayload={draft.payload}
        initialRevision={draft.revision}
        initialStep={draft.step}
        options={{ brands: brandRows, seasons, sizeSystems, manufacturers }}
      />
    </main>
  );
}
