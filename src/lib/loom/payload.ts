// Build the Loom feed payload from master data, per handoff.md.
// Style -> Colorway -> Variant, with stable ids, per-season prices, the full
// customs block + manufacturer, channels, and per-season lifecycle flags.
import { prisma } from "@/lib/db";
import { loomMissing } from "@/lib/master/readiness";
import { loomCategoryFor } from "@/lib/master/loom-category";

export async function loadColorwaysForLoom(colorwayIds: string[], seasonCode: string) {
  return prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    include: {
      // The mapped category, at both levels — a colourway may override its
      // style's. Without these the 93 modelled categories are unreachable from
      // the feed and every product falls back to free-text guessing.
      categoryRef: true,
      style: { include: { categoryRef: true } },
      brand: true,
      manufacturer: true,
      variants: {
        orderBy: { sizeLabel: "asc" },
        // The registry joins on the channel's own stock object, so the variant's
        // channel refs have to come with it. Cheap: one extra join, and the
        // catalogue payload simply ignores them.
        include: { channelRefs: true },
      },
      prices: { where: { season: { code: seasonCode } } },
      seasonImages: { where: { slot: "MAIN", season: { code: seasonCode } } },
      entries: { where: { season: { code: seasonCode } } },
      publications: true,
    },
  });
}

export type LoomColorway = Awaited<ReturnType<typeof loadColorwaysForLoom>>[number];

function has(v: string | null | undefined): string | null {
  return v && v.trim() ? v : null;
}

/** Required fields missing for THIS colorway's Loom push (empty = ready). */
export function loomMissingForColorway(cw: LoomColorway): string[] {
  return loomMissing({
    hasVariants: cw.variants.length > 0,
    hasPrice: cw.prices.some((p) => p.priceType === "MSRP"),
    hsCode: has(cw.hsCodeOverride) ?? cw.style.hsCode,
    customsDescription: has(cw.customsDescriptionOverride) ?? cw.style.customsDescription,
    weightKg: cw.weightKgOverride ?? cw.style.weightKg,
    fiberComposition: has(cw.fiberCompositionOverride) ?? cw.style.fiberComposition,
    countryOfOrigin: cw.countryOfOrigin,
    hasManufacturer: !!cw.manufacturerId,
  });
}

/**
 * Registry payload — identity only.
 *
 * The stock registry needs to know *which garment* a movement refers to, and
 * nothing else. Sending the catalogue shape here would be wrong in two ways:
 * externals and vintage have no wholesale price and no customs block, so the
 * payload would be mostly nulls; and a registry that carries merchandising data
 * invites Loom to render products it must not sell — the wholesale catalogue
 * rule this mode deliberately bypasses.
 */
