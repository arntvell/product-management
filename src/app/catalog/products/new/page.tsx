import Link from "next/link";

export const dynamic = "force-dynamic";

// Two ways in, and the choice is about VOLUME, not about which is the real one.
// Both land in the same place: a ProductDraft, reviewed and finalized through
// preflightDraft/finalizeDraft. The importer is not a second creation path —
// it fills in the same drafts the wizard does, which is what keeps the SKU
// collision checks, the barcode ledger and the resume-after-crash claim
// identical for a product typed and a product imported.
export default function NewProductPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/catalog/products/drafts"
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        ← Drafts
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">New product</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        External brands only — Livid product arrives through the Threadflow feed.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Choice
          href="/catalog/products/new/wizard"
          title="Build one by hand"
          lead="One style, its colourways, step by step."
          body="Searches as you type, so an existing style is reused rather than duplicated. Best for a handful of products."
          cta="Start the wizard"
        />
        <Choice
          href="/catalog/products/import"
          title="Import a file"
          lead="A whole delivery in one spreadsheet."
          body="Pick the brand, season, type and size system, download a template with those filled in, and paste the rows. Sizes are a dropdown, so nothing arrives that no size system knows about."
          cta="Start an import"
        />
      </div>
    </main>
  );
}

function Choice({
  href,
  title,
  lead,
  body,
  cta,
}: {
  href: string;
  title: string;
  lead: string;
  body: string;
  cta: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-lg border p-5 transition-colors hover:bg-muted/50"
    >
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm">{lead}</p>
      <p className="mt-2 flex-1 text-xs text-muted-foreground">{body}</p>
      <span className="mt-4 text-sm font-medium underline underline-offset-4 group-hover:no-underline">
        {cta} →
      </span>
    </Link>
  );
}
