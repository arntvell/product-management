// Build the Loom feed payload from master data, per handoff.md.
// Style -> Colorway -> Variant, with stable ids, per-season prices, the full
// customs block + manufacturer, channels, and per-season lifecycle flags.
import { prisma } from "@/lib/db";
import { loomMissing } from "@/lib/master/readiness";
import { toLoomCategory } from "@/lib/master/loom-category";

export async function loadColorwaysForLoom(colorwayIds: string[], seasonCode: string) {
  return prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    include: {
      style: true,
      brand: true,
      manufacturer: true,
      variants: { orderBy: { sizeLabel: "asc" } },
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
  return {
    colorway_id: cw.id,
    colorway_sku: cw.colorwaySku,
    name: cw.name,
    brand: cw.brand?.name ?? null,
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
    variants: cw.variants.map((v) => ({
      variant_id: v.id,
      variant_sku: v.variantSku,
      barcode: v.barcode ?? null,
      dimensions: v.dim2 ? { waist: v.dim1, length: v.dim2 } : { size: v.dim1 },
    })),
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
    product_type: toLoomCategory(cw.productType),
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
  CONTINUITY: "Archive",
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
  mode: LoomMode = "full"
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
      category: toLoomCategory(s.category),
      colorways: cws.map((cw) => build(cw, archive)),
    };
  });

  return {
    season: loomSeasonName(seasonCode),
    mode,
    // Derived from the delivery's contents when not supplied, so the same set
    // of products retried produces the same id. Keyed on the season Loom sees,
    // so the id and the delivery agree about what was sent.
    event_id: eventId ?? deliveryId(loomSeasonName(seasonCode), colorways, archive),
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
