import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushColorwayToShopify } from "@/lib/master/push-shopify";
import { pushColorwaysToLoom } from "@/lib/loom/push";
import { applySitooUpdate, planSitooUpdate, SitooUpdateError } from "@/lib/sitoo/update";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// POST /api/catalog/push/fanout  { colorwayIds[], dryRun? }
//
// Send a change to every channel the product is ALREADY on.
//
// The question "which channel am I pushing to?" has no answer for a product that
// lives on several: four of the five Tarvas shoes are on Shopify, Sitoo and Loom
// at once, and their price is one number that all three read. Making someone
// choose a channel per push is asking them to do the fan-out by hand, three
// times, and to remember the third.
//
// IT NEVER CREATES. The targets come from ChannelPublication and the Sitoo
// links, so a product reaches exactly the systems that already hold it. That is
// also what keeps this safe: `shopifyRefusing` applies the full readiness gate to
// a create and only variants/price to an update, and nothing here is ever a
// create. A product not yet on Shopify is not quietly published by a price edit —
// putting it there for the first time stays a deliberate act, in Publishing,
// where the gate and the preview are.
//
// Order is Shopify, then Sitoo, then Loom — push-orchestrator's, for its reason:
// Loom's stock registry joins on Shopify's InventoryItem gid and Sitoo's SKU, so
// it goes last, when both are known.

interface ChannelReport {
  channel: "Shopify" | "Sitoo" | "Loom";
  /** Always COLORWAYS, for every channel, so the three numbers compare. */
  attempted: number;
  ok: number;
  issues: string[];
  /** Anything the colorway count cannot say — Sitoo's per-size row tally. */
  detail?: string;
}

export async function POST(req: Request) {
  let body: { colorwayIds?: string[]; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = body.colorwayIds ?? [];
  if (!ids.length)
    return NextResponse.json({ error: "Pass colorwayIds" }, { status: 400 });

  const cws = await prisma.colorway.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      brand: { select: { isLivid: true } },
      publications: { select: { channel: true, externalId: true } },
      entries: { select: { season: { select: { code: true } } } },
      variants: {
        select: { channelRefs: { where: { channel: "SITOO" }, select: { id: true } } },
      },
    },
  });

  const nameOf = new Map(cws.map((c) => [c.id, c.colorwaySku]));

  // Shopify: only where a product GID exists. A publication row without one is
  // a target that was never pushed, and this route does not create.
  const toShopify = cws.filter((c) =>
    c.publications.some((p) => p.channel === "SHOPIFY" && p.externalId)
  );
  // Sitoo: the variant link is the proof the till holds it; the publication row
  // alone is an intention.
  const toSitoo = cws.filter((c) => c.variants.some((v) => v.channelRefs.length));
  const toLoom = cws.filter((c) => c.publications.some((p) => p.channel === "LOOM"));

  const seasonOf = (c: (typeof cws)[number]) => c.entries[0]?.season.code;
  const noSeason = cws.filter((c) => !seasonOf(c)).map((c) => c.colorwaySku);
  const noChannel = cws
    .filter(
      (c) => !toShopify.includes(c) && !toSitoo.includes(c) && !toLoom.includes(c)
    )
    .map((c) => c.colorwaySku);

  if (body.dryRun) {
    let sitooChanges = 0;
    let untouchedSizes: Array<{ colorwaySku: string; inMaster: number; inSitoo: number }> = [];
    if (toSitoo.length) {
      const plan = await planSitooUpdate(toSitoo.map((c) => c.id));
      sitooChanges = plan.rows.filter((r) => r.changes).length;
      untouchedSizes = plan.untouchedSizes;
    }
    return NextResponse.json({
      ok: true,
      dryRun: true,
      products: cws.length,
      shopify: toShopify.length,
      sitoo: toSitoo.length,
      sitooChanges,
      loom: toLoom.length,
      noChannel,
      noSeason,
      // A price can land on every size the master knows and still leave most of
      // a product wrong at the till. Said before the push, not after.
      untouchedSizes,
    });
  }

  const reports: ChannelReport[] = [];

  // --- Shopify, one product at a time (productSet is per product) ---
  const shopify: ChannelReport = {
    channel: "Shopify",
    attempted: toShopify.length,
    ok: 0,
    issues: [],
  };
  for (const c of toShopify) {
    try {
      await pushColorwayToShopify(c.id, seasonOf(c));
      shopify.ok++;
    } catch (err) {
      shopify.issues.push(
        `${c.colorwaySku} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  if (shopify.attempted) reports.push(shopify);

  // --- Sitoo: title and price on products the till already sells ---
  if (toSitoo.length) {
    const sitoo: ChannelReport = {
      channel: "Sitoo",
      attempted: toSitoo.length,
      ok: 0,
      issues: [],
    };
    try {
      const r = await applySitooUpdate(toSitoo.map((c) => c.id));
      // COLORWAYS, to match Shopify and Loom beside it. Sitoo gives every size
      // its own product row, so counting rows here read "Sitoo 4/1" — four of
      // one — on a push that had gone perfectly. The row tally is still worth
      // seeing; it goes in the detail line rather than the score.
      sitoo.ok = r.colorwaysOk;
      if (r.updated || r.unchanged)
        sitoo.detail = `${r.updated} row(s) written, ${r.unchanged} already matched`;
      sitoo.issues.push(...r.failed.map((f) => `${f.variantSku} — ${f.error}`));
      if (r.missing.length)
        sitoo.issues.push(`${r.missing.length} linked here but absent from Sitoo`);
    } catch (err) {
      sitoo.issues.push(
        err instanceof SitooUpdateError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
    reports.push(sitoo);
  }

  // --- Loom last, grouped by season AND by job ---
  //
  // A delivery carries one shape or the other, never a mix: "full" is the
  // wholesale catalogue (Livid only), "data" the stock registry (everything that
  // moves). And a Loom push is per-season, so the grouping is both.
  if (toLoom.length) {
    const loom: ChannelReport = {
      channel: "Loom",
      attempted: toLoom.length,
      ok: 0,
      issues: [],
    };
    const groups = new Map<string, { season: string; mode: "full" | "data"; ids: string[] }>();
    for (const c of toLoom) {
      const season = seasonOf(c);
      if (!season) {
        loom.issues.push(`${c.colorwaySku} — in no season, so there is no price to send`);
        continue;
      }
      const mode: "full" | "data" = c.brand?.isLivid ? "full" : "data";
      const key = `${season}|${mode}`;
      const g = groups.get(key) ?? { season, mode, ids: [] };
      g.ids.push(c.id);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      try {
        const r = await pushColorwaysToLoom(g.ids, g.season, { mode: g.mode });
        loom.ok += r.sent ?? 0;
        for (const s of r.skipped)
          loom.issues.push(`${nameOf.get(s.colorwayId) ?? s.colorwayId} — ${s.reason}`);
        if (!r.ok && !r.skipped.length)
          loom.issues.push(`${g.season}/${g.mode} — ${r.raw ?? "Loom did not confirm"}`);
      } catch (err) {
        loom.issues.push(
          `${g.season}/${g.mode} — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    reports.push(loom);
  }

  return NextResponse.json({
    ok: reports.every((r) => r.issues.length === 0),
    products: cws.length,
    reports,
    noChannel,
  });
}
