import { NextResponse } from "next/server";
import { syncChannelMembership } from "@/lib/master/channel-membership";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/catalog/channels/reconcile   { channel?: "SHOPIFY"|"SITOO", dryRun? }
//
// Turns link evidence into declared channel membership: every colorway whose
// variants are matched to a product in the channel gets a ChannelPublication row
// if it does not have one.
//
// This exists because the two halves of the fact were maintained by different
// code. The Shopify linker writes its own publication rows, so Shopify has
// always agreed with itself — 2 406 linked, 2 406 declared, none linked without
// a row. The Sitoo linker never did, so 2 265 colorways were matched to Sitoo
// products with ZERO publication rows between them, and the Loom feed reported
// every one of those store-carried garments as absent from Sitoo.
//
// Additive only, and idempotent: a second run reports `created: 0`. It never
// withdraws a product from a channel — see channel-membership.ts for why that
// direction has to be a person's decision. `declaredWithoutLink` is the list
// that needs one.
export async function POST(req: Request) {
  let body: { channel?: "SHOPIFY" | "SITOO"; dryRun?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body — reconcile both channels, live
  }
  const channels: Array<"SHOPIFY" | "SITOO"> = body.channel
    ? [body.channel]
    : ["SHOPIFY", "SITOO"];

  try {
    const results: Record<string, unknown> = {};
    for (const channel of channels) {
      const r = await syncChannelMembership(channel, { dryRun: body.dryRun });
      results[channel] = {
        ...r,
        // The ids are the point of the dry run, but all 2 265 of them in a toast
        // is not a report anyone reads.
        declaredWithoutLink: r.declaredWithoutLink.length,
        declaredWithoutLinkSample: r.declaredWithoutLink.slice(0, 25),
      };
    }
    return NextResponse.json({ ok: true, dryRun: Boolean(body.dryRun), results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Reconcile failed" },
      { status: 500 }
    );
  }
}
