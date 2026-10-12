import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { pushColorwayToShopify } from "@/lib/master/push-shopify";
import { planShopifyUpdate } from "@/lib/master/shopify-update";
import { describeLoomFollowUp, sendChannelIdsToLoom } from "@/lib/master/loom-follow-up";
import { applySitooUpdate, planSitooUpdate, SitooUpdateError } from "@/lib/sitoo/update";
import { createPushBatch, getPushBatch, runPushBatch } from "@/lib/master/push-orchestrator";
import { pushColorwaysToLoom } from "@/lib/loom/push";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/colorways/[id]/push-to  { channel: "SHOPIFY"|"SITOO"|"LOOM", dryRun? }
//
// One product, one channel, from the product page — by the same paths the grid
// and the wizard use, so a push here is not an older, thinner push:
//
//   Shopify  pushColorwayToShopify: a create (and onto the sales channels), or
//            an update that sends only what changed since the baseline. Then
//            Loom hears the Shopify ids, as the grid push does.
//   Sitoo    already in the till → the title/price update (sitoo/update.ts);
//            not yet → the create, through a push batch (api-creator).
//   Loom     the stock registry for external brands, the catalogue for Livid —
//            the fanout's own rule.
//
// dryRun answers "what would this send" and writes nothing.
type Channel = "SHOPIFY" | "SITOO" | "LOOM";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { channel?: Channel; dryRun?: boolean };
  const channel = body.channel;
  if (channel !== "SHOPIFY" && channel !== "SITOO" && channel !== "LOOM")
    return NextResponse.json({ error: "channel must be SHOPIFY, SITOO or LOOM" }, { status: 400 });
  const dryRun = body.dryRun === true;

  const cw = await prisma.colorway.findUnique({
    where: { id },
    select: {
      colorwaySku: true,
      brand: { select: { isLivid: true } },
      entries: { select: { season: { select: { code: true } } } },
      publications: { select: { channel: true, externalId: true } },
      variants: { select: { channelRefs: { where: { channel: "SITOO" }, select: { id: true } } } },
    },
  });
  if (!cw) return NextResponse.json({ error: "Product not found" }, { status: 404 });
  // The same season rule as the fanout: the product's first season.
  const season = cw.entries[0]?.season.code;

  try {
    if (channel === "SHOPIFY") {
      const gid = cw.publications.find((p) => p.channel === "SHOPIFY")?.externalId;
      if (dryRun) {
        if (!gid)
          return NextResponse.json({
            dryRun: true,
            summary: "Creates the product in Shopify and puts it on the store's sales channels.",
            send: [],
          });
        const plan = await planShopifyUpdate(id, season);
        const send = plan.changes.filter((c) => c.action === "write").map((c) => (c.note ? `${c.label} (${c.note})` : c.label));
        return NextResponse.json({
          dryRun: true,
          summary: send.length ? `Updates ${send.length} field(s) on the live product.` : "Nothing has changed since the last push.",
          send,
          notSent: plan.changes.filter((c) => c.action === "not-sent").map((c) => `${c.label}: ${c.note}`),
          warnings: plan.warnings,
        });
      }
      const result = await pushColorwayToShopify(id, season);
      const warnings = [...result.warnings];
      if (result.variantRefs?.inventoryLinked) {
        const loom = await sendChannelIdsToLoom([id], { preferSeason: season });
        const note = describeLoomFollowUp(loom);
        if (note) warnings.push(note);
      }
      return NextResponse.json({
        ok: true,
        summary: result.action === "create" ? "Created in Shopify." : "Shopify updated.",
        adminUrl: result.adminUrl,
        warnings,
      });
    }

    if (channel === "SITOO") {
      const linked = cw.variants.length > 0 && cw.variants.every((v) => v.channelRefs.length > 0);
      if (linked) {
        if (dryRun) {
          const plan = await planSitooUpdate([id]);
          const changing = plan.rows.filter((r) => r.changes);
          const send = [
            ...new Set(
              changing.flatMap((r) => [
                ...(r.titleFrom !== r.titleTo ? [`Title → ${r.titleTo}`] : []),
                ...(r.priceTo != null && r.priceFrom !== r.priceTo ? [`Price ${r.priceFrom ?? "–"} → ${r.priceTo}`] : []),
              ])
            ),
          ];
          const extra = plan.untouchedSizes.find((u) => u.colorwaySku === cw.colorwaySku);
          return NextResponse.json({
            dryRun: true,
            summary: send.length ? `Updates ${changing.length} size row(s) in the till.` : "The till already matches.",
            send,
            warnings: extra ? [`Sitoo sells ${extra.inSitoo} sizes, Origo holds ${extra.inMaster}; the others keep their price.`] : [],
          });
        }
        const r = await applySitooUpdate([id]);
        return NextResponse.json({
          ok: r.failed.length === 0,
          summary: `${r.updated} row(s) written, ${r.unchanged} already matched.`,
          warnings: r.failed.map((f) => `${f.variantSku}: ${f.error}`),
        });
      }
      // Not in the till yet: the create, through the orchestrator's Sitoo step.
      if (dryRun)
        return NextResponse.json({
          dryRun: true,
          summary: `Creates the product in Sitoo with its ${cw.variants.length} size(s).`,
          send: [],
        });
      const batch = await createPushBatch({ colorwayIds: [id], channels: ["SITOO"], seasonCode: season, kind: "product-page" });
      if (batch.blocked.length)
        return NextResponse.json({ ok: false, summary: "Not sent.", warnings: batch.blocked.map((b) => b.reason) });
      const progress = await runPushBatch(batch.batchId, { only: ["SITOO"] });
      const detail = await getPushBatch(batch.batchId);
      const item = detail?.items.find((i) => i.channel === "SITOO");
      return NextResponse.json({
        ok: item?.state === "OK",
        summary: item?.state === "OK" ? "Created in Sitoo." : `Sitoo: ${item?.state ?? progress.status}`,
        warnings: item?.error ? [item.error] : [],
      });
    }

    // LOOM — once per season the product is in, as Loom keeps a row per season.
    const seasons = [...new Set(cw.entries.map((e) => e.season.code))];
    if (!seasons.length)
      return NextResponse.json({ ok: false, summary: "Not sent.", warnings: ["The product is in no season, so Loom has no price to take."] });
    const mode: "full" | "data" = cw.brand?.isLivid ? "full" : "data";
    const where = mode === "full" ? "wholesale catalogue" : "stock registry";
    if (dryRun)
      return NextResponse.json({
        dryRun: true,
        summary: `Sends the product to Loom's ${where} for ${seasons.join(", ")}.`,
        send: [],
        warnings: ["Loom takes the whole product every time — there is no field-by-field preview."],
      });
    const notes: string[] = [];
    let sent = 0;
    for (const s of seasons) {
      const res = await pushColorwaysToLoom([id], s, { mode });
      if (res.ok && (res as { sent?: number }).sent) sent++;
      for (const k of (res as { skipped?: { reason: string }[] }).skipped ?? []) notes.push(`${s}: ${k.reason}`);
      if (!res.ok) notes.push(`${s}: Loom did not accept the delivery`);
    }
    return NextResponse.json({
      ok: sent > 0 && !notes.length,
      summary: sent ? `Sent to Loom's ${where} (${sent} of ${seasons.length} season(s)).` : "Not sent to Loom.",
      warnings: notes,
    });
  } catch (err) {
    const message =
      err instanceof SitooUpdateError ? err.message : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
