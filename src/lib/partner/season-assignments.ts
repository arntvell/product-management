// Loom's Buying planner, at plan lock, for products Origio already has: put
// each colourway in the plan's season and set the plan's MSRP as that season's
// retail price.
//
// How Origio models it (the same rows finalize.ts writes for a new product):
//   SeasonEntry   (colorway × season): membership. A new entry is CARRYOVER,
//                 approved for production, its origin locked MANUAL so the
//                 classify pass does not flip it. An entry that is already there
//                 keeps its origin: a product created NEW in this season stays
//                 NEW.
//   SeasonVariant the entry's sizes, linked as finalize links them.
//   Price         (season × colorway × NOK × MSRP), upserted to msrp_nok;
//                 COST likewise when cost_nok is sent. Other seasons' prices
//                 are not touched.
//
// Nothing is pushed. The next channel push for this season sends the season's
// MSRP: the Loom registry and the Shopify publish both read prices filtered to
// the batch's season.
//
// Refused: Livid colourways (Threadflow owns their seasons and prices), archived
// colourways (bring them back in Origio first, so the channels agree), and a
// season that is not REGULAR.
import { prisma } from "@/lib/db";
import { normalizeSku } from "@/lib/master/sku";
import { PartnerRequestError } from "./external-products";

export interface SeasonAssignmentItem {
  loom_key: string;
  colorway_sku: string;
  msrp_nok: number;
  cost_nok?: number | null;
}

export type SeasonAssignmentResult =
  | {
      loom_key: string;
      ok: true;
      colorway_sku: string;
      /** Was it in the season before this call? */
      already_in_season: boolean;
      /** The season's NOK MSRP before this call, if it had one. */
      previous_msrp_nok: number | null;
      warnings: string[];
    }
  | { loom_key: string; ok: false; colorway_sku: string; error: string };

