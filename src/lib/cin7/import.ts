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

// Split a Cin7 SKU into its colorway base (all but the last segment) and the
// trailing size token. Single-segment SKUs have no size (one-size product).
function splitSku(sku: string): { base: string; size: string } {
  const parts = sku.split("-");
  if (parts.length < 2) return { base: sku, size: "OS" };
  return { base: parts.slice(0, -1).join("-"), size: parts[parts.length - 1] };
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
function colorwayName(name: string, size: string): string {
  return name.replace(new RegExp(`[,\\s]+${escapeRegExp(size)}\\s*$`, "i"), "").trim() || name;
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
async function buildGroups(): Promise<{
  groups: ColorwayGroup[];
  inStockSkuCount: number;
  productMissing: number;
}> {
  const targetSet = new Set(TARGET_LOCATIONS);
  const [availability, products] = await Promise.all([
    fetchAllAvailability(),
    fetchAllProducts(),
  ]);

  const inStock = new Set<string>();
  for (const row of availability) {
    if (row.OnHand > 0 && targetSet.has(row.Location) && row.SKU) inStock.add(row.SKU);
  }

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
    const { base, size } = splitSku(sku);
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
}> {
  const [styles, colorways, variants] = await Promise.all([
    prisma.style.findMany({ select: { styleSku: true } }),
    prisma.colorway.findMany({ select: { colorwaySku: true } }),
    prisma.variant.findMany({ select: { variantSku: true } }),
  ]);
  return {
    styleSkus: new Set(styles.map((s) => s.styleSku)),
    colorwaySkus: new Set(colorways.map((c) => c.colorwaySku)),
    variantSkus: new Set(variants.map((v) => v.variantSku)),
  };
}

export interface Cin7ImportPreview {
  inStockSkus: number;
  productMissing: number;
  colorways: number;
  variants: number;
  toImportColorways: number;
  toImportVariants: number;
  skippedExisting: number;
  wouldDrop: number; // already-imported colorways no longer in stock
  wouldRestock: number; // dropped colorways back in stock
  byBrand: { brand: string; colorways: number }[];
}

export async function previewCin7Import(brands?: string[]): Promise<Cin7ImportPreview> {
  const [{ groups, inStockSkuCount, productMissing }, existing] = await Promise.all([
    buildGroups(),
    loadExisting(),
  ]);

  let toImportColorways = 0;
  let toImportVariants = 0;
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
      continue;
    }
    const { brandName } = deriveBrandVendor(g.rep.Brand);
    if (brandSet && !brandSet.has(brandName)) continue; // out of chosen scope
    toImportColorways++;
    toImportVariants += g.variants.length;
    brandCounts.set(brandName, (brandCounts.get(brandName) ?? 0) + 1);
  }

  // Lifecycle preview: how many already-imported colorways would flip
  // dropped/restocked based on current stock.
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
  for (const cw of existingCin7) {
    const entry = cw.entries[0];
    if (!entry) continue;
    const outOfStock = !inStockBases.has(cw.colorwaySku);
    if (outOfStock && !entry.cancelled) wouldDrop++;
    else if (!outOfStock && entry.cancelled) wouldRestock++;
  }

  return {
    inStockSkus: inStockSkuCount,
    productMissing,
    colorways: groups.length,
    variants: totalVariants,
    toImportColorways,
    toImportVariants,
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
  skipped: number;
  droppedMarked: number; // previously imported, now out of stock -> cancelled
  restocked: number; // previously dropped, back in stock -> un-cancelled
  brands: number;
  syncRunId: string;
}

export async function runCin7Import(brands?: string[]): Promise<Cin7ImportResult> {
  const run = await prisma.syncRun.create({
    data: { source: "cin7-import", mode: "full", status: "running" },
  });
  const brandSet = brands && brands.length ? new Set(brands) : null;

  try {
    const [{ groups }, existing] = await Promise.all([buildGroups(), loadExisting()]);

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
    const priceCreates: Array<Record<string, unknown>> = [];

    const usedSkus = new Set(existing.variantSkus);
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
        continue;
      }

      const { brandName, isLivid, gender, vendor } = deriveBrandVendor(g.rep.Brand);
      if (brandSet && !brandSet.has(brandName)) continue; // out of chosen scope
      const brandId = await ensureBrand(brandName, isLivid);
      const styleId = randomUUID();
      const colorwayId = randomUUID();
      const entryId = randomUUID();
      const category = g.rep.Category || "Uncategorized";

      styleCreates.push({
        id: styleId,
        source: "CIN7_IMPORT",
        styleSku: g.base,
        styleName: g.name,
        gender,
        category,
        brandId,
        hsCode: g.rep.HSCode || null,
        weightKg: weightToKg(g.rep.Weight, g.rep.WeightUnits),
      });
      colorwayCreates.push({
        id: colorwayId,
        source: "CIN7_IMPORT",
        colorwaySku: g.base,
        name: g.name,
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
        const { size } = splitSku(v.SKU);
        const { sizeLabel, dim1, dim2 } = deriveSize(size);
        const variantId = randomUUID();
        variantCreates.push({
          id: variantId,
          colorwayId,
          variantSku: v.SKU,
          barcode: v.Barcode || null,
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

    // Lifecycle reconciliation: a previously-imported Cin7 colorway that's no
    // longer in stock at the target locations is marked dropped (cancelled) in
    // its CONTINUITY entry; one back in stock is un-dropped. Never deleted.
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
    for (const cw of existingCin7) {
      const entry = cw.entries[0];
      if (!entry) continue;
      const outOfStock = !inStockBases.has(cw.colorwaySku);
      if (outOfStock && !entry.cancelled) toCancel.push(entry.id);
      else if (!outOfStock && entry.cancelled) toRestock.push(entry.id);
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
      skipped,
      droppedMarked: toCancel.length,
      restocked: toRestock.length,
      brands: brandIdByName.size,
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
