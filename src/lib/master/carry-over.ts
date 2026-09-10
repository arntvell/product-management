// Carrying products into a season, as a deliberate bulk action.
//
// This replaces a per-row button that wrote immediately to whatever season a
// page-level selector happened to be set to. Two things made that dangerous:
// the target lived far from the control, and the write was silent — a carried
// product enters the season with NO price for it, because Price is a separate
// per-season row and nothing copies it. The product then looks fine in every
// list and fails at push time with "no <season> pricing".
//
// So: preview first, act second, and say what will be incomplete afterwards.
// Prices are not carried by default — carry-overs are repriced per season per
// product, so the hole is the signal rather than something to paper over. But
// when last season's price IS the right answer, retyping it is busywork: pass
// `carryPrices` and the same action fills the gap it just reported.
import { prisma } from "@/lib/db";
import { runCarryPrices } from "./carry-prices";

export interface CarryOverPreview {
  seasonCode: string;
  requested: number;
  /** Already in the season — the action is a no-op for these. */
  alreadyIn: number;
  /** Not in the season yet; these gain a CARRYOVER entry. */
  wouldAdd: number;
  /**
   * Of everything that would be in the season afterwards, how many have no
   * MSRP price for it. These are the ones that cannot be pushed until priced.
   */
  wouldLackPrice: number;
  /** A readable sample of the unpriced ones, for the confirmation dialog. */
  unpricedSample: { id: string; colorwaySku: string; name: string }[];
  /** Products that are priced in another season, so carry-forward could fill them. */
  pricedElsewhere: number;
}

async function resolveSeason(seasonCode: string) {
  const season = await prisma.season.findUnique({
    where: { code: seasonCode },
    select: { id: true, code: true, kind: true },
  });
  if (!season) throw new Error(`Unknown season ${seasonCode}`);
  if (season.kind !== "REGULAR")
    throw new Error(
      `${seasonCode} is not a regular season — products are not carried into ${season.kind.toLowerCase()} pools.`
    );
  return season;
}

export async function previewCarryOver(
  colorwayIds: string[],
  seasonCode: string
): Promise<CarryOverPreview> {
  const season = await resolveSeason(seasonCode);
  const ids = [...new Set(colorwayIds)].filter(Boolean);

  const rows = await prisma.colorway.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      entries: { where: { seasonId: season.id }, select: { id: true } },
      prices: {
        where: { priceType: "MSRP" },
        select: { seasonId: true },
      },
    },
  });

  let alreadyIn = 0;
  let wouldAdd = 0;
  let wouldLackPrice = 0;
  let pricedElsewhere = 0;
  const unpricedSample: CarryOverPreview["unpricedSample"] = [];

  for (const r of rows) {
    if (r.entries.length) alreadyIn++;
    else wouldAdd++;

    const hasSeasonPrice = r.prices.some((p) => p.seasonId === season.id);
    if (!hasSeasonPrice) {
      wouldLackPrice++;
      if (r.prices.length) pricedElsewhere++;
      if (unpricedSample.length < 8)
        unpricedSample.push({ id: r.id, colorwaySku: r.colorwaySku, name: r.name });
    }
  }

  return {
    seasonCode: season.code,
    requested: rows.length,
    alreadyIn,
    wouldAdd,
    wouldLackPrice,
    unpricedSample,
    pricedElsewhere,
  };
}

export interface CarryOverResult extends CarryOverPreview {
  added: number;
  /** Price rows created, when `carryPrices` was asked for. */
  pricesCopied: number;
  /** Which season each price came from, e.g. { CONTINUITY: 3 }. */
  pricesFrom: Record<string, number>;
}

export async function applyCarryOver(
  colorwayIds: string[],
  seasonCode: string,
  opts: { carryPrices?: boolean } = {}
): Promise<CarryOverResult> {
  const preview = await previewCarryOver(colorwayIds, seasonCode);
  const season = await resolveSeason(seasonCode);
  const ids = [...new Set(colorwayIds)].filter(Boolean);

  let added = 0;
  for (const colorwayId of ids) {
    const entry = await prisma.seasonEntry.upsert({
      where: { colorwayId_seasonId: { colorwayId, seasonId: season.id } },
      create: { colorwayId, seasonId: season.id, origin: "CARRYOVER" },
      update: { origin: "CARRYOVER" },
      select: { id: true },
    });
    // A manual decision must survive the automatic classify pass.
    await prisma.fieldOwner.upsert({
      where: {
        entityType_entityId_field: {
          entityType: "seasonEntry",
          entityId: entry.id,
          field: "origin",
        },
      },
      create: {
        entityType: "seasonEntry",
        entityId: entry.id,
        field: "origin",
        owner: "MANUAL",
        lockedAt: new Date(),
      },
      update: { owner: "MANUAL", lockedAt: new Date() },
    });
    added++;
  }

  // Optional, and only after the entries exist: carry-prices copies from the
  // newest season where each product is actually priced, and never overwrites
  // a price the target season already has.
  let pricesCopied = 0;
  let pricesFrom: Record<string, number> = {};
  if (opts.carryPrices) {
    const res = await runCarryPrices({ seasonCode, colorwayIds: ids });
    pricesCopied = res.rowsToCreate;
    pricesFrom = res.bySourceSeason;
  }

  return { ...preview, added, pricesCopied, pricesFrom };
}

/** Take products back OUT of a season (the undo for the action above). */
export async function removeFromSeason(
  colorwayIds: string[],
  seasonCode: string
): Promise<{ removed: number }> {
  const season = await resolveSeason(seasonCode);
  const ids = [...new Set(colorwayIds)].filter(Boolean);

  const entries = await prisma.seasonEntry.findMany({
    where: { seasonId: season.id, colorwayId: { in: ids } },
    select: { id: true },
  });
  if (!entries.length) return { removed: 0 };

  const entryIds = entries.map((e) => e.id);
  await prisma.fieldOwner.deleteMany({
    where: { entityType: "seasonEntry", entityId: { in: entryIds }, field: "origin" },
  });
  await prisma.seasonEntry.deleteMany({ where: { id: { in: entryIds } } });
  return { removed: entries.length };
}