function buildRegistryColorway(cw: LoomColorway, archive?: Set<string>) {
  // Enriched on request: the registry now carries price, category and the
  // customs block alongside identity.
  //
  // The original note above argued against this — "a registry that carries
  // merchandising data invites Loom to render products it must not sell". That
  // concern is real and has NOT gone away; what changes is that `registry_only`
  // is still true and still the flag Loom is meant to gate rendering on. Until
  // Loom confirms it does, this remains the one thing here that depends on
  // another team, and it belongs on the WORK-DECK §A list next to A2.
  //
  // What has not changed: eligibility. Externals and vintage still do not enter
  // the wholesale catalogue — isLoomEligible is untouched.
  const customs = {
    hs_code: has(cw.hsCodeOverride) ?? cw.style.hsCode ?? null,
    customs_description:
      has(cw.customsDescriptionOverride) ?? cw.style.customsDescription ?? null,
    weight_kg: (cw.weightKgOverride ?? cw.style.weightKg)?.toString() ?? null,
    fiber_composition:
      has(cw.fiberCompositionOverride) ?? cw.style.fiberComposition ?? null,
    country_of_origin: cw.countryOfOrigin ?? null,
  };
  const prices: Record<string, { msrp?: number; ws?: number; cost?: number }> = {};
  for (const p of cw.prices) {
    const slot = (prices[p.currency] ??= {});
    if (p.priceType === "MSRP") slot.msrp = Number(p.amount);
    else if (p.priceType === "WHOLESALE") slot.ws = Number(p.amount);
    else if (p.priceType === "COST") slot.cost = Number(p.amount);
  }

  return {
    colorway_id: cw.id,
    colorway_sku: cw.colorwaySku,
    name: cw.name,
    brand: cw.brand?.name ?? null,
    color: cw.color ?? null,
    product_type: loomCategoryFor(cw.categoryRef ?? cw.style.categoryRef, cw.productType),
    ...customs,
    manufacturer_id: cw.manufacturer
      ? (cw.manufacturer.threadflowId ?? cw.manufacturer.id)
      : null,
    prices,
    // Registry rows are stock-bearing records, not catalogue listings. loom:false
    // still means withdraw, so the archive signal has to survive.
    //
    // `shopify` must report the product's REAL state, exactly as the catalogue
    // builder does. It was hardcoded false here, which is only true of a product
    // that happens not to be on Shopify — and a registry push is an upsert, so
    // for anything Loom already held it overwrote a correct flag with a wrong
    // one. The first live registry push sent shopify:false for 81 products that
    // do have a Shopify publication.
    channels: {
      loom: !archive?.has(cw.id),
      shopify: cw.publications.some((p) => p.channel === "SHOPIFY"),
    },
    registry_only: true,
    // Barcoded variants only. The gate used to be colorway-level — any blank size
    // held back the whole run — which cost LIV-BTH-JPN-BLCK-DSK all 22 of its
    // sizes for one gap, and EXT-NOV-GAT-BLK all 6 after we cleared a barcode
    // that turned out to belong to the white shoe. Fixing one row's identity must
    // not cost its siblings theirs. A variant with no barcode cannot reconcile a
    // scan, so it is omitted rather than sent empty.
    //
    // CONSUMABLE is the one exemption. The 67 STORAGE-* records — packaging,
    // hangtags, shop lighting, swatches, tools — are counted by hand on a shelf,
    // never scanned at a till, and not one of them carries a barcode. Applying
    // the rule to them drops their only variant, and Loom receives a product that
    // cannot hold stock at all — which defeats the point of sending them. They
    // are not merchandise, so no scan will ever need to reconcile against them.
    //
    // The exemption is keyed on the kind, so it reaches every CONSUMABLE — the
    // Fitguide, Non-inventory, Shopify and SAVED categories map there too
    // (NON_MERCH_CATEGORIES). That is deliberate: the same argument holds for
    // all of them. It is wider than "the STORAGE-* rows", which is what someone
    // reading only the paragraph above would assume.
    variants: cw.variants
      .filter((v) => (v.barcode && v.barcode.trim()) || cw.kind === "CONSUMABLE")
      .map((v) => {
      const shopify = v.channelRefs.find((r) => r.channel === "SHOPIFY");
      const sitoo = v.channelRefs.find((r) => r.channel === "SITOO");
      return {
        variant_id: v.id,
        // Loom derives `{colorway_sku}-{suffix}` when `sku` is absent and treats
        // the result as a RENAME. That derivation is a no-op today only because
        // every colorway_sku happens to be the variant SKU minus its last
        // segment; the moment a variant is re-parented it is not, and the
        // rename would rewrite the SKU Sitoo matches on. Send both spellings —
        // `sku` is the field Loom's feed reads, `variant_sku` is what we have
        // always sent, and they must never disagree.
        sku: v.variantSku,
        variant_sku: v.variantSku,
        barcode: v.barcode ?? null,
        dimensions: v.dim2 ? { waist: v.dim1, length: v.dim2 } : { size: v.dim1 },
        // Where the stock actually moves, per channel. Shopify's InventoryItem
        // is NOT its ProductVariant — the variant is the listing, the inventory
        // item is what a stock movement references, and Loom joins on the
        // latter. Null where we have no link; the registry falls back to
        // barcode, which is why barcode coverage gates what we send at all.
        shopify_inventory_item_id: shopify?.externalInventoryId ?? null,
        shopify_variant_id: shopify?.externalId ?? null,
        sitoo_product_id: sitoo?.externalId ?? null,
      };
      }),
  };
}

