// Threadflow -> master ingestion (Phase 1).
// Upserts Style -> Colorway -> Variant + per-season data. Idempotent and
// non-destructive: matches on stable Threadflow ids, never deletes on absence,
// keeps barcodes once set, and never clobbers a populated customs field with an
// empty value (docs/product-master-architecture.md §5.2). TF-sourced fields
// only — manager-authored enrichment columns are never touched.
//
// Performance: the DB is remote, so we minimise round-trips — preload existing
// rows, resolve ids in memory, then `createMany` new rows and run updates in
// batched transactions rather than one upsert per entity.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { getManufacturers, getSeasonProducts } from "./client";
import type { TFColorway, TFStyle, TFVariant } from "./types";

export type SyncMode = "full" | "no-images";

export interface SyncCounts {
  styles: number;
  colorways: number;
  variants: number;
  prices: number;
  manufacturers: number;
  images: number;
}

export interface SyncResult {
  syncRunId: string;
  seasonCode: string;
  status: "ok" | "failed";
  counts: SyncCounts;
  errors: string[];
  durationMs: number;
}

// How many independent writes to keep in flight at once. Concurrency hides the
// per-query network latency without the 5s cap of an interactive transaction.
const CONCURRENCY = 15;

function hasValue(v: string | null | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/** Livid vendor label derived from gender/unisex (Shopify-facing). */
function deriveVendor(gender: string | null, unisex: boolean): string {
  if (unisex) return "Livid Unisex";
  const g = gender?.toLowerCase();
  if (g === "women") return "Livid Femme";
  if (g === "men") return "Livid Men";
  return "Livid";
}

function deriveSize(dims: TFVariant["dimensions"]): {
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
} {
  if (hasValue(dims.waist) || hasValue(dims.length)) {
    const waist = dims.waist ?? "";
    const length = dims.length ?? "";
    return { sizeLabel: `W${waist}/L${length}`, dim1: waist, dim2: length };
  }
  const size = dims.size ?? "";
  return { sizeLabel: size, dim1: size, dim2: null };
}

/**
 * Run independent write operations with bounded concurrency. Not wrapped in a
 * transaction — the sync is idempotent, so cross-row atomicity isn't needed,
 * and this avoids the interactive-transaction time limit.
 */
async function runBatched(ops: Prisma.PrismaPromise<unknown>[]): Promise<void> {
  for (let i = 0; i < ops.length; i += CONCURRENCY) {
    await Promise.all(ops.slice(i, i + CONCURRENCY));
  }
}

/** Read existing rows in chunks (keeps the `IN (...)` param count sane). */
async function chunkedFind<T>(
  keys: string[],
  finder: (chunk: string[]) => Promise<T[]>
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    out.push(...(await finder(keys.slice(i, i + 1000))));
  }
  return out;
}

