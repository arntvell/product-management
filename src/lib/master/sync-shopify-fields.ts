// Reading merchandising data back from Shopify into the master.
//
// The master is meant to be the one place a product is described, but for the
// products that predate it the shop is the richer record: all five Tarvas shoes
// are live on Shopify and hold no description, no image, no swatch and no care
// page in Origio. That asymmetry is why the readiness gate had to be narrowed
// for updates — a master thinner than the shop cannot be the authority yet.
//
// This closes the gap in the only direction that can close it. It is the inverse
// of `publish.ts`: every key it reads is a key the push writes, so the two agree
// about what `custom.short_description` means.
//
// NOT import-shopify.ts. That one CREATES products the master does not have and
// skips everything it already holds, which is why Tarvas has sat there empty —
// the product exists here, so the importer passes over it. This fills in what
// existing products are missing.
//
// NON-DESTRUCTIVE, in two layers:
//
//   A field is written only where the master is EMPTY. Shopify is the fallback
//   for what nobody has typed here, never a correction of what somebody has.
//
//   A MANUAL-owned field is never touched at all, even when empty. A blank that
//   someone deliberately cleared is a decision.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { lockedFields } from "@/lib/master/provenance";
import type { Prisma } from "@/generated/prisma/client";

const FIELDS_QUERY = `
  query ProductFields($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        status
        metafields(first: 30, namespace: "${METAFIELD_NAMESPACE}") {
          nodes { key value }
        }
      }
    }
  }
`;

/** Metafield key -> the Colorway column it fills. The inverse of publish.ts. */
const TEXT_MAP: Record<string, keyof Prisma.ColorwayUpdateInput> = {
  short_description: "shortDescription",
  full_description: "fullDescription",
  details: "details",
  style_tagline: "styleTagline",
  style_name: "styleName",
  color_hex: "swatchHex",
  care_page: "carePageId",
  fitguide: "fitguidePageId",
  recommended_product_from_collection: "recommendedCollectionId",
  model_info: "modelInfoId",
};

/**
 * Product-reference lists. Shopify holds product GIDs; the master holds its own
 * colorway ids, so these need the publication table read backwards. A GID with
 * no colorway behind it is dropped rather than guessed at.
 */
const LIST_MAP: Record<string, keyof Prisma.ColorwayUpdateInput> = {
  same_product: "sameProduct",
  style_with: "styleWith",
  style_with_unisex_herre: "styleWithUnisexHerre",
  style_with_unisex_dame: "styleWithUnisexDame",
};

export interface FieldSyncReport {
  checked: number;
  /** Colorways that gained at least one value. */
  filled: number;
  /** How many values, by field. */
  byField: Record<string, number>;
  skippedManual: Record<string, number>;
  goneFromShopify: string[];
  sample: Array<{ colorwaySku: string; fields: string[] }>;
  /**
   * Exactly what was written, per colorway, so a caller holding the rows in
   * memory can bring them up to date without re-reading everything.
   *
   * The grid is the caller that needs this: it keeps rows in `useState`, which
   * by design ignores later props, so a server re-render leaves the screen
   * showing the values from before the sync. Returning the writes lets it merge
   * them the same way it merges a save.
   */
  applied: Array<{ colorwayId: string; data: Record<string, unknown> }>;
}

