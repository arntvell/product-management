// Cin7 Core -> master import (legacy historical catalogue).
// Scope: products with stock-on-hand > 0 at the Livid retail/warehouse
// locations. Grouped by SKU (last "-<size>" segment = variant) into
// Style -> Colorway -> Variant, created as source=CIN7_IMPORT in the CONTINUITY
// season. Non-destructive: never touches products already in the master
// (matched by SKU), so it can't duplicate or clobber Threadflow/Shopify data.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { fetchAllProducts, fetchAllAvailability } from "./client";
import type { Cin7Product } from "./types";
import { canonical } from "@/lib/master/barcode";
import { styleSkuFor } from "@/lib/master/sku";

// The physical locations whose in-stock items we import (exact Cin7 names).
export const TARGET_LOCATIONS = [
  "Livid Oslo",
  "Livid Trondheim",
  "Livid Bergen",
  "Livid Stavanger",
  "Livid Sentrallager",
  "Past Løkka",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Size tokens, as the corpus actually writes them.
 *
 * Anything NOT on this list that appears in the trailing position is part of the
 * product's identity, not a size — see `splitSku`.
 */
const SIZE_WORDS = new Set([
  "XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "2XS", "3XS",
  "2XL", "3XL", "4XL", "OS", "ONESIZE",
]);
const COMBINED = "XXS|XS|S|M|L|XL|XXL|[234]XL";
const COMBINED_SIZE = new RegExp(`^(${COMBINED})\\/(${COMBINED})$`);

function isSizeToken(token: string): boolean {
  const t = token.toUpperCase();
  return (
    SIZE_WORDS.has(t) ||
    /^\d{1,2}$/.test(t) || // shoe size
    /^\d{1,2}[.,]5$/.test(t) || // half shoe size, dot or comma
    /^\d{4}$/.test(t) || // waist+length, 3132
    /^W\d{2}$/.test(t) || // waist only
    /^\d{2}\/\d{2}$/.test(t) || // 28/34
    /^L\d{1,2}$/.test(t) || // length only
    // Volume and weight ARE the size for a consumable — the Abel and Bon
    // Parfumeur runs are 6ml / 30ml / 50ml of one fragrance, written with and
    // without a space. Treating them as identity would make every size its own
    // product and break the existing grouping.
    /^\d+([.,]\d+)?\s*(ML|L|CL|G|KG|OZ)$/.test(t) ||
    COMBINED_SIZE.test(t) // XS/S, M/L — real labels on womenswear
  );
}

/**
 * Brands whose every SKU is a distinct garment, so no two of them are ever two
 * sizes of one product.
 *
 * Vintage is one-of-one by definition. The same test already gates style
 * regrouping (`src/lib/grouping.ts`), for the same reason.
 *
 * This exists because SHAPE CANNOT DECIDE IT. `VN-ONLN-4399` is a four-digit
 * trailing token, indistinguishable from a waist+length; 100 of the 391 online
 * vintage ids parse as a plausible waist and length by any range test, and a
 * range tight enough to reject them also rejects three genuine 2-D variants
 * (1802, 1042, 1143). Measured, not assumed.
 */
const ONE_OF_ONE_BRAND = /vintage|used|preloved/i;

/**
 * Split a Cin7 SKU into its colorway base and its trailing size token.
 *
 * The naive rule — always strip the last segment — is what collapsed 488 vintage
 * garments into 15 products. `EXT-VN-NW-USBRSHRT` became size "USBRSHRT" of a
 * product called "RUGBY SHIRT", and the other 25 names were discarded outright;
 * `VN-ONLN` swallowed 391 distinct garments and showed them all as sizes of one
 * Polo Ralph Lauren shirt. For vintage the trailing segment is the GARMENT, not
 * a size.
 *
 * So a segment is only a size when it looks like one, and never for a one-of-one
 * brand. An explicit `-OS` still splits, which keeps the established convention
 * `variant_sku == colorway_sku + "-OS"` (1,843 of our 1,867 correct vintage
 * one-of-ones) intact.
 *
 * Regression-tested against every existing multi-variant colorway: 1,801 stay
 * grouped, 57 split, and every one of the 57 is a genuine defect.
 */
function splitSku(sku: string, brand?: string | null): { base: string; size: string } {
  const parts = sku.split("-");
  if (parts.length < 2) return { base: sku, size: "OS" };
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join("-");
  // An explicit one-size suffix always splits, whatever the brand.
  const upper = last.toUpperCase();
  if (upper === "OS" || upper === "ONESIZE") return { base: head, size: "OS" };
  if (ONE_OF_ONE_BRAND.test(brand ?? "") || !isSizeToken(last)) {
    return { base: sku, size: "OS" };
  }
  return { base: head, size: last };
}

// A 4-digit numeric size encodes waist+length (e.g. 3132 -> W31/L32); anything
// else is a plain size label (L, 2XL, 43, OS, 7.2, ...).
function deriveSize(size: string): { sizeLabel: string; dim1: string; dim2: string | null } {
  if (/^\d{4}$/.test(size)) {
    const waist = size.slice(0, 2);
    const length = size.slice(2);
    return { sizeLabel: `W${waist}/L${length}`, dim1: waist, dim2: length };
  }
  return { sizeLabel: size, dim1: size, dim2: null };
}

// Strip a trailing size token from the product name -> the colorway name.
// The SKU encodes a jeans size as 4 digits (2634) but the product name spells
// it out ("26 34", "26/34", "W26/L34"), so match both forms or the size stays
// glued to the name ("Joelle Japan Dawn 26 34").
export function colorwayName(name: string, size: string): string {
  const forms = [escapeRegExp(size)];
  const wl = /^(\d{2})(\d{2})$/.exec(size);
  // The separator is optional: the corpus writes 29/32, 29 32, 29x32 and 32l32,
  // and the "L" of the last form is already covered by the optional L? below.
  if (wl) forms.push(`W?${wl[1]}\\s*[\\/x\\s]?\\s*L?${wl[2]}`);
  for (const form of forms) {
    // An imperfect's name ends with an asterisk AFTER the size — "Barnes Japan
    // Fade, 2932*" — so anchoring on the size alone never matched and the size
    // stayed glued to the name. That is why 54 imperfect styles are called
    // things like "Barnes Japan Dawn 29/32*". The star is the IMPERFECT marker,
    // carried on the style name, and does not belong in the colourway's.
    const stripped = name
      .replace(new RegExp(`[,\\s]+${form}\\s*\\*?\\s*$`, "i"), "")
      .trim();
    if (stripped && stripped !== name) return stripped;
  }
  // No size to strip, but a bare trailing star still is not part of the name.
  const starless = name.replace(/\s*\*\s*$/, "").trim();
  return starless || name;
}

/**
 * An imperfect — a garment with a production fault, sold at a discount.
 *
 * It is a DIFFERENT PRODUCT from the garment it came from, never a colour or a
 * size of it, and `MEANINGFUL_PREFIXES` in master/sku.ts already treats the
 * IMP- prefix that way when comparing SKUs. Two independent markers, because
 * the corpus carries both and neither is complete on its own: the SKU prefix,
 * and an asterisk at the end of the Cin7 product name.
 */
export function isImperfect(sku: string, name: string | null): boolean {
  return /^IMP-/i.test(sku.trim()) || /\*\s*$/.test(name ?? "");
}

/**
 * Cin7 has no style level — a "product family" is one colour, and its options
 * are only ever Size / Waist / Length. So a Cin7 product cannot tell us which
 * garment it belongs to, and importing one style per colour is what produced 91
 * one-colour styles in Loom.
 *
 * Derive the parent from the name instead: the longest known style name the
 * product name starts with. Threadflow is the authority on where a garment name
 * ends and a colour begins, so its style names are the vocabulary. Returns null
 * when nothing matches, and the caller then creates a style of its own — but
 * one whose SKU is deliberately distinct from the colorway's, so a style can
 * never be its own colorway.
 *
 * It returns the matched style's ID, not just its name, and that is the whole
 * point. Returning the name alone is what produced the second "Abby": the
 * caller synthesised `LIV-STY-ABBY` from it, looked *that* up, missed — because
 * the Threadflow style which supplied the name is `LIV-W-BBY` — and created a
 * duplicate. The id is the only thing that cannot be re-derived wrongly.
 */
export interface KnownStyle {
  id: string;
  styleName: string;
}

export function deriveParentStyle(
  name: string,
  knownStyles: KnownStyle[]
): { styleId: string; styleName: string; colorName: string } | null {
  const n = name.trim();
  for (const k of knownStyles) {
    const s = k.styleName.trim();
    if (!s) continue;
    if (n.toLowerCase() === s.toLowerCase()) {
      return { styleId: k.id, styleName: s, colorName: n };
    }
    if (n.toLowerCase().startsWith(s.toLowerCase() + " ")) {
      return { styleId: k.id, styleName: s, colorName: n.slice(s.length).trim() || n };
    }
  }
  return null;
}

function weightToKg(weight: number | null, units: string | null): number | null {
  if (weight == null || weight <= 0) return null;
  const u = (units ?? "").toLowerCase();
  if (u === "g" || u === "gram" || u === "grams") return weight / 1000;
  return weight; // assume kg otherwise
}

// Livid vendor label + gender from the Cin7 brand string.
function deriveBrandVendor(brand: string | null): {
  brandName: string;
  isLivid: boolean;
  gender: string | null;
  vendor: string;
} {
  const b = (brand ?? "").trim();
  const lower = b.toLowerCase();
  if (lower.startsWith("livid")) {
    const gender = lower.includes("men")
      ? "men"
      : lower.includes("femme") || lower.includes("women")
        ? "women"
        : null;
    const vendor = gender === "men" ? "Livid Men" : gender === "women" ? "Livid Femme" : "Livid";
    return { brandName: "Livid", isLivid: true, gender, vendor };
  }
  return { brandName: b || "Unknown", isLivid: false, gender: null, vendor: b || "Unknown" };
}

// PriceTiers -> master price rows. bare currency = wholesale, "MSRP <cur>" =
// MSRP, and "Retail" is the NOK retail (MSRP) price.
function pricesFrom(tiers: Record<string, number> | null): Array<{
  currency: string;
  priceType: "MSRP" | "WHOLESALE";
  amount: number;
}> {
  if (!tiers) return [];
  const out: Array<{ currency: string; priceType: "MSRP" | "WHOLESALE"; amount: number }> = [];
  const push = (currency: string, priceType: "MSRP" | "WHOLESALE", amount: number | undefined) => {
    if (typeof amount === "number" && amount > 0) out.push({ currency, priceType, amount });
  };
  push("NOK", "MSRP", tiers["Retail"]);
  push("NOK", "WHOLESALE", tiers["NOK"]);
  for (const cur of ["EUR", "USD", "DKK"]) {
    push(cur, "MSRP", tiers[`MSRP ${cur}`]);
    push(cur, "WHOLESALE", tiers[cur]);
  }
  return out;
}

interface ColorwayGroup {
  base: string; // colorwaySku
  name: string; // colorway name
  rep: Cin7Product; // representative product (for style/customs/price)
  variants: Cin7Product[]; // one per size
}

// Build the set of SKUs in stock (>0) at any target location, then group the
// matching products into colorways. Shared by preview and run.
/**
 * Which SKUs this run is allowed to bring in.
 *
 * The original gate — in stock, right now, at six locations — is why the master
 * holds about half of what the business sells: anything that happened to be out
 * of stock on import day never crossed. Reconciliation measured the hole at
 * 4,552 stocked identities present in all three other systems.
 *
 * An allowlist (emitted by scripts/reconcile/reconcile.py) replaces that gate
 * for the backfill. It is a *widening*: it carries product the live stock check
 * would miss, and it excludes what the live check would wrongly admit —
 * production materials, aggregate buckets, test rows, and the EEXT-/EXT- twins
 * that would otherwise import as two records of one shoe.
 */
export interface ImportGate {
  /** Import exactly these SKUs, regardless of current stock. */
  allowSkus?: string[];
  /** Never import these, even when in stock. */
  denySkus?: string[];
  /** Keep the original live in-stock behaviour as well as the allowlist. */
  includeInStock?: boolean;
  /**
   * Whether this run may mark existing products as dropped.
   *
   * The lifecycle step reads the gate as a COMPLETE statement of what is in
   * stock: anything already imported and not in the gate is cancelled. That is
   * right for the live stock check and catastrophic for an allowlist, which is
   * additive by nature and says nothing about the rest of the catalogue.
   *
   * Measured on the 2026-09-12 preview: an allowlist run would have cancelled
   * 2,351 existing colorways — nearly every Cin7-imported product in the master
   * — purely because they were not on a list of things to ADD.
   *
   * Defaults to off whenever an allowlist is supplied.
   */
  reconcileLifecycle?: boolean;
}

async function buildGroups(gate?: ImportGate): Promise<{
  groups: ColorwayGroup[];
  inStockSkuCount: number;
  productMissing: number;
}> {
  const targetSet = new Set(TARGET_LOCATIONS);
  const [availability, products] = await Promise.all([
    fetchAllAvailability(),
    fetchAllProducts(),
  ]);

  // Default behaviour is unchanged when no gate is supplied.
  const useLiveStock = !gate?.allowSkus?.length || gate.includeInStock === true;
  const inStock = new Set<string>();
  if (useLiveStock) {
    for (const row of availability) {
      if (row.OnHand > 0 && targetSet.has(row.Location) && row.SKU) inStock.add(row.SKU);
    }
  }
  for (const sku of gate?.allowSkus ?? []) inStock.add(sku);
  for (const sku of gate?.denySkus ?? []) inStock.delete(sku);

  const productBySku = new Map<string, Cin7Product>();
  for (const p of products) if (p.SKU) productBySku.set(p.SKU, p);

  const byBase = new Map<string, ColorwayGroup>();
  let productMissing = 0;
  for (const sku of inStock) {
    const p = productBySku.get(sku);
    if (!p) {
      productMissing++;
      continue;
    }
    if (p.Type === "Service" || !p.Name) continue; // non-products
    const { base, size } = splitSku(sku, p.Brand);
    let g = byBase.get(base);
    if (!g) {
      g = { base, name: colorwayName(p.Name, size), rep: p, variants: [] };
      byBase.set(base, g);
    }
    g.variants.push(p);
  }

  return { groups: [...byBase.values()], inStockSkuCount: inStock.size, productMissing };
}

async function loadExisting(): Promise<{
  styleSkus: Set<string>;
  colorwaySkus: Set<string>;
  variantSkus: Set<string>;
  colorwayIdBySku: Map<string, string>;
  barcodes: Set<string>;
}> {
  const [styles, colorways, variants] = await Promise.all([
    prisma.style.findMany({ select: { styleSku: true } }),
    prisma.colorway.findMany({ select: { id: true, colorwaySku: true } }),
    prisma.variant.findMany({ select: { variantSku: true, barcode: true } }),
  ]);
  return {
    styleSkus: new Set(styles.map((s) => s.styleSku)),
    colorwaySkus: new Set(colorways.map((c) => c.colorwaySku)),
    variantSkus: new Set(variants.map((v) => v.variantSku)),
    colorwayIdBySku: new Map(colorways.map((c) => [c.colorwaySku, c.id])),
    // Barcode is uniquely indexed, so a colliding insert fails the whole batch.
    barcodes: new Set(variants.map((v) => v.barcode).filter((b): b is string => Boolean(b))),
  };
}

export interface Cin7ImportPreview {
  /** False when this run is additive and will not cancel anything. */
  lifecycleReconciled: boolean;
  inStockSkus: number;
  productMissing: number;
  colorways: number;
  variants: number;
  toImportColorways: number;
  toImportVariants: number;
  /**
   * Sizes that belong to a colorway the master already has, and that the
   * master is missing.
   *
   * The importer used to skip an existing colorway whole — variants included —
   * so a size run that grew after the first import stayed short for ever. That
   * left 1,465 variants behind across 385 colorways, and a half-populated size
   * run is worse than an absent one because it looks complete.
   */
  topUpVariants: number;
  topUpColorways: number;
  skippedExisting: number;
  wouldDrop: number; // already-imported colorways no longer in stock
  wouldRestock: number; // dropped colorways back in stock
  byBrand: { brand: string; colorways: number }[];
}

export async function previewCin7Import(
  brands?: string[],
  gate?: ImportGate
): Promise<Cin7ImportPreview> {
  const [{ groups, inStockSkuCount, productMissing }, existing] = await Promise.all([
    buildGroups(gate),
    loadExisting(),
  ]);

  let toImportColorways = 0;
  let toImportVariants = 0;
  let topUpVariants = 0;
  let topUpColorways = 0;
  let skippedExisting = 0;
  let totalVariants = 0;
  const brandCounts = new Map<string, number>();
  const brandSet = brands && brands.length ? new Set(brands) : null;

  for (const g of groups) {
    totalVariants += g.variants.length;
    // Skip the whole colorway if its base OR ANY of its variant SKUs already
    // exist in the master — never create a partial/fragment duplicate.
    const exists =
      existing.colorwaySkus.has(g.base) ||
      existing.styleSkus.has(g.base) ||
      g.variants.some((v) => existing.variantSkus.has(v.SKU));
    if (exists) {
      skippedExisting++;
      // The colorway is present; its missing sizes are not. The brand scope
      // applies here too — a run limited to one brand must not quietly reach
      // into every other brand's size runs, which is what makes a small trial
      // run meaningful.
      const { brandName: existingBrand } = deriveBrandVendor(g.rep.Brand);
      if (brandSet && !brandSet.has(existingBrand)) continue;
      const missing = g.variants.filter((v) => !existing.variantSkus.has(v.SKU));
      if (missing.length && existing.colorwayIdBySku.has(g.base)) {
        topUpColorways++;
        topUpVariants += missing.length;
      }
      continue;
    }
    const { brandName } = deriveBrandVendor(g.rep.Brand);
    if (brandSet && !brandSet.has(brandName)) continue; // out of chosen scope
    toImportColorways++;
    toImportVariants += g.variants.length;
    brandCounts.set(brandName, (brandCounts.get(brandName) ?? 0) + 1);
  }

  // Lifecycle preview: how many already-imported colorways would flip
  // dropped/restocked based on current stock. Skipped for an additive run.
  const lifecycle = gate?.allowSkus?.length
    ? gate.reconcileLifecycle === true
    : true;
  const inStockBases = new Set(groups.map((g) => g.base));
  const existingCin7 = await prisma.colorway.findMany({
    where: { source: "CIN7_IMPORT" },
    select: {
      colorwaySku: true,
      entries: { where: { season: { code: "CONTINUITY" } }, select: { cancelled: true } },
    },
  });
  let wouldDrop = 0;
  let wouldRestock = 0;
  if (lifecycle) {
    for (const cw of existingCin7) {
      const entry = cw.entries[0];
      if (!entry) continue;
      const outOfStock = !inStockBases.has(cw.colorwaySku);
      if (outOfStock && !entry.cancelled) wouldDrop++;
      else if (!outOfStock && entry.cancelled) wouldRestock++;
    }
  }

  return {
    lifecycleReconciled: lifecycle,
    inStockSkus: inStockSkuCount,
    productMissing,
    colorways: groups.length,
    variants: totalVariants,
    toImportColorways,
    toImportVariants,
    topUpVariants,
    topUpColorways,
    skippedExisting,
    wouldDrop,
    wouldRestock,
    byBrand: [...brandCounts.entries()]
      .map(([brand, colorways]) => ({ brand, colorways }))
      .sort((a, b) => b.colorways - a.colorways),
  };
}

export interface Cin7ImportResult {
  importedColorways: number;
  importedVariants: number;
  /** Sizes added to colorways the master already had. */
  toppedUpVariants: number;
  toppedUpColorways: number;
  /** Sizes skipped because their barcode is already on another variant. */
  barcodeConflicts: Array<{ variantSku: string; barcode: string }>;
  skipped: number;
  droppedMarked: number; // previously imported, now out of stock -> cancelled
  restocked: number; // previously dropped, back in stock -> un-cancelled
  brands: number;
  /**
   * Parent styles minted because no known style matched the product name.
   *
   * Each one is a garment the catalogue did not know about — or a name the
   * vocabulary failed to match. Surfaced rather than silent: an unreviewed mint
   * is how the catalogue accumulated 997 `LIV-STY-*` styles. Check them in
   * /catalog/style-splits.
   */
  mintedStyles: Array<{ styleSku: string; styleName: string }>;
  syncRunId: string;
}

export async function runCin7Import(
  brands?: string[],
  gate?: ImportGate
): Promise<Cin7ImportResult> {
  const run = await prisma.syncRun.create({
    data: { source: "cin7-import", mode: "full", status: "running" },
  });
  const brandSet = brands && brands.length ? new Set(brands) : null;

  try {
    const [{ groups }, existing] = await Promise.all([buildGroups(gate), loadExisting()]);

    // CONTINUITY season.
    const season = await prisma.season.upsert({
      where: { code: "CONTINUITY" },
      create: { code: "CONTINUITY", name: "Continuity", kind: "CONTINUITY" },
      update: {},
    });

    // Brands are created lazily, only for colorways we actually import.
    const brandIdByName = new Map<string, string>();
    const ensureBrand = async (brandName: string, isLivid: boolean): Promise<string> => {
      const cached = brandIdByName.get(brandName);
      if (cached) return cached;
      const b = await prisma.brand.upsert({
        where: { name: brandName },
        create: { name: brandName, isLivid },
        update: {},
      });
      brandIdByName.set(brandName, b.id);
      return b.id;
    };

    const styleCreates: Array<Record<string, unknown>> = [];
    const colorwayCreates: Array<Record<string, unknown>> = [];
    const variantCreates: Array<Record<string, unknown>> = [];
    const entryCreates: Array<Record<string, unknown>> = [];
    const seasonVariantLinks: Array<{ seasonEntryId: string; variantId: string }> = [];
    const topUp: Array<Record<string, unknown>> = [];
    const topUpParents = new Set<string>();
    const barcodeConflicts: Cin7ImportResult["barcodeConflicts"] = [];
    const priceCreates: Array<Record<string, unknown>> = [];

    const usedSkus = new Set(existing.variantSkus);
    // Threadflow decides where a garment name ends and a colour begins, so its
    // styles are the vocabulary — carrying their ids, because the id is what the
    // colourway gets attached to.
    //
    // A MANUAL row qualifies only if it is not a self-named singleton. Without
    // that filter the vocabulary poisons itself: the bogus one-colour style
    // "Barnes Japan Fade" is a longer match than "Barnes", so it swallows
    // "Barnes Japan Fade Selvage" and the error chains.
    const knownStyles: KnownStyle[] = (
      await prisma.style.findMany({
        where: { source: { in: ["THREADFLOW", "MANUAL"] } },
        select: {
          id: true,
          styleName: true,
          threadflowId: true,
          colorways: { select: { name: true }, take: 2 },
        },
      })
    )
      .filter((s) => {
        if (!s.styleName.trim()) return false;
        if (s.threadflowId) return true;
        const selfNamed =
          s.colorways.length === 1 &&
          s.colorways[0].name.trim().toLowerCase() === s.styleName.trim().toLowerCase();
        return !selfNamed;
      })
      .map((s) => ({ id: s.id, styleName: s.styleName.trim() }))
      .sort((a, b) => b.styleName.length - a.styleName.length);
    // Styles created during this run, so sibling colours share one parent.
    const styleIdByName = new Map<string, string>();
    // Parents minted because nothing matched — worth reviewing, not worth
    // failing the import over.
    const mintedStyles: { styleSku: string; styleName: string }[] = [];
    let importedColorways = 0;
    let importedVariants = 0;
    let skipped = 0;

    for (const g of groups) {
      // Skip if the base OR any variant SKU is already in the master (no
      // fragment duplicates), matching the preview's rule exactly.
      const exists =
        existing.colorwaySkus.has(g.base) ||
        existing.styleSkus.has(g.base) ||
        g.variants.some((v) => usedSkus.has(v.SKU));
      if (exists) {
        skipped++;
        // Brand scope applies to top-ups as well — see the preview.
        const { brandName: existingBrand } = deriveBrandVendor(g.rep.Brand);
        if (brandSet && !brandSet.has(existingBrand)) continue;
        // Top up: the colorway is present, some of its sizes are not. Attach
        // them to the existing record rather than leaving the run short — a
        // half-populated size run is worse than an absent one, because nothing
        // downstream can tell it is incomplete.
        const parentId = existing.colorwayIdBySku.get(g.base);
        const missing = g.variants.filter((v) => !usedSkus.has(v.SKU));
        if (parentId && missing.length) {
          for (const v of missing) {
            const bc = canonical(v.Barcode);
            // Variant.barcode is uniquely indexed, so one collision would fail
            // the whole batch. Report it and carry on without the barcode.
            const clash = bc ? existing.barcodes.has(bc) : false;
            if (bc && clash) barcodeConflicts.push({ variantSku: v.SKU, barcode: bc });
            usedSkus.add(v.SKU);
            if (bc && !clash) existing.barcodes.add(bc);
            const { size } = splitSku(v.SKU, v.Brand);
            const { sizeLabel, dim1, dim2 } = deriveSize(size);
            const variantId = randomUUID();
            topUp.push({
              id: variantId,
              colorwayId: parentId,
              variantSku: v.SKU,
              barcode: clash ? null : bc,
              sizeLabel,
              dim1,
              dim2,
              averageCostNok:
                typeof v.AverageCost === "number" && v.AverageCost > 0 ? v.AverageCost : null,
            });
            topUpParents.add(parentId);
          }
        }
        continue;
      }

      const { brandName, isLivid, gender, vendor } = deriveBrandVendor(g.rep.Brand);
      if (brandSet && !brandSet.has(brandName)) continue; // out of chosen scope
      const brandId = await ensureBrand(brandName, isLivid);
      const colorwayId = randomUUID();
      const entryId = randomUUID();
      const category = g.rep.Category || "Uncategorized";

      // Model this as a colour of a garment, not a garment of its own.
      const parent = deriveParentStyle(g.name, knownStyles);
      // An imperfect is its own product. It groups like any other — all the
      // Barnes imperfects belong together — but under a style PARALLEL to the
      // garment's, never the garment's own: "Barnes" and "Barnes*" are two
      // styles. Merging them would put faulty stock under the style the
      // wholesale catalogue sells, and 54 imperfects are currently one style
      // each, named after a single colourway and size.
      const imperfect = isImperfect(g.base, g.rep.Name);
      const baseStyleName = parent?.styleName ?? g.name;
      const styleName = imperfect ? `${baseStyleName}*` : baseStyleName;
      const colorName = parent?.colorName ?? g.name;

      let styleId: string;
      if (parent && !imperfect) {
        // The matched style IS the parent. Attach to its id and stop — do not
        // synthesise a SKU and look that up, which is how a second style with
        // the same name got created every time the real one was not a
        // `LIV-STY-*` row.
        styleId = parent.styleId;
        styleIdByName.set(styleName.toLowerCase(), styleId);
      } else {
        // Built from the name WITHOUT the star: styleSkuFor strips punctuation,
        // so "Barnes*" and "Barnes" both render LIV-STY-BARNES and the
        // imperfect style would silently adopt the real one. The IMP- prefix is
        // the same modifier the colourway SKUs already carry.
        const styleSku = imperfect
          ? `IMP-${styleSkuFor(baseStyleName, isLivid ? null : brandName)}`
          : styleSkuFor(styleName, isLivid ? null : brandName);

        // A style must never be its own colorway — the assertion Loom asked for.
        if (styleSku === g.base) {
          throw new Error(
            `Refusing to import ${g.base}: style SKU would equal the colorway SKU, ` +
              `which is the shape that modelled colours as standalone styles.`
          );
        }

        const cached = styleIdByName.get(styleName.toLowerCase());
        if (cached) {
          styleId = cached;
        } else {
          const already = await prisma.style.findUnique({
            where: { styleSku },
            select: { id: true },
          });
          if (already) {
            styleId = already.id;
          } else {
            styleId = randomUUID();
            styleCreates.push({
              id: styleId,
              source: "CIN7_IMPORT",
              styleSku,
              styleName,
              gender,
              category,
              brandId,
              hsCode: g.rep.HSCode || null,
              weightKg: weightToKg(g.rep.Weight, g.rep.WeightUnits),
            });
            mintedStyles.push({ styleSku, styleName });
          }
          styleIdByName.set(styleName.toLowerCase(), styleId);
        }
      }
      colorwayCreates.push({
        id: colorwayId,
        source: "CIN7_IMPORT",
        colorwaySku: g.base,
        name: colorName,
        styleId,
        brandId,
        countryOfOrigin: g.rep.CountryOfOrigin || null,
        status: "DRAFT",
        tags: [],
        vendor,
        productType: category,
        shortDescription: g.rep.ShortDescription || null,
        fullDescription: g.rep.Description || null,
      });
      entryCreates.push({
        id: entryId,
        colorwayId,
        seasonId: season.id,
        approvedForProduction: false,
      });

      for (const v of g.variants) {
        usedSkus.add(v.SKU);
        const { size } = splitSku(v.SKU, v.Brand);
        const { sizeLabel, dim1, dim2 } = deriveSize(size);
        const variantId = randomUUID();
        // Variant.barcode is uniquely indexed, so ONE duplicate fails the whole
        // createMany and leaves the colorways written and the variants not.
        //
        // The duplicates are Cin7's own: 11 barcodes in the current import set
        // are shared by two SKUs each — EXT-BKST-BST-HR-42 and
        // EXT-BKST-BST-MNKSD-42 on 4044477046518, EXT-KEEN-JAS-BB-40 and -40.5
        // on 0195208040573. Checking the incoming barcodes against Origio found
        // no collisions and missed these entirely, because the batch collides
        // with ITSELF.
        //
        // First SKU keeps the code; the rest are created without one and
        // reported, so no product is lost to a data defect upstream.
        const incoming = canonical(v.Barcode);
        const clash = incoming ? existing.barcodes.has(incoming) : false;
        if (incoming && clash) barcodeConflicts.push({ variantSku: v.SKU, barcode: incoming });
        if (incoming && !clash) existing.barcodes.add(incoming);
        variantCreates.push({
          id: variantId,
          colorwayId,
          variantSku: v.SKU,
          barcode: clash ? null : incoming,
          sizeLabel,
          dim1,
          dim2,
          averageCostNok:
            typeof v.AverageCost === "number" && v.AverageCost > 0 ? v.AverageCost : null,
        });
        seasonVariantLinks.push({ seasonEntryId: entryId, variantId });
        importedVariants++;
      }

      for (const pr of pricesFrom(g.rep.PriceTiers)) {
        priceCreates.push({
          seasonId: season.id,
          colorwayId,
          currency: pr.currency,
          priceType: pr.priceType,
          amount: pr.amount,
        });
      }
      importedColorways++;
    }

    // Execute in dependency order.
    if (styleCreates.length) await prisma.style.createMany({ data: styleCreates as never });
    if (colorwayCreates.length) await prisma.colorway.createMany({ data: colorwayCreates as never });
    if (variantCreates.length) await prisma.variant.createMany({ data: variantCreates as never });
    if (entryCreates.length) await prisma.seasonEntry.createMany({ data: entryCreates as never });
    if (seasonVariantLinks.length)
      await prisma.seasonVariant.createMany({ data: seasonVariantLinks, skipDuplicates: true });
    if (priceCreates.length) await prisma.price.createMany({ data: priceCreates as never });

    // Write the top-up sizes, and link them into each parent's season entry so
    // they behave exactly like sizes that arrived with the original import.
    if (topUp.length) {
      for (let i = 0; i < topUp.length; i += 500) {
        await prisma.variant.createMany({ data: topUp.slice(i, i + 500) as never, skipDuplicates: true });
      }
      const parentEntries = await prisma.seasonEntry.findMany({
        where: { seasonId: season.id, colorwayId: { in: [...topUpParents] } },
        select: { id: true, colorwayId: true },
      });
      const entryByColorway = new Map(parentEntries.map((e) => [e.colorwayId, e.id]));
      // Every Cin7-imported colorway has a CONTINUITY entry today (2,735 of
      // 2,735), but a parent without one would leave its new sizes created and
      // unlinked — present in the data and invisible in every season view. So
      // the entry is created rather than the link dropped.
      const missingEntry = [...topUpParents].filter((id) => !entryByColorway.has(id));
      if (missingEntry.length) {
        await prisma.seasonEntry.createMany({
          data: missingEntry.map((colorwayId) => ({
            colorwayId,
            seasonId: season.id,
            // Matches what the importer sets on its own entries. These are
            // records of stock that exists, not a production decision.
            approvedForProduction: false,
          })),
          skipDuplicates: true,
        });
        const added = await prisma.seasonEntry.findMany({
          where: { seasonId: season.id, colorwayId: { in: missingEntry } },
          select: { id: true, colorwayId: true },
        });
        for (const e of added) entryByColorway.set(e.colorwayId, e.id);
      }

      const links = topUp
        .map((v) => ({
          seasonEntryId: entryByColorway.get(v.colorwayId as string),
          variantId: v.id as string,
        }))
        .filter((l): l is { seasonEntryId: string; variantId: string } => Boolean(l.seasonEntryId));
      for (let i = 0; i < links.length; i += 500) {
        await prisma.seasonVariant.createMany({ data: links.slice(i, i + 500), skipDuplicates: true });
      }
    }

    // Lifecycle reconciliation: a previously-imported Cin7 colorway that's no
    // longer in stock at the target locations is marked dropped (cancelled) in
    // its CONTINUITY entry; one back in stock is un-dropped. Never deleted.
    //
    // Only when this run actually knows what is in stock. An allowlist does not.
    const lifecycle = gate?.allowSkus?.length ? gate.reconcileLifecycle === true : true;
    const inStockBases = new Set(groups.map((g) => g.base));
    const existingCin7 = await prisma.colorway.findMany({
      where: { source: "CIN7_IMPORT" },
      select: {
        colorwaySku: true,
        entries: {
          where: { seasonId: season.id },
          select: { id: true, cancelled: true },
        },
      },
    });
    const toCancel: string[] = [];
    const toRestock: string[] = [];
    if (lifecycle) {
      for (const cw of existingCin7) {
        const entry = cw.entries[0];
        if (!entry) continue;
        const outOfStock = !inStockBases.has(cw.colorwaySku);
        if (outOfStock && !entry.cancelled) toCancel.push(entry.id);
        else if (!outOfStock && entry.cancelled) toRestock.push(entry.id);
      }
    }
    if (toCancel.length)
      await prisma.seasonEntry.updateMany({
        where: { id: { in: toCancel } },
        data: { cancelled: true },
      });
    if (toRestock.length)
      await prisma.seasonEntry.updateMany({
        where: { id: { in: toRestock } },
        data: { cancelled: false },
      });

    const result: Cin7ImportResult = {
      importedColorways,
      importedVariants,
      toppedUpVariants: topUp.length,
      toppedUpColorways: topUpParents.size,
      barcodeConflicts,
      skipped,
      droppedMarked: toCancel.length,
      restocked: toRestock.length,
      brands: brandIdByName.size,
      mintedStyles,
      syncRunId: run.id,
    };
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "ok",
        counts: result as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });
    return result;
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        errors: [err instanceof Error ? err.message : "unknown"] as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      },
    });
    throw err;
  }
}
