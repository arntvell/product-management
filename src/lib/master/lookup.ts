// Looking a product up by SKU, barcode or name, and showing its size run with
// every system's barcode side by side.
//
// Built because there was no way to answer "what barcode should this size have?"
// without a database query — which makes checking a physical label against the
// master impossible for anyone who is not me.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { barcodeKey, barcodeSpellings } from "./barcode";
import { normalizeSku } from "./sku";

/**
 * One system's value for one size.
 *
 * `raw` is what the system actually stores; `canonical` is null when that value
 * is not a usable barcode. The distinction matters: showing only the canonical
 * form renders a bad value as "—", which reads as "no barcode" when the truth is
 * "a barcode that will not scan". Sitoo holds 7000009888889 on LIV-CN-BCHK-L and
 * 7000009888888 on LIV-HNR-BGST-XL — both fail their check digit, and both are
 * the size squeezed off the end of a shifted run.
 */
export interface ChannelValue {
  raw: string | null;
  canonical: string | null;
  /** Present but not a usable barcode. */
  invalid: boolean;
}

export interface LookupSize {
  variantSku: string;
  sizeLabel: string;
  origio: string | null;
  sitoo: ChannelValue;
  shopify: ChannelValue;
  cin7: ChannelValue;
  /** True when a system holds a different barcode from the master. */
  mismatch: boolean;
}

export interface LookupResult {
  colorwaySku: string;
  name: string;
  styleName: string;
  brand: string | null;
  kind: string;
  seasons: string[];
  sizes: LookupSize[];
}

export interface LookupReport {
  query: string;
  results: LookupResult[];
  channelSnapshot: string | null;
  truncated: boolean;
}

type Index = Map<string, string>;

async function channelIndex(dir: string): Promise<{
  sitoo: Index;
  shopify: Index;
  cin7: Index;
  label: string | null;
}> {
  const empty = { sitoo: new Map(), shopify: new Map(), cin7: new Map(), label: null };
  const read = async <T>(f: string): Promise<T | null> => {
    try {
      return JSON.parse(await readFile(path.join(process.cwd(), dir, f), "utf8")) as T;
    } catch {
      return null;
    }
  };
  const sitooRaw = await read<Array<{ sku?: string; barcode?: string | null }>>("sitoo-products.json");
  if (!sitooRaw) return empty;

  // Store the RAW value. Canonicalising here would discard the difference
  // between "absent" and "present but unusable".
  const sitoo: Index = new Map();
  for (const p of sitooRaw) {
    if (p.sku) sitoo.set(normalizeSku(p.sku), (p.barcode ?? "").trim());
  }
  const shopify: Index = new Map();
  const shopRaw = await read<
    Array<{ status?: string; variants?: { edges: { node: { sku?: string; barcode?: string | null } }[] } }>
  >("shopify-products.json");
  for (const p of shopRaw ?? []) {
    if (p.status === "ARCHIVED") continue;
    for (const e of p.variants?.edges ?? []) {
      if (e.node.sku) shopify.set(normalizeSku(e.node.sku), (e.node.barcode ?? "").trim());
    }
  }
  const cin7: Index = new Map();
  const cinRaw = await read<Array<{ SKU?: string; Barcode?: string | null }>>("cin7-products.json");
  for (const p of cinRaw ?? []) {
    if (p.SKU) cin7.set(normalizeSku(p.SKU), (p.Barcode ?? "").trim());
  }
  return { sitoo, shopify, cin7, label: dir };
}

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL"];

function sizeKey(label: string): [number, number] {
  const t = label.trim().toUpperCase();
  const n = Number(t.replace(",", "."));
  if (Number.isFinite(n)) return [0, n];
  const i = SIZE_ORDER.indexOf(t);
  return i === -1 ? [2, 0] : [1, i];
}

export async function lookupProducts(
  query: string,
  snapshotDir = "snapshots/2026-09-12",
  limit = 20
): Promise<LookupReport> {
  const q = query.trim();
  if (!q) return { query, results: [], channelSnapshot: null, truncated: false };

  // Either spelling finds it: the master holds UPC-As as 12 and as 13 digits.
  const asBarcode = barcodeSpellings(q);
  const colorways = await prisma.colorway.findMany({
    where: asBarcode.length
      ? { variants: { some: { barcode: { in: asBarcode } } } }
      : {
          OR: [
            { colorwaySku: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
            { style: { styleName: { contains: q, mode: "insensitive" } } },
            { variants: { some: { variantSku: { contains: q, mode: "insensitive" } } } },
          ],
        },
    select: {
      colorwaySku: true,
      name: true,
      kind: true,
      style: { select: { styleName: true } },
      brand: { select: { name: true } },
      entries: { select: { season: { select: { code: true } } } },
      variants: { select: { variantSku: true, sizeLabel: true, barcode: true } },
    },
    take: limit + 1,
    orderBy: { colorwaySku: "asc" },
  });

  const ch = await channelIndex(snapshotDir);
  const results: LookupResult[] = colorways.slice(0, limit).map((c) => ({
    colorwaySku: c.colorwaySku,
    name: c.name,
    styleName: c.style.styleName,
    brand: c.brand?.name ?? null,
    kind: c.kind,
    seasons: c.entries.map((e) => e.season.code),
    sizes: c.variants
      .map((v) => {
        const key = normalizeSku(v.variantSku);
        const origio = barcodeKey(v.barcode);
        const pick = (m: Index): ChannelValue => {
          const got = m.get(key);
          const raw = got === undefined || got === "" ? null : got;
          const c = barcodeKey(raw);
          return { raw, canonical: c, invalid: raw !== null && c === null };
        };
        const sitoo = pick(ch.sitoo);
        const shopify = pick(ch.shopify);
        const cin7 = pick(ch.cin7);
        return {
          variantSku: v.variantSku,
          sizeLabel: v.sizeLabel,
          origio,
          sitoo,
          shopify,
          cin7,
          // An unusable value is a mismatch too — it will not scan to anything.
          mismatch: [sitoo, shopify, cin7].some(
            (b) => b.raw !== null && (b.invalid || b.canonical !== origio)
          ),
        };
      })
      .sort((a, b) => {
        const [ka, va] = sizeKey(a.sizeLabel);
        const [kb, vb] = sizeKey(b.sizeLabel);
        return ka - kb || va - vb || a.variantSku.localeCompare(b.variantSku);
      }),
  }));

  return {
    query: q,
    results,
    channelSnapshot: ch.label,
    truncated: colorways.length > limit,
  };
}
