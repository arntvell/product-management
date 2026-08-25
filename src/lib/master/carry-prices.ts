// Carry prices forward into a season.
//
// Prices are scoped to (season × colorway × currency × type). A product pulled
// forward from an older season — a carry-over, or a CORE line that has always
// lived in CONTINUITY — therefore has no price in the season being pushed, and
// the Loom readiness gate blocks it even though the product is priced.
//
// This copies the prices from the newest season where the product IS priced
// into the target season. Non-destructive: never touches a price the target
// season already has, so a real seasonal price always wins over a carried one.
import { prisma } from "@/lib/db";

export interface CarryPricesOptions {
  seasonCode: string;
  includeCore?: boolean;
  vendors?: string[];
}

export interface CarriedPrice {
  colorwayId: string;
  colorwaySku: string;
  name: string;
  fromSeason: string;
  copied: { currency: string; priceType: string; amount: string }[];
}

export interface CarryPricesPreview {
  targetSeason: string;
  candidates: number; // in scope
  alreadyPriced: number;
  wouldCarry: number; // products gaining prices
  noSourcePrice: number; // priced nowhere — nothing to carry
  rowsToCreate: number;
  bySourceSeason: Record<string, number>;
  sample: CarriedPrice[];
}

async function collect(opts: CarryPricesOptions): Promise<{
  preview: CarryPricesPreview;
  carried: CarriedPrice[];
  targetSeasonId: string;
}> {
  const target = await prisma.season.findUnique({
    where: { code: opts.seasonCode },
    select: { id: true, code: true },
  });
  if (!target) throw new Error(`Unknown season ${opts.seasonCode}`);

  const seasons = await prisma.season.findMany({
    select: { id: true, code: true, sortOrder: true },
  });
  const order = new Map(seasons.map((s) => [s.id, s.sortOrder]));
  const codeById = new Map(seasons.map((s) => [s.id, s.code]));

  const inSeason = { entries: { some: { seasonId: target.id } } };
  const where: Record<string, unknown> = {
    OR: opts.includeCore ? [inSeason, { isCore: true }] : [inSeason],
  };
  if (opts.vendors?.length) where.vendor = { in: opts.vendors };

  const colorways = await prisma.colorway.findMany({
    where,
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      prices: { select: { seasonId: true, currency: true, priceType: true, amount: true } },
    },
  });

  const carried: CarriedPrice[] = [];
  const bySourceSeason: Record<string, number> = {};
  let alreadyPriced = 0;
  let noSourcePrice = 0;
  let rowsToCreate = 0;

  for (const cw of colorways) {
    const hasTargetMsrp = cw.prices.some(
      (p) => p.seasonId === target.id && p.priceType === "MSRP"
    );
    if (hasTargetMsrp) {
      alreadyPriced++;
      continue;
    }
    // Newest season that actually has an MSRP for this product.
    const sources = cw.prices.filter((p) => p.seasonId !== target.id);
    const withMsrp = new Set(
      sources.filter((p) => p.priceType === "MSRP").map((p) => p.seasonId)
    );
    if (!withMsrp.size) {
      noSourcePrice++;
      continue;
    }
    let bestId = "";
    let bestOrder = -Infinity;
    for (const sid of withMsrp) {
      const o = order.get(sid) ?? -Infinity;
      if (o > bestOrder) {
        bestOrder = o;
        bestId = sid;
      }
    }
    // Don't overwrite whatever the target season already has (e.g. a
    // wholesale-only row); copy the rest.
    const existing = new Set(
      cw.prices
        .filter((p) => p.seasonId === target.id)
        .map((p) => `${p.currency}|${p.priceType}`)
    );
    const copied = sources
      .filter((p) => p.seasonId === bestId && !existing.has(`${p.currency}|${p.priceType}`))
      .map((p) => ({
        currency: p.currency,
        priceType: String(p.priceType),
        amount: p.amount.toString(),
      }));
    if (!copied.length) continue;

    const fromSeason = codeById.get(bestId) ?? bestId;
    bySourceSeason[fromSeason] = (bySourceSeason[fromSeason] ?? 0) + 1;
    rowsToCreate += copied.length;
    carried.push({
      colorwayId: cw.id,
      colorwaySku: cw.colorwaySku,
      name: cw.name,
      fromSeason,
      copied,
    });
  }

  return {
    preview: {
      targetSeason: target.code,
      candidates: colorways.length,
      alreadyPriced,
      wouldCarry: carried.length,
      noSourcePrice,
      rowsToCreate,
      bySourceSeason,
      sample: carried.slice(0, 20),
    },
    carried,
    targetSeasonId: target.id,
  };
}

export async function previewCarryPrices(
  opts: CarryPricesOptions
): Promise<CarryPricesPreview> {
  const { preview } = await collect(opts);
  return preview;
}

export interface CarryPricesResult extends CarryPricesPreview {
  rowsCreated: number;
}

export async function runCarryPrices(
  opts: CarryPricesOptions
): Promise<CarryPricesResult> {
  const { preview, carried, targetSeasonId } = await collect(opts);

  const data = carried.flatMap((c) =>
    c.copied.map((p) => ({
      seasonId: targetSeasonId,
      colorwayId: c.colorwayId,
      currency: p.currency,
      priceType: p.priceType as "MSRP" | "WHOLESALE",
      amount: p.amount,
    }))
  );

  let rowsCreated = 0;
  const CHUNK = 500;
  for (let i = 0; i < data.length; i += CHUNK) {
    const res = await prisma.price.createMany({
      data: data.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    rowsCreated += res.count;
  }

  return { ...preview, rowsCreated };
}
