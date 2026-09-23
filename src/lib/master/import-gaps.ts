// Product the Cin7 backfill cannot reach.
//
// The backfill runs through cin7/import.ts, so it can only bring in what Cin7
// holds. That was a reasonable constraint while Cin7 was the master and is an
// arbitrary one now that it is being retired: a garment that exists in the POS
// and the webshop but never had a Cin7 record is just as real, and the import
// skips it in silence.
//
// This lists them, with whatever each surviving system knows, so they can be
// created from Sitoo or Shopify instead.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { storedForm } from "./barcode";
import { normalizeSku } from "./sku";

export interface GapRow {
  sku: string;
  name: string;
  brand: string | null;
  productType: string | null;
  barcode: string | null;
  priceNok: string | null;
  /** Which systems hold it. Cin7 never does, by definition. */
  inSitoo: boolean;
  inShopify: boolean;
  inPio: boolean;
  shopifyStatus: string | null;
  /** Warehouse quantity from the Pio export, when present. */
  pioQty: number | null;
  /** Where a create should take its data from. */
  source: "sitoo" | "shopify";
  /** Set when the row is here for a reason other than being absent from Cin7. */
  note: string | null;
}

export interface GapReport {
  rows: GapRow[];
  snapshot: string;
  allowlistSize: number;
  error: string | null;
}

interface SitooP { sku?: string; title?: string; barcode?: string | null; moneyprice?: string }
interface ShopifyP {
  title?: string; status?: string; vendor?: string; productType?: string;
  variants?: { edges: { node: { sku?: string; barcode?: string | null; price?: string } }[] };
}

async function readJson<T>(dir: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), dir, file), "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * @param dir       snapshot directory, e.g. "snapshots/2026-09-12"
 * @param alsoInclude extra SKUs to surface even though Cin7 has them — used for
 *                    Hayes Taupe, which is retiring and wants a decision rather
 *                    than a silent import.
 */
export async function findImportGaps(
  dir: string,
  alsoInclude: { pattern: RegExp; note: string }[] = []
): Promise<GapReport> {
  const allowlist = await readJson<{ allowSkus?: string[] }>(dir, "import-allowlist.json");
  if (!allowlist?.allowSkus) {
    return { rows: [], snapshot: dir, allowlistSize: 0, error: `No import-allowlist.json in ${dir}` };
  }
  const cin7 = await readJson<Array<{ SKU?: string }>>(dir, "cin7-products.json");
  const sitoo = await readJson<SitooP[]>(dir, "sitoo-products.json");
  const shopify = await readJson<ShopifyP[]>(dir, "shopify-products.json");
  if (!cin7 || !sitoo || !shopify) {
    return { rows: [], snapshot: dir, allowlistSize: 0, error: `Snapshot ${dir} is incomplete` };
  }

  const inCin7 = new Set(cin7.map((p) => (p.SKU ?? "").trim()).filter(Boolean));
  const bySitoo = new Map(sitoo.filter((p) => p.sku).map((p) => [p.sku!.trim(), p]));
  const byShopify = new Map<string, { p: ShopifyP; v: { sku?: string; barcode?: string | null; price?: string } }>();
  for (const p of shopify) {
    for (const e of p.variants?.edges ?? []) {
      if (e.node.sku) byShopify.set(e.node.sku.trim(), { p, v: e.node });
    }
  }

  // Pio is an optional enrichment — it lives beside the 09-11 worklists.
  const pio = new Map<string, number>();
  try {
    const csv = await readFile(
      path.join(process.cwd(), "snapshots/2026-09-11/worklists/Pio-Inventory-SKU-Report-2026-09-11-1.csv"),
      "utf8"
    );
    const lines = csv.trim().split(/\r?\n/);
    const head = lines[0].split(",");
    const iS = head.indexOf("sku"), iQ = head.indexOf("quantity");
    for (const l of lines.slice(1)) {
      const c = l.split(",");
      if (c[iS]) pio.set(normalizeSku(c[iS]), Number(c[iQ] ?? 0) || 0);
    }
  } catch {
    // absent is fine
  }

  const rows: GapRow[] = [];
  for (const sku of allowlist.allowSkus) {
    const extra = alsoInclude.find((x) => x.pattern.test(sku));
    if (inCin7.has(sku) && !extra) continue;

    const st = bySitoo.get(sku);
    const sh = byShopify.get(sku);
    if (!st && !sh) continue; // nothing to create from

    const q = pio.get(normalizeSku(sku));
    rows.push({
      sku,
      name: st?.title || sh?.p.title || sku,
      brand: sh?.p.vendor ?? null,
      productType: sh?.p.productType ?? null,
      barcode: storedForm(st?.barcode ?? null) ?? storedForm(sh?.v.barcode ?? null),
      priceNok: st?.moneyprice ?? sh?.v.price ?? null,
      inSitoo: Boolean(st),
      inShopify: Boolean(sh),
      inPio: q !== undefined,
      shopifyStatus: sh?.p.status ?? null,
      pioQty: q ?? null,
      // Sitoo is the better source where both hold it: it is the system a wrong
      // value fails in, so its data has been exercised.
      source: st ? "sitoo" : "shopify",
      note: extra?.note ?? null,
    });
  }
  rows.sort((a, b) => a.sku.localeCompare(b.sku));
  return { rows, snapshot: dir, allowlistSize: allowlist.allowSkus.length, error: null };
}
