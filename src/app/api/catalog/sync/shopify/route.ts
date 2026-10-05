import { NextResponse } from "next/server";
import { syncShopifyStatus } from "@/lib/master/sync-shopify-status";
import { syncShopifyFields } from "@/lib/master/sync-shopify-fields";
import { linkShopifyProducts } from "@/lib/master/link-shopify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/catalog/sync/shopify  { apply?, colorwayIds?, parts? }
//
// One refresh, both halves: what Shopify says a product's STATUS is, and the
// merchandising METAFIELDS it holds that the master never had.
//
// Together because they are one question — "what does the shop know that we do
// not?" — and because running them separately means two trips through 2,645
// products and two chances to do one and forget the other.
//
// Without `apply` nothing is written. That is not a courtesy: the status half
// alone would move 2,295 rows, and a bulk write to the master should be read
// first.
export async function POST(req: Request) {
  let body: {
    apply?: boolean;
    colorwayIds?: string[];
    parts?: Array<"link" | "status" | "fields">;
  } = {};
  try {
    body = await req.json();
  } catch {
    // Empty body = dry run over everything, which is the common case.
  }

  // "link" runs FIRST and is not in the default set.
  //
  // It sweeps every product in Shopify to match unlinked colorways by variant
  // SKU, which is a different and heavier operation than reading back the ones
  // already linked — and it writes a publication row, which is identity. It is
  // asked for, not assumed.
  const parts = body.parts ?? ["status", "fields"];
  const apply = body.apply === true;

  try {
    const out: Record<string, unknown> = { ok: true, applied: apply };

    if (parts.includes("link")) {
      const r = await linkShopifyProducts({ apply, colorwayIds: body.colorwayIds });
      out.link = {
        unlinked: r.unlinked,
        shopifyProducts: r.shopifyProducts,
        wouldLink: r.matched.length,
        linked: r.linked,
        ambiguous: r.ambiguous.length,
        byShopifyStatus: r.matched.reduce<Record<string, number>>((acc, m) => {
          acc[m.shopifyStatus] = (acc[m.shopifyStatus] ?? 0) + 1;
          return acc;
        }, {}),
        sample: r.matched.slice(0, 10),
      };
    }

    if (parts.includes("status")) {
      const r = await syncShopifyStatus({ apply, colorwayIds: body.colorwayIds });
      out.status = {
        checked: r.checked,
        agree: r.agree,
        wouldChange: r.changes.length,
        byTransition: r.changes.reduce<Record<string, number>>((acc, c) => {
          const k = `${c.from} → ${c.to}`;
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
        skippedManual: r.skippedManual.length,
        goneFromShopify: r.goneFromShopify.length,
        sample: r.changes.slice(0, 10),
        // What landed, so a caller holding rows in memory can merge rather than
        // re-read. Empty on a dry run.
        applied: apply
          ? r.changes.map((c) => ({ colorwayId: c.colorwayId, status: c.to }))
          : [],
      };
    }

    if (parts.includes("fields")) {
      const r = await syncShopifyFields({ apply, colorwayIds: body.colorwayIds });
      out.fields = {
        checked: r.checked,
        wouldFill: r.filled,
        byField: r.byField,
        skippedManual: r.skippedManual,
        goneFromShopify: r.goneFromShopify.length,
        sample: r.sample,
        applied: r.applied,
      };
    }

    return NextResponse.json(out);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