export async function assignToSeason(body: {
  dry_run?: unknown;
  season?: unknown;
  items?: unknown;
}): Promise<{ dryRun: boolean; items: SeasonAssignmentResult[] }> {
  const dryRun = body.dry_run !== false;
  const seasonCode = typeof body.season === "string" ? body.season.trim().toUpperCase() : "";
  if (!seasonCode) throw new PartnerRequestError("season is required");
  if (!Array.isArray(body.items)) throw new PartnerRequestError("items must be an array");
  const season = await prisma.season.findUnique({
    where: { code: seasonCode },
    select: { id: true, code: true, kind: true },
  });
  if (!season) throw new PartnerRequestError(`Origio has no season ${seasonCode}`);
  if (season.kind !== "REGULAR")
    throw new PartnerRequestError(`${seasonCode} is not a regular season; Origio does not carry products into it`);

  const out: SeasonAssignmentResult[] = [];
  for (const raw of body.items as SeasonAssignmentItem[]) {
    const key = typeof raw?.loom_key === "string" ? raw.loom_key : "";
    const sku = typeof raw?.colorway_sku === "string" ? raw.colorway_sku : "";
    if (!key) {
      out.push({ loom_key: "", ok: false, colorway_sku: sku, error: "loom_key is missing" });
      continue;
    }
    try {
      out.push(await oneItem(raw, season, dryRun));
    } catch (err) {
      out.push({ loom_key: key, ok: false, colorway_sku: sku, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { dryRun, items: out };
}

/** Validation alone, so it is tested without a database. */
export function checkAmounts(item: { msrp_nok: unknown; cost_nok?: unknown }): string | null {
  if (typeof item.msrp_nok !== "number" || !Number.isFinite(item.msrp_nok) || item.msrp_nok <= 0)
    return "msrp_nok must be a positive number";
  if (item.cost_nok != null && (typeof item.cost_nok !== "number" || !Number.isFinite(item.cost_nok) || item.cost_nok < 0))
    return "cost_nok must be a number of 0 or more";
  return null;
}

async function oneItem(
  item: SeasonAssignmentItem,
  season: { id: string; code: string },
  dryRun: boolean
): Promise<SeasonAssignmentResult> {
  const key = item.loom_key;
  const asked = (item.colorway_sku ?? "").trim();
  const fail = (error: string): SeasonAssignmentResult => ({ loom_key: key, ok: false, colorway_sku: asked, error });
  if (!asked) return fail("colorway_sku is missing");
  const bad = checkAmounts(item);
  if (bad) return fail(bad);

  const cw = await prisma.colorway.findUnique({
    where: { colorwaySku: normalizeSku(asked) },
    select: {
      id: true,
      colorwaySku: true,
      status: true,
      archived: true,
      brand: { select: { name: true, isLivid: true } },
      entries: { where: { seasonId: season.id }, select: { id: true, cancelled: true, origin: true } },
      prices: {
        where: { seasonId: season.id, currency: "NOK", priceType: { in: ["MSRP", "COST"] } },
        select: { priceType: true, amount: true },
      },
      variants: { select: { id: true } },
    },
  });
  if (!cw) return fail(`Origio has no colourway ${asked}`);
  if (cw.brand?.isLivid)
    return fail("Livid products get their seasons and prices from Threadflow, not from Loom");
  if (cw.status === "ARCHIVED" || cw.archived)
    return fail(`${cw.colorwaySku} is archived in Origio; ask Origio to bring it back before it is bought`);

  const entry = cw.entries[0] ?? null;
  const msrpBefore = cw.prices.find((p) => p.priceType === "MSRP");
  const costBefore = cw.prices.find((p) => p.priceType === "COST");
  const msrp = Number(item.msrp_nok.toFixed(2));
  const cost = item.cost_nok != null ? Number(item.cost_nok.toFixed(2)) : null;

  const warnings: string[] = [];
  if (entry?.cancelled) warnings.push(`was dropped from ${season.code}; ${dryRun ? "would be" : "is"} restored`);
  if (msrpBefore && Number(msrpBefore.amount) !== msrp)
    warnings.push(`${season.code} MSRP ${Number(msrpBefore.amount)} ${dryRun ? "would be" : "is"} replaced by ${msrp}`);
  if (!cw.variants.length) warnings.push(`${cw.colorwaySku} has no sizes in Origio`);

  const result: SeasonAssignmentResult = {
    loom_key: key,
    ok: true,
    colorway_sku: cw.colorwaySku,
    already_in_season: !!entry,
    previous_msrp_nok: msrpBefore ? Number(msrpBefore.amount) : null,
    warnings,
  };
  if (dryRun) return result;

  const unchanged =
    entry &&
    !entry.cancelled &&
    msrpBefore &&
    Number(msrpBefore.amount) === msrp &&
    (cost == null || (costBefore && Number(costBefore.amount) === cost));
  if (unchanged) return result; // a repeat: nothing to write

  await prisma.$transaction(async (tx) => {
    let entryId = entry?.id;
    if (!entryId) {
      const e = await tx.seasonEntry.create({
        data: { colorwayId: cw.id, seasonId: season.id, origin: "CARRYOVER", approvedForProduction: true },
        select: { id: true },
      });
      entryId = e.id;
      // A buyer's decision must survive the automatic classify pass.
      await tx.fieldOwner.upsert({
        where: { entityType_entityId_field: { entityType: "seasonEntry", entityId: entryId, field: "origin" } },
        create: {
          entityType: "seasonEntry",
          entityId: entryId,
          field: "origin",
          owner: "MANUAL",
          lockedAt: new Date(),
          authority: "loom:buying-plan",
        },
        update: { owner: "MANUAL", lockedAt: new Date(), authority: "loom:buying-plan" },
      });
    } else if (entry?.cancelled) {
      await tx.seasonEntry.update({ where: { id: entryId }, data: { cancelled: false } });
    }
    if (cw.variants.length)
      await tx.seasonVariant.createMany({
        data: cw.variants.map((v) => ({ seasonEntryId: entryId!, variantId: v.id })),
        skipDuplicates: true,
      });
    const prices: ["MSRP" | "COST", number][] = [["MSRP", msrp]];
    if (cost != null) prices.push(["COST", cost]);
    for (const [priceType, amount] of prices)
      await tx.price.upsert({
        where: {
          seasonId_colorwayId_currency_priceType: { seasonId: season.id, colorwayId: cw.id, currency: "NOK", priceType },
        },
        create: { seasonId: season.id, colorwayId: cw.id, currency: "NOK", priceType, amount },
        update: { amount },
      });
  });
  return result;
}
