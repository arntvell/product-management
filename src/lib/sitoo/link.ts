// Linking Origio variants to the Sitoo products that already represent them.
//
// The first push must never create. Sitoo holds 14,714 products and Origio will
// hold roughly 10,000 after the backfill; they are overwhelmingly the same
// garments under the same SKUs. Creating rather than matching would double the
// POS catalogue, which is the sort of mistake that is discovered at a till.

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { barcodeKey } from "@/lib/master/barcode";
import { normalizeSku } from "@/lib/master/sku";
import { listProducts, resolveTarget, type SitooProduct, type SitooTarget } from "./client";
import { syncChannelMembership } from "@/lib/master/channel-membership";

export interface LinkResult {
  linked: number;
  alreadyLinked: number;
  bySku: number;
  byBarcode: number;
  unmatchedVariants: number;
  unmatchedSitoo: number;
  ambiguous: Array<{ variantSku: string; productIds: number[] }>;
  /** Links where the channel calls the garment something else. */
  aliases: Array<{ variantSku: string; externalSku: string }>;
  /**
   * Links whose product id no longer resolves to this garment, re-pointed.
   *
   * Sitoo product ids are not stable. When 13 Barnes Japan Dawn variants were
   * lost and recreated on 2026-09-12 they came back under new ids, leaving every
   * link pointing at a dead one. A linker that treats "already linked" as "done"
   * cannot repair that, so it checks the id still resolves.
   */
  repointed: Array<{ variantSku: string; from: string; to: string }>;
  /**
   * SKUs of Sitoo products nothing accounts for, capped.
   *
   * The count alone cannot tell "genuinely POS-only" from "ours, under a name the
   * linker could not match" — and the difference decides whether a colorway can
   * be declared absent from Sitoo. A garment whose Sitoo SKU is a renamed
   * spelling and whose Origio variant has no barcode matches on neither key, and
   * would go out as `sitoo: false`, suppressing stock errors for something on a
   * shelf.
   */
  unmatchedSitooSkus: string[];
  /** Which Sitoo these numbers describe. Sandbox and production are not alike. */
  target?: SitooTarget;
  /**
   * ChannelPublication(SITOO) brought into line with the links above.
   *
   * Sitoo membership was knowable from 8 089 VariantChannelRef rows and declared
   * nowhere, so the Loom feed could not say whether a missing Shopify link was a
   * gap or a store-only product.
   */
  membership?: import("@/lib/master/channel-membership").MembershipSyncResult;
}

export interface LinkOptions {
  dryRun?: boolean;
  /** Supply products instead of fetching — used by tests and the snapshot path. */
  products?: SitooProduct[];
  /** Which Sitoo to read. Defaults to SITOO_TARGET, else production. */
  target?: SitooTarget;
  /**
   * Permit writing production links from a SANDBOX read. Almost never right.
   *
   * SITOO_TARGET=sandbox in a dev environment and the two Sitoos do not share
   * product ids, so a sandbox read looks to this linker exactly like production
   * having lost and recreated its whole catalogue: on 2026-09-18 a dry run
   * against 565 sandbox products reported 93 links to RE-POINT and 14 704
   * variants as unmatched, against a database holding 8 089 good production
   * links. Run live, that would have aimed 93 production garments at sandbox ids
   * and the damage would have surfaced at a till.
   */
  allowSandboxWrites?: boolean;
}