function buildColorway(cw: LoomColorway, archive?: Set<string>) {
  const entry = cw.entries[0];
  // Customs: colorway override falls back to the style.
  const customs = {
    hs_code: has(cw.hsCodeOverride) ?? cw.style.hsCode ?? null,
    customs_description: has(cw.customsDescriptionOverride) ?? cw.style.customsDescription ?? null,
    weight_kg: (cw.weightKgOverride ?? cw.style.weightKg)?.toString() ?? null,
    fiber_composition: has(cw.fiberCompositionOverride) ?? cw.style.fiberComposition ?? null,
    country_of_origin: cw.countryOfOrigin ?? null,
  };

  // Prices: { CUR: { msrp, ws } } for this season.
  const prices: Record<string, { msrp?: number; ws?: number }> = {};
  for (const p of cw.prices) {
    const cur = (prices[p.currency] ??= {});
    if (p.priceType === "MSRP") cur.msrp = Number(p.amount);
    if (p.priceType === "WHOLESALE") cur.ws = Number(p.amount);
  }

  const manufacturer = cw.manufacturer
    ? {
        // Loom keys manufacturers by the Threadflow id where present.
        manufacturer_id: cw.manufacturer.threadflowId ?? cw.manufacturer.id,
        name: cw.manufacturer.name,
        address: {
          line1: cw.manufacturer.addrLine1 ?? null,
          line2: cw.manufacturer.addrLine2 ?? null,
          zip: cw.manufacturer.zip ?? null,
          city: cw.manufacturer.city ?? null,
          country: cw.manufacturer.country ?? null,
        },
      }
    : null;

  return {
    colorway_id: cw.id,
    colorway_sku: cw.colorwaySku,
    name: cw.name,
    brand: cw.brand?.name ?? null,
    color: cw.color ?? null,
    swatch: { hex: cw.swatchHex ?? null },
    // Loom stores this per colorway PER SEASON, in product_season_entries, and
    // takes the season from the top of the feed. Our own isCore is a durable
    // product-level trait, so it is sent as the value for whichever season this
    // delivery carries.
    is_core: cw.isCore,
    tags: cw.tags,
    product_type: loomCategoryFor(cw.categoryRef ?? cw.style.categoryRef, cw.productType),
    image: cw.seasonImages[0]?.url ?? null,
    ...customs,
    manufacturer_id: manufacturer?.manufacturer_id ?? null,
    manufacturer,
    channels: {
      // Loom treats loom:false as ARCHIVE — it hides the product across
      // catalogue, order builder, curation and pricing. It is a withdrawal
      // signal, not "not published yet", so it must express intent: true for
      // anything we are deliberately putting on Loom, false only when we mean
      // to withdraw it. Deriving it from whether a publication row happened to
      // exist meant every product's FIRST push archived it on arrival.
      loom: !archive?.has(cw.id),
      shopify: cw.publications.some((p) => p.channel === "SHOPIFY"),
    },
    dropped: entry?.cancelled ?? false,
    approved_for_production: entry?.approvedForProduction ?? false,
    prices,
    variants: cw.variants.map((v) => ({
      variant_id: v.id,
      // See the note in buildRegistryColorway: `sku` is what Loom reads.
      sku: v.variantSku,
      variant_sku: v.variantSku,
      barcode: v.barcode ?? null,
      dimensions: v.dim2
        ? { waist: v.dim1, length: v.dim2 }
        : { size: v.dim1 },
    })),
  };
}

export type LoomMode = "full" | "data";

export interface LoomPayload {
  season: string;
  /**
   * "full" for a complete season delivery; "data" for a targeted update that
   * should not be read as the whole picture.
   */
  mode: LoomMode;
  /**
   * Stable id for THIS delivery. A retry after a connection failure carries the
   * same event_id, so Loom dedupes instead of applying the batch twice — which
   * matters because our first bulk push returned 200 and then failed, and the
   * natural response to that is to send it again.
   */
  event_id: string;
  /**
   * Opt in to Loom MOVING a variant to a different colorway.
   *
   * Loom's default is to refuse: the variant row is where stock, weighted
   * average cost and every order, PO and receipt line live, so a nesting bug
   * upstream would otherwise relocate all of it silently. Omitted entirely
   * unless asked for — Loom requires a strict boolean `true` and treats
   * anything else as off.
   */
  allow_variant_reparent?: true;
  styles: Array<{
    style_id: string;
    style_sku: string;
    style_name: string;
    gender: string | null;
    unisex: boolean;
    category: string;
    // A delivery carries one shape or the other, never a mix: "full" sends the
    // catalogue colorway, "data" sends the identity-only registry row.
    colorways: Array<
      ReturnType<typeof buildColorway> | ReturnType<typeof buildRegistryColorway>
    >;
  }>;
}