export async function syncSeason(
  seasonCode: string,
  mode: SyncMode = "full"
): Promise<SyncResult> {
  const started = Date.now();
  const withImages = mode !== "no-images";
  const errors: string[] = [];
  const counts: SyncCounts = {
    styles: 0,
    colorways: 0,
    variants: 0,
    prices: 0,
    manufacturers: 0,
    images: 0,
  };

  const run = await prisma.syncRun.create({
    data: { source: "threadflow", mode, seasonCode, status: "running" },
  });

  try {
    // 1. Fetch the season's catalogue + manufacturer master data.
    const [{ season: tfSeason, styles }, manufacturers] = await Promise.all([
      getSeasonProducts(seasonCode, {
        includeUnapproved: true,
        includeDropped: true,
      }),
      getManufacturers(),
    ]);

    // 2. Season + brand (Livid — TF products are all Livid).
    const season = await prisma.season.upsert({
      where: tfSeason.id
        ? { threadflowId: tfSeason.id }
        : { code: tfSeason.code },
      create: { code: tfSeason.code, threadflowId: tfSeason.id || null },
      update: { code: tfSeason.code },
    });
    const seasonId = season.id;
    const brand = await prisma.brand.upsert({
      where: { name: "Livid" },
      create: { name: "Livid", isLivid: true },
      update: {},
    });

    // 3. Manufacturers: bulk create/update, keyed by TF id.
    const manuIdMap = new Map<string, string>();
    {
      const existing = await prisma.manufacturer.findMany({
        where: { threadflowId: { in: manufacturers.map((m) => m.manufacturer_id) } },
        select: { id: true, threadflowId: true },
      });
      const existingByTf = new Map(existing.map((m) => [m.threadflowId!, m.id]));
      const creates: Prisma.ManufacturerCreateManyInput[] = [];
      const updates: Prisma.PrismaPromise<unknown>[] = [];
      for (const m of manufacturers) {
        const data = {
          name: m.name,
          addrLine1: m.address?.line1 ?? null,
          addrLine2: m.address?.line2 ?? null,
          zip: m.address?.zip ?? null,
          city: m.address?.city ?? null,
          country: m.address?.country ?? null,
        };
        const existingId = existingByTf.get(m.manufacturer_id);
        if (existingId) {
          manuIdMap.set(m.manufacturer_id, existingId);
          updates.push(
            prisma.manufacturer.update({ where: { id: existingId }, data })
          );
        } else {
          const id = randomUUID();
          manuIdMap.set(m.manufacturer_id, id);
          creates.push({ id, threadflowId: m.manufacturer_id, ...data });
        }
      }
      if (creates.length)
        await prisma.manufacturer.createMany({ data: creates });
      await runBatched(updates);
      counts.manufacturers = manufacturers.length;
    }

    // 4. Preload existing product rows so we can resolve ids in memory.
    const styleTfIds = styles.map((s) => s.style_id);
    const colorways = styles.flatMap((s) => s.colorways);
    const colorwayTfIds = colorways.map((c) => c.colorway_id);
    const colorwaySkusIncoming = colorways.map((c) => c.colorway_sku);
    const variantSkus = colorways.flatMap((c) => c.variants.map((v) => v.sku));

    const existingStyles = await chunkedFind(styleTfIds, (ids) =>
      prisma.style.findMany({
        where: { threadflowId: { in: ids } },
        select: { id: true, threadflowId: true },
      })
    );
    const styleIdByTf = new Map(existingStyles.map((s) => [s.threadflowId!, s.id]));

    // Threadflow assigns colorway ids PER SEASON, so a carry-over colorway
    // appears in a new season with a fresh colorway_id but the SAME colorway_sku.
    // Match on threadflowId first, then fall back to colorwaySku (the stable
    // natural key) so carry-overs update the existing row instead of colliding
    // on the unique colorwaySku.
    const existingColorways = await chunkedFind(colorwayTfIds, (ids) =>
      prisma.colorway.findMany({
        where: { threadflowId: { in: ids } },
        select: { id: true, threadflowId: true, colorwaySku: true },
      })
    );
    const existingColorwaysBySku = await chunkedFind(colorwaySkusIncoming, (skus) =>
      prisma.colorway.findMany({
        where: { colorwaySku: { in: skus } },
        select: { id: true, threadflowId: true, colorwaySku: true },
      })
    );
    const colorwayIdByTf = new Map<string, string>();
    const colorwayIdBySku = new Map<string, string>();
    for (const c of [...existingColorways, ...existingColorwaysBySku]) {
      if (c.threadflowId) colorwayIdByTf.set(c.threadflowId, c.id);
      colorwayIdBySku.set(c.colorwaySku, c.id);
    }

    const existingVariants = await chunkedFind(variantSkus, (skus) =>
      prisma.variant.findMany({
        where: { variantSku: { in: skus } },
        select: { id: true, variantSku: true, barcode: true },
      })
    );
    const variantBySku = new Map(
      existingVariants.map((v) => [v.variantSku, { id: v.id, barcode: v.barcode }])
    );

    const existingEntries = await prisma.seasonEntry.findMany({
      where: { seasonId },
      select: { id: true, colorwayId: true },
    });
    const entryIdByColorway = new Map(
      existingEntries.map((e) => [e.colorwayId, e.id])
    );

    // Manually-edited (locked) colorway fields — the sync must not clobber them
    // (docs/product-master-architecture.md §5.3).
    const existingColorwayIds = [
      ...new Set([...colorwayIdByTf.values(), ...colorwayIdBySku.values()]),
    ];
    const ownerRows = await chunkedFind(existingColorwayIds, (ids) =>
      prisma.fieldOwner.findMany({
        where: { entityType: "colorway", entityId: { in: ids }, owner: "MANUAL" },
        select: { entityId: true, field: true },
      })
    );
    const ownedByColorway = new Map<string, Set<string>>();
    for (const r of ownerRows) {
      const set = ownedByColorway.get(r.entityId) ?? new Set<string>();
      set.add(r.field);
      ownedByColorway.set(r.entityId, set);
    }

    // Resolve every id up front (existing or freshly minted).
    const resolveStyle = (tfId: string) =>
      styleIdByTf.get(tfId) ?? styleIdByTf.set(tfId, randomUUID()).get(tfId)!;
    // Resolve a colorway's stable master id by threadflowId, else by colorwaySku
    // (carry-over), else mint a new one. Returns whether it was newly minted.
    const resolveColorway = (tfId: string, sku: string): { id: string; wasNew: boolean } => {
      const existingId = colorwayIdByTf.get(tfId) ?? colorwayIdBySku.get(sku);
      const id = existingId ?? randomUUID();
      // Cache under both keys so later references in this run resolve.
      colorwayIdByTf.set(tfId, id);
      colorwayIdBySku.set(sku, id);
      return { id, wasNew: !existingId };
    };

    // 5. Build write ops.
    const styleCreates: Prisma.StyleCreateManyInput[] = [];
    const styleUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const colorwayCreates: Prisma.ColorwayCreateManyInput[] = [];
    const colorwayUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const variantCreates: Prisma.VariantCreateManyInput[] = [];
    const variantUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const entryCreates: Prisma.SeasonEntryCreateManyInput[] = [];
    const entryUpdates: Prisma.PrismaPromise<unknown>[] = [];
    const seasonVariantLinks: Prisma.SeasonVariantCreateManyInput[] = [];
    const priceRows: Array<{
      colorwayId: string;
      currency: string;
      priceType: "MSRP" | "WHOLESALE";
      amount: number;
    }> = [];
    const imageRows: Array<{ colorwayId: string; url: string }> = [];

    for (const s of styles) {
      const wasNew = !styleIdByTf.has(s.style_id);
      const styleId = resolveStyle(s.style_id);
      if (wasNew) {
        styleCreates.push({
          id: styleId,
          source: "THREADFLOW",
          threadflowId: s.style_id,
          styleSku: s.style_sku,
          styleName: s.style_name,
          gender: s.gender,
          unisex: s.unisex,
          category: s.category || "Uncategorized",
          brandId: brand.id,
          hsCode: s.hs_code,
          customsDescription: s.customs_description,
          weightKg: hasValue(s.weight) ? s.weight : null,
          fiberComposition: s.fiber_composition,
        });
      } else {
        styleUpdates.push(
          prisma.style.update({
            where: { id: styleId },
            data: {
              styleSku: s.style_sku,
              styleName: s.style_name,
              gender: s.gender,
              unisex: s.unisex,
              category: s.category || "Uncategorized",
              brandId: brand.id,
              // don't-clobber-empty for customs
              ...(hasValue(s.hs_code) ? { hsCode: s.hs_code } : {}),
              ...(hasValue(s.customs_description)
                ? { customsDescription: s.customs_description }
                : {}),
              ...(hasValue(s.weight) ? { weightKg: s.weight } : {}),
              ...(hasValue(s.fiber_composition)
                ? { fiberComposition: s.fiber_composition }
                : {}),
            },
          })
        );
      }
      counts.styles++;

      const styleVendor = deriveVendor(s.gender, s.unisex);
      const styleProductType = s.category || null;

      for (const c of s.colorways) {
        const resolved = resolveColorway(c.colorway_id, c.colorway_sku);
        buildColorway(c, {
          styleId,
          brandId: brand.id,
          seasonId,
          manuIdMap,
          withImages,
          styleVendor,
          styleProductType,
          styleNameTF: s.style_name,
          ownedByColorway,
          wasNew: resolved.wasNew,
          colorwayId: resolved.id,
          colorwayCreates,
          colorwayUpdates,
          variantCreates,
          variantUpdates,
          entryCreates,
          entryUpdates,
          seasonVariantLinks,
          priceRows,
          imageRows,
          variantBySku,
          entryIdByColorway,
        });
        counts.colorways++;
        counts.variants += c.variants.length;
      }
    }

    // 6. Execute in dependency order.
    if (styleCreates.length)
      await prisma.style.createMany({ data: styleCreates });
    await runBatched(styleUpdates);

    if (colorwayCreates.length)
      await prisma.colorway.createMany({ data: colorwayCreates });
    await runBatched(colorwayUpdates);

    if (variantCreates.length)
      await prisma.variant.createMany({ data: variantCreates });
    await runBatched(variantUpdates);

    if (entryCreates.length)
      await prisma.seasonEntry.createMany({ data: entryCreates });
    await runBatched(entryUpdates);

    // Season/variant links + prices + images need entry/colorway ids, which now
    // exist. Links: skip duplicates. Prices/images: replace this season's set.
    if (seasonVariantLinks.length) {
      // resolve entry ids for links now that entries are persisted
      const entries = await prisma.seasonEntry.findMany({
        where: { seasonId },
        select: { id: true, colorwayId: true },
      });
      const entryByColorway = new Map(entries.map((e) => [e.colorwayId, e.id]));
      const links = seasonVariantLinks
        .map((l) => ({
          seasonEntryId: entryByColorway.get(l.seasonEntryId) ?? "",
          variantId: l.variantId,
        }))
        .filter((l) => l.seasonEntryId);
      if (links.length)
        await prisma.seasonVariant.createMany({
          data: links,
          skipDuplicates: true,
        });
    }

    counts.prices = await syncPrices(seasonId, priceRows);
    if (withImages) counts.images = await syncImages(seasonId, imageRows);

    const durationMs = Date.now() - started;
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "ok",
        counts: counts as unknown as Prisma.InputJsonValue,
        errors,
      },
    });
    return { syncRunId: run.id, seasonCode, status: "ok", counts, errors, durationMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    errors.push(message);
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        finishedAt: new Date(),
        status: "failed",
        counts: counts as unknown as Prisma.InputJsonValue,
        errors,
      },
    });
    return {
      syncRunId: run.id,
      seasonCode,
      status: "failed",
      counts,
      errors,
      durationMs: Date.now() - started,
    };
  }
}