export async function syncShopifyFields(
  opts: { apply?: boolean; colorwayIds?: string[] } = {}
): Promise<FieldSyncReport> {
  const rows = await prisma.colorway.findMany({
    where: {
      ...(opts.colorwayIds?.length ? { id: { in: opts.colorwayIds } } : {}),
      publications: { some: { channel: "SHOPIFY", externalId: { not: null } } },
    },
    select: {
      id: true,
      colorwaySku: true,
      shortDescription: true,
      fullDescription: true,
      details: true,
      styleTagline: true,
      styleName: true,
      swatchHex: true,
      carePageId: true,
      fitguidePageId: true,
      recommendedCollectionId: true,
      modelInfoId: true,
      sameProduct: true,
      styleWith: true,
      styleWithUnisexHerre: true,
      styleWithUnisexDame: true,
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
    },
  });

  const byGid = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const gid = r.publications[0]?.externalId;
    if (gid) byGid.set(gid, r);
  }
  // Shopify product GID -> master colorway id, for the reference lists.
  const colorwayIdByGid = new Map([...byGid].map(([gid, r]) => [gid, r.id]));

  const locked = await lockedFields("colorway", [...byGid.values()].map((r) => r.id));

  const byField: Record<string, number> = {};
  const skippedManual: Record<string, number> = {};
  const goneFromShopify: string[] = [];
  const sample: FieldSyncReport["sample"] = [];
  const writes: Array<{ id: string; data: Prisma.ColorwayUpdateInput }> = [];

  const gids = [...byGid.keys()];
  for (let i = 0; i < gids.length; i += 100) {
    const chunk = gids.slice(i, i + 100);
    const d = await shopifyGraphQL<{
      nodes: ({ id: string; metafields: { nodes: { key: string; value: string }[] } } | null)[];
    }>(FIELDS_QUERY, { ids: chunk });

    for (let j = 0; j < chunk.length; j++) {
      const node = d.nodes[j];
      const cw = byGid.get(chunk[j])!;
      if (!node) {
        goneFromShopify.push(cw.colorwaySku);
        continue;
      }
      const mf = new Map(node.metafields.nodes.map((m) => [m.key, m.value]));
      const data: Prisma.ColorwayUpdateInput = {};
      const gained: string[] = [];

      for (const [key, column] of Object.entries(TEXT_MAP)) {
        const value = mf.get(key)?.trim();
        if (!value) continue;
        const current = cw[column as keyof typeof cw];
        if (typeof current === "string" && current.trim()) continue; // master wins
        if (locked.get(cw.id)?.has(column as string)) {
          skippedManual[column as string] = (skippedManual[column as string] ?? 0) + 1;
          continue;
        }
        (data as Record<string, unknown>)[column as string] = value;
        gained.push(column as string);
        byField[column as string] = (byField[column as string] ?? 0) + 1;
      }

      for (const [key, column] of Object.entries(LIST_MAP)) {
        const raw = mf.get(key);
        if (!raw) continue;
        const current = cw[column as keyof typeof cw];
        if (Array.isArray(current) && current.length) continue;
        if (locked.get(cw.id)?.has(column as string)) {
          skippedManual[column as string] = (skippedManual[column as string] ?? 0) + 1;
          continue;
        }
        let gidList: string[] = [];
        try {
          gidList = JSON.parse(raw);
        } catch {
          continue;
        }
        // A GID the master has no colorway for is dropped: a reference to a
        // product that is not in here cannot be stored as one that is.
        const ids = gidList
          .map((g) => colorwayIdByGid.get(g))
          .filter((x): x is string => !!x);
        if (!ids.length) continue;
        (data as Record<string, unknown>)[column as string] = ids;
        gained.push(column as string);
        byField[column as string] = (byField[column as string] ?? 0) + 1;
      }

      if (gained.length) {
        writes.push({ id: cw.id, data });
        if (sample.length < 15) sample.push({ colorwaySku: cw.colorwaySku, fields: gained });
      }
    }
  }

  if (opts.apply) {
    // Sequential in chunks rather than one transaction: thousands of distinct
    // updates would blow the 5s transaction budget, and each row is independent.
    for (let i = 0; i < writes.length; i += 25) {
      await Promise.all(
        writes
          .slice(i, i + 25)
          .map((w) => prisma.colorway.update({ where: { id: w.id }, data: w.data }))
      );
    }
  }

  return {
    checked: gids.length,
    filled: writes.length,
    byField,
    skippedManual,
    goneFromShopify,
    sample,
    // Only what actually landed. On a dry run nothing did.
    applied: opts.apply
      ? writes.map((w) => ({
          colorwayId: w.id,
          data: w.data as Record<string, unknown>,
        }))
      : [],
  };
}
