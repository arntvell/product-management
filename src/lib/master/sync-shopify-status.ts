// Reading product status back from Shopify.
//
// Origio's `Colorway.status` was never populated for products that already
// existed in Shopify: measured 2026-10-05, 2,288 of the 2,645 products Origio
// holds a Shopify GID for are ACTIVE in the shop and DRAFT here, and 7 are
// ARCHIVED there and DRAFT here. 87% disagreement — the column is a default, not
// a fact, and anyone reading the grid is being misled about what is for sale.
//
// Shopify is the authority for this one field, and the push already says so:
// when the shop says ACTIVE and the master says otherwise, the push keeps the
// live status and warns "change status in Shopify directly to unpublish"
// (push-shopify.ts). A master that cannot set a value is not its owner, so
// reading it back is the honest direction of travel.
//
// Matched on the Shopify product GID rather than by SKU or barcode. The GID is
// the identity Origio already recorded at push time, so this needs no fuzzy
// matching and cannot pair the wrong two products — unlike enrich-shopify.ts,
// which sweeps the whole catalogue to find products Origio has no link to.

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { lockedFields } from "@/lib/master/provenance";

const STATUS_QUERY = `
  query ProductStatuses($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id status }
    }
  }
`;

type ProductStatus = "ACTIVE" | "DRAFT" | "ARCHIVED";

export interface StatusChange {
  colorwayId: string;
  colorwaySku: string;
  from: ProductStatus;
  to: ProductStatus;
}

export interface StatusSyncReport {
  checked: number;
  agree: number;
  changes: StatusChange[];
  /** Held in Origio but the GID resolves to nothing — deleted in Shopify. */
  goneFromShopify: string[];
  /** Status is MANUAL-owned here, so somebody chose it; never overwritten. */
  skippedManual: string[];
}

/**
 * Compare, and optionally write. `apply: false` is a pure read and touches
 * nothing — the whole report is available before anything changes.
 */
export async function syncShopifyStatus(
  opts: { apply?: boolean; colorwayIds?: string[] } = {}
): Promise<StatusSyncReport> {
  const rows = await prisma.colorway.findMany({
    where: {
      ...(opts.colorwayIds?.length ? { id: { in: opts.colorwayIds } } : {}),
      publications: { some: { channel: "SHOPIFY", externalId: { not: null } } },
    },
    select: {
      id: true,
      colorwaySku: true,
      status: true,
      publications: {
        where: { channel: "SHOPIFY" },
        select: { externalId: true },
      },
    },
  });

  const byGid = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const gid = r.publications[0]?.externalId;
    if (gid) byGid.set(gid, r);
  }

  const changes: StatusChange[] = [];
  const goneFromShopify: string[] = [];
  let agree = 0;

  const gids = [...byGid.keys()];
  // 200 at a time: `nodes` takes up to 250 and the response carries two fields,
  // so this is 14 calls for the whole catalogue rather than 2,645.
  for (let i = 0; i < gids.length; i += 200) {
    const chunk = gids.slice(i, i + 200);
    const d = await shopifyGraphQL<{ nodes: ({ id: string; status: ProductStatus } | null)[] }>(
      STATUS_QUERY,
      { ids: chunk }
    );
    for (let j = 0; j < chunk.length; j++) {
      const node = d.nodes[j];
      const cw = byGid.get(chunk[j])!;
      if (!node) {
        goneFromShopify.push(cw.colorwaySku);
        continue;
      }
      if (node.status === cw.status) {
        agree++;
        continue;
      }
      changes.push({
        colorwayId: cw.id,
        colorwaySku: cw.colorwaySku,
        from: cw.status as ProductStatus,
        to: node.status,
      });
    }
  }

  // A MANUAL lock means a person chose this value here. Reading Shopify back is
  // a repair for a column nobody ever set, not a licence to overwrite a decision.
  const locked = await lockedFields(
    "colorway",
    changes.map((c) => c.colorwayId)
  );
  const skippedManual: string[] = [];
  const writable = changes.filter((c) => {
    if (locked.get(c.colorwayId)?.has("status")) {
      skippedManual.push(c.colorwaySku);
      return false;
    }
    return true;
  });

  if (opts.apply && writable.length) {
    // Grouped by target status so this is three statements, not 2,295.
    for (const status of ["ACTIVE", "DRAFT", "ARCHIVED"] as const) {
      const ids = writable.filter((c) => c.to === status).map((c) => c.colorwayId);
      if (!ids.length) continue;
      await prisma.colorway.updateMany({ where: { id: { in: ids } }, data: { status } });
    }
  }

  return {
    checked: gids.length,
    agree,
    changes: writable,
    goneFromShopify,
    skippedManual,
  };
}