interface ColorwayCtx {
  styleId: string;
  brandId: string;
  seasonId: string;
  manuIdMap: Map<string, string>;
  withImages: boolean;
  styleVendor: string;
  styleProductType: string | null;
  styleNameTF: string;
  ownedByColorway: Map<string, Set<string>>;
  wasNew: boolean;
  colorwayId: string;
  colorwayCreates: Prisma.ColorwayCreateManyInput[];
  colorwayUpdates: Prisma.PrismaPromise<unknown>[];
  variantCreates: Prisma.VariantCreateManyInput[];
  variantUpdates: Prisma.PrismaPromise<unknown>[];
  entryCreates: Prisma.SeasonEntryCreateManyInput[];
  entryUpdates: Prisma.PrismaPromise<unknown>[];
  seasonVariantLinks: Prisma.SeasonVariantCreateManyInput[];
  priceRows: Array<{
    colorwayId: string;
    currency: string;
    priceType: "MSRP" | "WHOLESALE";
    amount: number;
  }>;
  imageRows: Array<{ colorwayId: string; url: string }>;
  variantBySku: Map<string, { id: string; barcode: string | null }>;
  entryIdByColorway: Map<string, string>;
}

function buildColorway(c: TFColorway, ctx: ColorwayCtx): void {
  const manufacturerId = c.manufacturer_id
    ? ctx.manuIdMap.get(c.manufacturer_id) ?? null
    : null;

  const base = {
    colorwaySku: c.colorway_sku,
    name: c.name,
    swatchHex: c.swatch?.hex ?? null,
    styleId: ctx.styleId,
    brandId: ctx.brandId,
    manufacturerId,
    countryOfOrigin: c.country_of_origin,
  };

  if (ctx.wasNew) {
    ctx.colorwayCreates.push({
      id: ctx.colorwayId,
      source: "THREADFLOW",
      threadflowId: c.colorway_id,
      ...base,
      vendor: ctx.styleVendor,
      productType: ctx.styleProductType,
      // Auto-populate the custom.style_name metafield from the TF style name.
      styleName: ctx.styleNameTF,
    });
  } else {
    // Respect manual edits: only refresh vendor/productType/styleName if not locked.
    const owned = ctx.ownedByColorway.get(ctx.colorwayId);
    ctx.colorwayUpdates.push(
      prisma.colorway.update({
        where: { id: ctx.colorwayId },
        data: {
          ...base,
          ...(owned?.has("vendor") ? {} : { vendor: ctx.styleVendor }),
          ...(owned?.has("productType")
            ? {}
            : { productType: ctx.styleProductType }),
          ...(owned?.has("styleName") ? {} : { styleName: ctx.styleNameTF }),
        },
      })
    );
  }

  // Variants (barcode set-once).
  for (const v of c.variants) {
    const { sizeLabel, dim1, dim2 } = deriveSize(v.dimensions);
    const existing = ctx.variantBySku.get(v.sku);
    if (existing) {
      ctx.variantUpdates.push(
        prisma.variant.update({
          where: { id: existing.id },
          data: {
            colorwayId: ctx.colorwayId,
            sizeLabel,
            dim1,
            dim2,
            ...(hasValue(v.barcode) ? { barcode: v.barcode } : {}),
          },
        })
      );
      ctx.seasonVariantLinks.push({
        seasonEntryId: ctx.colorwayId, // placeholder; resolved to entry id later
        variantId: existing.id,
      });
    } else {
      const id = randomUUID();
      ctx.variantBySku.set(v.sku, { id, barcode: v.barcode });
      ctx.variantCreates.push({
        id,
        colorwayId: ctx.colorwayId,
        variantSku: v.sku,
        barcode: hasValue(v.barcode) ? v.barcode : null,
        sizeLabel,
        dim1,
        dim2,
      });
      ctx.seasonVariantLinks.push({
        seasonEntryId: ctx.colorwayId, // placeholder; resolved later
        variantId: id,
      });
    }
  }

  // Season entry (dropped -> cancelled).
  const existingEntry = ctx.entryIdByColorway.get(ctx.colorwayId);
  if (existingEntry) {
    ctx.entryUpdates.push(
      prisma.seasonEntry.update({
        where: { id: existingEntry },
        data: {
          cancelled: c.dropped,
          approvedForProduction: c.approved_for_production,
        },
      })
    );
  } else {
    ctx.entryCreates.push({
      colorwayId: ctx.colorwayId,
      seasonId: ctx.seasonId,
      cancelled: c.dropped,
      approvedForProduction: c.approved_for_production,
    });
  }

  // Prices + main image (collected; written in bulk after ids settle).
  for (const [currency, p] of Object.entries(c.prices ?? {})) {
    if (typeof p?.msrp === "number")
      ctx.priceRows.push({
        colorwayId: ctx.colorwayId,
        currency,
        priceType: "MSRP",
        amount: p.msrp,
      });
    if (typeof p?.ws === "number")
      ctx.priceRows.push({
        colorwayId: ctx.colorwayId,
        currency,
        priceType: "WHOLESALE",
        amount: p.ws,
      });
  }
  if (ctx.withImages && hasValue(c.image))
    ctx.imageRows.push({ colorwayId: ctx.colorwayId, url: c.image });
}