/**
 * Origio's season code -> the season name Loom knows.
 *
 * These are not the same vocabulary. Origio models carry-over product as a
 * season called CONTINUITY; Loom calls that shelf "Archive" and rejects the
 * delivery outright with `Unknown season "CONTINUITY"` — verified live on
 * 2026-09-13, HTTP 400, nothing transmitted.
 *
 * The distinction matters because `seasonCode` does double duty: it selects
 * which SeasonEntry, prices and images to read on OUR side, and it names the
 * season on THEIRS. Only the outbound half is translated — the selection still
 * uses Origio's own code, or nothing would be found.
 */
const LOOM_SEASON_NAMES: Record<string, string> = {
  // Loom's season IDENTIFIER, not its display name. The first registry push sent
  // the literal "Archive" and Loom answered 200 with a completed job — so an
  // accepted delivery is NOT evidence the season resolved to the one intended.
  // Confirmed 2026-09-13: the id is "archv".
  CONTINUITY: "archv",
};

export function loomSeasonName(seasonCode: string): string {
  return LOOM_SEASON_NAMES[seasonCode.toUpperCase()] ?? seasonCode;
}

/**
 * A stable id for a delivery: same season, same colorways, same withdrawals →
 * same id, so a retry dedupes rather than re-applying.
 */
function deliveryId(
  seasonCode: string,
  colorways: LoomColorway[],
  archive?: Set<string>
): string {
  const parts = [
    seasonCode,
    ...colorways.map((c) => `${c.id}:${archive?.has(c.id) ? "w" : "p"}`).sort(),
  ].join("|");
  // FNV-1a — enough to distinguish deliveries, and stable across processes.
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `origio-${seasonCode.toLowerCase()}-${h.toString(16).padStart(8, "0")}-${colorways.length}`;
}

/**
 * Group already-loaded colorways into the Loom payload shape.
 *
 * `archive` names colorways to withdraw from Loom — they are sent with
 * channels.loom = false, which archives them there while preserving orders,
 * purchase orders and receipts. Everything else is sent as published.
 */
export function buildLoomPayloadFromColorways(
  colorways: LoomColorway[],
  seasonCode: string,
  archive?: Set<string>,
  eventId?: string,
  mode: LoomMode = "full",
  /**
   * Appended to the DERIVED event id on a retry.
   *
   * A failed Loom job keeps its id on Loom's side, so an identical resend
   * returns the stale failure rather than running again. A retry after a
   * *network* failure must keep the derived id so Loom dedupes; a retry after a
   * *job* failure must change it. Hence a suffix rather than a fresh id.
   */
  eventIdSuffix?: string,
  /**
   * Ask Loom to re-parent variants whose colorway has changed. Only ever set
   * for a deliberate restructure; see `allow_variant_reparent` on LoomPayload.
   */
  allowVariantReparent?: boolean
): LoomPayload {
  // Group colorways under their style.
  const build = mode === "data" ? buildRegistryColorway : buildColorway;

  const byStyle = new Map<string, LoomColorway[]>();
  for (const cw of colorways) {
    const list = byStyle.get(cw.styleId) ?? [];
    list.push(cw);
    byStyle.set(cw.styleId, list);
  }

  const styles = [...byStyle.values()].map((cws) => {
    const s = cws[0].style;
    return {
      style_id: s.id,
      style_sku: s.styleSku,
      style_name: s.styleName,
      gender: s.gender,
      unisex: s.unisex,
      category: loomCategoryFor(s.categoryRef, s.category),
      colorways: cws.map((cw) => build(cw, archive)),
    };
  });

  return {
    season: loomSeasonName(seasonCode),
    mode,
    // Present only when true. Loom reads a strict boolean, so sending `false`
    // and sending nothing are the same thing to them — but omitting it keeps
    // the payload honest about what this delivery is asking for.
    ...(allowVariantReparent ? { allow_variant_reparent: true as const } : {}),
    // Derived from the delivery's contents when not supplied, so the same set
    // of products retried produces the same id. Keyed on the season Loom sees,
    // so the id and the delivery agree about what was sent.
    event_id:
      eventId ??
      deliveryId(loomSeasonName(seasonCode), colorways, archive) +
        (eventIdSuffix ? `-${eventIdSuffix}` : ""),
    styles,
  };
}

export async function buildLoomPayload(
  colorwayIds: string[],
  seasonCode: string
): Promise<LoomPayload> {
  const colorways = await loadColorwaysForLoom(colorwayIds, seasonCode);
  return buildLoomPayloadFromColorways(colorways, seasonCode);
}
