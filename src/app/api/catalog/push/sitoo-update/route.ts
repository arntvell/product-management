import { NextResponse } from "next/server";
import {
  applySitooUpdate,
  planSitooUpdate,
  SitooUpdateError,
} from "@/lib/sitoo/update";
import type { SitooTarget } from "@/lib/sitoo/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/catalog/push/sitoo-update  { colorwayIds[], dryRun?, target? }
//
// Bring the till up to date with the master: title and retail price, on products
// Sitoo already has.
//
// Separate from /api/catalog/push/sitoo, which runs the CREATOR. That one
// refuses a colorway whose SKUs all exist, which is right for a creator and left
// a rename or a reprice with nowhere to go.
//
// The dry run is GETs only and answers for any account, so looking before
// leaping never needs write permission first — the same reasoning as
// api-creator's plan().
export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; dryRun?: boolean; target?: SitooTarget };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = body.colorwayIds ?? [];
  if (!ids.length)
    return NextResponse.json({ error: "Pass colorwayIds" }, { status: 400 });

  try {
    if (body.dryRun) {
      const plan = await planSitooUpdate(ids, { target: body.target });
      const changing = plan.rows.filter((r) => r.changes);
      return NextResponse.json({
        ok: true,
        dryRun: true,
        target: plan.target,
        inSitoo: plan.rows.length,
        wouldUpdate: changing.length,
        unchanged: plan.rows.length - changing.length,
        missing: plan.missing,
        withoutPrice: plan.withoutPrice,
        // Sizes the till sells that the master does not hold. They keep their
        // current price whatever this push does.
        untouchedSizes: plan.untouchedSizes,
        accountProductCount: plan.accountProductCount,
        // Every change spelled out. The 11 drifted names in store vintage —
        // "Levi's Blue" against Sitoo's "Levis Blue", "Missoni Knitwear" against
        // "Designer Knitwear" — are only visible here, and they are decisions
        // rather than corrections.
        changes: changing.map((r) => ({
          variantSku: r.variantSku,
          productId: r.productId,
          shape: r.shape,
          title: r.titleFrom === r.titleTo ? null : { from: r.titleFrom, to: r.titleTo },
          price: r.priceFrom === r.priceTo ? null : { from: r.priceFrom, to: r.priceTo },
        })),
      });
    }

    const result = await applySitooUpdate(ids, { target: body.target });
    return NextResponse.json({ ok: result.failed.length === 0, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sitoo update failed";
    return NextResponse.json(
      { error: message },
      { status: err instanceof SitooUpdateError ? 409 : 500 }
    );
  }
}