export async function linkSitooProducts(opts: LinkOptions = {}): Promise<LinkResult> {
  const target = resolveTarget(opts.target);
  // A supplied catalogue is the caller's own — tests and the snapshot path — so
  // it carries no target to disagree about.
  if (!opts.products && target === "sandbox" && !opts.dryRun && !opts.allowSandboxWrites)
    throw new Error(
      "Refusing to write links from the Sitoo SANDBOX. The two Sitoos do not " +
        "share product ids, so a sandbox read re-points live links at ids that " +
        "do not exist in production. Pass target:\"production\", or " +
        "allowSandboxWrites if you really mean the sandbox."
    );
  const products = opts.products ?? (await listProducts(target));

  const variants = await prisma.variant.findMany({
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      channelRefs: {
        where: { channel: "SITOO" },
        select: { id: true, externalId: true, externalSku: true },
      },
    },
  });

  const byProductId = new Map<number, SitooProduct>(products.map((p) => [p.productid, p]));
  const bySitooSku = new Map<string, SitooProduct[]>();
  const bySitooBarcode = new Map<string, SitooProduct[]>();
  for (const p of products) {
    const sku = p.sku ? normalizeSku(p.sku) : null;
    if (sku) (bySitooSku.get(sku) ?? bySitooSku.set(sku, []).get(sku)!).push(p);
    const bc = barcodeKey(p.barcode);
    if (bc) (bySitooBarcode.get(bc) ?? bySitooBarcode.set(bc, []).get(bc)!).push(p);
  }

  const result: LinkResult = {
    linked: 0,
    alreadyLinked: 0,
    bySku: 0,
    byBarcode: 0,
    unmatchedVariants: 0,
    unmatchedSitoo: 0,
    ambiguous: [],
    aliases: [],
    repointed: [],
    unmatchedSitooSkus: [],
  };
  const writes: Array<{ variantId: string; externalId: string; externalSku: string | null }> = [];
  const aliasUpdates: Array<{ refId: string; externalSku: string | null }> = [];
  const repoint: Array<{ refId: string; externalId: string }> = [];
  const matchedProductIds = new Set<number>();

  for (const v of variants) {
    if (v.channelRefs.length) {
      const ref = v.channelRefs[0];
      const current = byProductId.get(Number(ref.externalId));
      const stillOurs =
        current && normalizeSku(current.sku ?? "") === normalizeSku(v.variantSku);

      if (stillOurs) matchedProductIds.add(Number(ref.externalId));
      if (!stillOurs) {
        // The id is dead or now addresses a different garment. Re-match by SKU
        // and re-point, rather than reporting it as linked and moving on.
        const again = bySitooSku.get(normalizeSku(v.variantSku)) ?? [];
        if (again.length === 1) {
          matchedProductIds.add(again[0].productid);
          repoint.push({ refId: ref.id, externalId: String(again[0].productid) });
          result.repointed.push({
            variantSku: v.variantSku,
            from: ref.externalId,
            to: String(again[0].productid),
          });
          continue;
        }
        if (again.length > 1) {
          result.ambiguous.push({
            variantSku: v.variantSku,
            productIds: again.map((h) => h.productid),
          });
          continue;
        }
        // Gone from Sitoo entirely — report rather than silently keep a dead id.
        result.unmatchedVariants++;
        continue;
      }

      result.alreadyLinked++;
      matchedProductIds.add(Number(ref.externalId));
      const theirs = current?.sku ?? null;
      const want =
        theirs && normalizeSku(theirs) !== normalizeSku(v.variantSku) ? theirs : null;
      if (want !== ref.externalSku) aliasUpdates.push({ refId: ref.id, externalSku: want });
      if (want) result.aliases.push({ variantSku: v.variantSku, externalSku: want });
      continue;
    }
    // SKU first: it is the identifier both systems were built around, and
    // Origio's barcode coverage is thinner than Sitoo's.
    let hits = bySitooSku.get(normalizeSku(v.variantSku)) ?? [];
    let how: "sku" | "barcode" = "sku";
    if (!hits.length) {
      const bc = barcodeKey(v.barcode);
      if (bc) {
        hits = bySitooBarcode.get(bc) ?? [];
        how = "barcode";
      }
    }
    if (!hits.length) {
      result.unmatchedVariants++;
      continue;
    }
    if (hits.length > 1) {
      result.ambiguous.push({ variantSku: v.variantSku, productIds: hits.map((h) => h.productid) });
      continue;
    }
    matchedProductIds.add(hits[0].productid);
    // Record the channel's own spelling when it differs — an alias, not a
    // second identity. Thrown away before, which is why cross-system SKU drift
    // was only ever visible in a reconciliation script.
    const theirSku = hits[0].sku ?? null;
    const alias =
      theirSku && normalizeSku(theirSku) !== normalizeSku(v.variantSku) ? theirSku : null;
    if (alias) result.aliases.push({ variantSku: v.variantSku, externalSku: alias });
    writes.push({ variantId: v.id, externalId: String(hits[0].productid), externalSku: alias });
    if (how === "sku") result.bySku++;
    else result.byBarcode++;
  }

  result.target = target;
  // Sitoo products no Origio variant accounts for — the POS-only catalogue.
  //
  // This counted only the products matched FRESH in this run, so every one of
  // the 8 015 already-linked garments read as unmatched and the figure came back
  // as 14 713 of 14 714 — "we have almost nothing", when the truth is the
  // opposite. A number that is only correct on the very first run is worse than
  // no number: this is the figure that answers whether Sitoo holds products
  // Origio has never seen, and the first honest reading of it decides how much
  // of the POS catalogue is outside the master's control.
  const unmatched = products.filter((p) => !matchedProductIds.has(p.productid));
  result.unmatchedSitoo = unmatched.length;
  result.unmatchedSitooSkus = unmatched.map((p) => p.sku ?? "").filter(Boolean);
  result.linked = writes.length;

  if (!opts.dryRun && writes.length) {
    await prisma.variantChannelRef.createMany({
      data: writes.map((w) => ({ ...w, channel: "SITOO" as const })),
      skipDuplicates: true,
    });
  }
  if (!opts.dryRun && aliasUpdates.length) {
    await applyAliasUpdates(aliasUpdates);
  }
  if (!opts.dryRun && repoint.length) {
    for (let i = 0; i < repoint.length; i += 500) {
      const vals = repoint
        .slice(i, i + 500)
        .map((r) => Prisma.sql`(${r.refId}, ${r.externalId})`);
      await prisma.$executeRaw`
        UPDATE "VariantChannelRef" r
        SET "externalId" = v.eid
        FROM (VALUES ${Prisma.join(vals)}) AS v(id, eid)
        WHERE r.id = v.id
      `;
    }
  }
  // A link is the evidence; the publication row is the declaration Loom reads.
  // Recording it here rather than in a one-off backfill is what stops the two
  // drifting: every future linker run re-declares whatever it newly matched, so
  // a garment added to Sitoo tomorrow announces itself to Loom without anyone
  // remembering to. Additive only — see channel-membership.ts.
  result.membership = await syncChannelMembership("SITOO", { dryRun: opts.dryRun });

  return result;
}

/**
 * One UPDATE ... FROM (VALUES …) per chunk rather than a round trip per row.
 * The per-row form inside a $transaction overran the 5 s budget twice already.
 */
export async function applyAliasUpdates(
  updates: Array<{ refId: string; externalSku: string | null }>
): Promise<void> {
  for (let i = 0; i < updates.length; i += 500) {
    const rows = updates
      .slice(i, i + 500)
      .map((u) => Prisma.sql`(${u.refId}, ${u.externalSku})`);
    await prisma.$executeRaw`
      UPDATE "VariantChannelRef" r
      SET "externalSku" = v.sku
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, sku)
      WHERE r.id = v.id
    `;
  }
}
