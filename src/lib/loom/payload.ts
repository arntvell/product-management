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
    // CORE is a first-class trait in the master — the permanent production
    // line — but it only ever reached Loom by accident, when a product happened
    // to carry a CORE tag. Send it as a field, and also fold it into tags so it
    // is visible through a field Loom already consumes rather than waiting on a
    // contract change. Derived here; the master's own tags are untouched.
    core: cw.isCore,
    tags:
      cw.isCore && !cw.tags.some((t) => /^core$/i.test(t.trim()))
        ? [...cw.tags, "CORE"]
        : cw.tags,
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

export interface LoomPayload {
  season: string;
  /** Always "full" — this feed sends a complete season, never a delta. */
  mode: "full";
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
    colorways: ReturnType<typeof buildColorway>[];
  }>;
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
  eventId?: string
): LoomPayload {
  // Group colorways under their style.
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
      colorways: cws.map((cw) => buildColorway(cw, archive)),
    };
  });

  return {
    season: seasonCode,
    mode: "full",
    // Derived from the delivery's contents when not supplied, so the same set
    // of products retried produces the same id.
    event_id: eventId ?? deliveryId(seasonCode, colorways, archive),
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