async function syncPrices(
  seasonId: string,
  rows: Array<{
    colorwayId: string;
    currency: string;
    priceType: "MSRP" | "WHOLESALE";
    amount: number;
  }>
): Promise<number> {
  if (!rows.length) return 0;
  const existing = await prisma.price.findMany({
    where: { seasonId },
    select: { id: true, colorwayId: true, currency: true, priceType: true },
  });
  const key = (r: { colorwayId: string; currency: string; priceType: string }) =>
    `${r.colorwayId}|${r.currency}|${r.priceType}`;
  const idByKey = new Map(existing.map((e) => [key(e), e.id]));

  const creates: Prisma.PriceCreateManyInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const r of rows) {
    const id = idByKey.get(key(r));
    if (id) {
      updates.push(
        prisma.price.update({ where: { id }, data: { amount: r.amount } })
      );
    } else {
      creates.push({
        seasonId,
        colorwayId: r.colorwayId,
        currency: r.currency,
        priceType: r.priceType,
        amount: r.amount,
      });
    }
  }
  if (creates.length) await prisma.price.createMany({ data: creates });
  await runBatched(updates);
  return rows.length;
}

async function syncImages(
  seasonId: string,
  rows: Array<{ colorwayId: string; url: string }>
): Promise<number> {
  if (!rows.length) return 0;
  const existing = await prisma.seasonImage.findMany({
    where: { seasonId, slot: "MAIN" },
    select: { id: true, colorwayId: true },
  });
  const idByColorway = new Map(existing.map((e) => [e.colorwayId, e.id]));
  const creates: Prisma.SeasonImageCreateManyInput[] = [];
  const updates: Prisma.PrismaPromise<unknown>[] = [];
  for (const r of rows) {
    const id = idByColorway.get(r.colorwayId);
    if (id) {
      updates.push(
        prisma.seasonImage.update({ where: { id }, data: { url: r.url } })
      );
    } else {
      creates.push({
        seasonId,
        colorwayId: r.colorwayId,
        slot: "MAIN",
        url: r.url,
      });
    }
  }
  if (creates.length) await prisma.seasonImage.createMany({ data: creates });
  await runBatched(updates);
  return rows.length;
}
