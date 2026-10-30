// Stock as Loom reports it: per variant, per location — the central warehouse
// (Livid Sentrallager, from Pio) and every store (from Sitoo). This is the one
// place stock is whole. Shopify only knows what is listed online, so a product
// that is not on Shopify yet can still be in the warehouse and the stores.
import { loomGet } from "./client";

interface LoomStockLine {
  location: string;
  /** "pio" for the warehouse, "sitoo" for the stores. */
  source: string;
  available: number | null;
  on_hand: number | null;
  reserved: number | null;
}

interface LoomProductRow {
  colorway_id: string;
  colorway_sku: string;
  variants: { variant_sku: string; stock?: LoomStockLine[] }[];
}

interface LoomProductsPage {
  rows: LoomProductRow[];
  nextCursor: string | null;
}

export interface LoomStock {
  /** On hand across every location. */
  total: number;
  warehouse: number;
  stores: number;
  /** Locations holding any, largest first. */
  byLocation: { location: string; onHand: number }[];
}

function summarise(row: LoomProductRow): LoomStock {
  const by = new Map<string, number>();
  let warehouse = 0;
  let stores = 0;
  for (const v of row.variants) {
    for (const s of v.stock ?? []) {
      // On hand, not available: a reserved garment is still in the building,
      // and the question here is whether there is one to photograph.
      const n = Math.max(s.on_hand ?? 0, 0);
      if (!n) continue;
      by.set(s.location, (by.get(s.location) ?? 0) + n);
      if (s.source === "pio") warehouse += n;
      else stores += n;
    }
  }
  return {
    total: warehouse + stores,
    warehouse,
    stores,
    byLocation: [...by].map(([location, onHand]) => ({ location, onHand })).sort((a, b) => b.onHand - a.onHand),
  };
}

/**
 * Stock for a season's colourways, keyed by Origo colorway id. Loom's season
 * filter does most of it in two pages; a colourway it leaves out (Loom has it
 * under another season) is looked up by SKU. Absent from the map = not in Loom.
 */
export async function loomStockFor(
  seasonCode: string,
  colorways: { id: string; sku: string }[]
): Promise<Map<string, LoomStock>> {
  const rows: LoomProductRow[] = [];
  let cursor: string | null = null;
  do {
    const page: LoomProductsPage = await loomGet<LoomProductsPage>("products", {
      season: seasonCode,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);

  const byId = new Map(rows.map((r) => [r.colorway_id, r]));
  const bySku = new Map(rows.map((r) => [r.colorway_sku.toUpperCase(), r]));
  const out = new Map<string, LoomStock>();
  const missing: { id: string; sku: string }[] = [];
  for (const c of colorways) {
    const row = byId.get(c.id) ?? bySku.get(c.sku.toUpperCase());
    if (row) out.set(c.id, summarise(row));
    else missing.push(c);
  }
  await Promise.all(
    missing.map(async (c) => {
      const page = await loomGet<LoomProductsPage>("products", { sku: c.sku });
      const row = page.rows.find((r) => r.colorway_sku.toUpperCase() === c.sku.toUpperCase());
      if (row) out.set(c.id, summarise(row));
    })
  );
  return out;
}
