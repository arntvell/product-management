// Loom's Buying planner adds a size to a line of a product Origio already has
// (Paraboot Chambord Lisse Noir gets a 46). Loom must not invent the SKU, so at
// create-POs time it asks Origio to add the size to the existing colourway.
//
// What a size added here is:
//   master only   One Variant row on the colourway, linked to the seasons its
//                 siblings are linked to. No barcode: the supplier's EAN comes
//                 later through PATCH variants/master-data. Nothing is written
//                 to Shopify, Sitoo or Loom, and the colourway's channel
//                 publications are left as they are — a carry-over may be live.
//                 This is NOT applyAddSize (lib/master/add-size.ts): that one
//                 writes to Shopify and Sitoo at once and refuses ad hoc sizes.
//                 Its SKU-stem rule is reused (skuStemFor), so a new size hangs
//                 off the same stem as its siblings.
//   the size      from the colourway's size system (the one add-size picks:
//                 the draft that created it, the brand's default, or one holding
//                 all its sizes). A label that system does not have is REFUSED,
//                 not added as written: Origio's Paraboot Chambord is sized UK
//                 7–11, and an ad hoc "46" beside them would be a size nobody can
//                 sell. Only a colourway no size system fits takes a label as
//                 written (ad hoc, as external-products does), and never a
//                 waist × length one.
//   the SKU       the siblings' stem + the size's token. Refused when the
//                 siblings disagree on a stem or another colourway holds it.
//   idempotent    by construction, on the colourway's own sizes: a size it
//                 already has (same label, or same SKU) is a no-op returned with
//                 its SKU. A repeat of a real call therefore creates nothing and
//                 answers with the same SKUs. No table, so no migration.
//   style         Real call only: the FeedStyle of the WHOLE colourway, every
//                 size with its stable variant_id, built by the same builder as
//                 the registry push to Loom's /api/origio/v1/upsert. Loom applies
//                 it in "full" mode, which drops season sizes a payload leaves
//                 out, so a partial style would delete sizes in Loom.
//
// Loom applies the style to the PLAN's season, and its feed engine writes
// approved_for_production from the payload (absent means false). Loom calls
// this before season-assignments, so the colourway usually has no Origio entry
// in the plan's season yet and the builder would say false. A colourway on a
// locked buying plan is being bought for that season, which is exactly what
// season-assignments is about to record, so the style says approved and not
// dropped. Prices and the image are for `season` when it is sent and absent
// otherwise (Loom keeps what it has; it writes the plan's MSRP itself).
import { prisma } from "@/lib/db";
import { buildVariantSku, normalizeSku, sizeSkuToken } from "@/lib/master/sku";
import { getAddSizeContext, skuStemFor } from "@/lib/master/add-size";
import { displaySizes } from "@/lib/master/size-order";
import { buildLoomPayloadFromColorways, loadColorwaysForLoom, type LoomColorway } from "@/lib/loom/payload";
import { PartnerRequestError } from "./external-products";

export interface ColorwaySizesItem {
  /** Loom's buying line id. */
  loom_key: string;
  colorway_sku: string;
  /** Normalised labels ("42,5" → "42.5"). */
  sizes: string[];
  /** Accepted, not stored: Origio prices a colourway per season, not per size. */
  cost_nok?: number | null;
  msrp_nok?: number | null;
}

export type ColorwaySizesResult =
  | {
      loom_key: string;
      ok: true;
      colorway_sku: string;
      /** Size label as sent → variant SKU, for the sizes asked for. */
      variant_skus: Record<string, string>;
      /** The asked sizes the colourway already had. */
      existing: string[];
      warnings: string[];
      /** Real call only. */
      style?: Record<string, unknown>;
    }
  | { loom_key: string; ok: false; colorway_sku: string; error: string };

// ---------------------------------------------------------------------------
// The colourway and its size system, as the planner sees them
// ---------------------------------------------------------------------------

export interface SizesVariant {
  id: string;
  variantSku: string;
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
}

export interface SizesColorway {
  id: string;
  colorwaySku: string;
  status: string;
  archived: boolean;
  kind: string;
  source: string;
  isLivid: boolean;
  variants: SizesVariant[];
}

export interface SizesSystem {
  name: string;
  entries: Array<{ id: string; sizeLabel: string; dim1: string; dim2: string | null; skuToken: string; archived: boolean }>;
}

export interface PlannedSize {
  /** As Loom sent it. */
  asked: string;
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
  sku: string;
  /** Set when the colourway already has this size. */
  existing: SizesVariant | null;
  adHoc: boolean;
}

export type SizePlan = { ok: false; error: string } | { ok: true; sizes: PlannedSize[]; warnings: string[] };

/** "42,5", " 42.5 " and "42.5" are one size; so are "m" and "M". */
export function sizeKey(label: string): string {
  return label.trim().toUpperCase().replace(/,/g, ".").replace(/\s+/g, " ");
}

/** Why this colourway cannot take a size from Loom, or null. */
export function refusalFor(cw: SizesColorway): string | null {
  if (cw.status === "ARCHIVED" || cw.archived)
    return `${cw.colorwaySku} is archived in Origio; ask Origio to bring it back before it is bought`;
  if (cw.kind !== "MERCHANDISE") return `${cw.colorwaySku} is a ${cw.kind.toLowerCase()} record, not merchandise`;
  if (cw.isLivid || cw.source === "THREADFLOW")
    return "Livid products get their sizes from Threadflow; add the size there";
  return null;
}

/**
 * The sizes to add, without touching the database. Every size or nothing: one
 * refused size refuses the item, so a line is never half-added.
 *
 * `systems` are the colourway's candidate size systems: one when evidence names
 * it (the draft that created the colourway, or the brand's default), every
 * system holding all its sizes when only coverage does. A label any candidate
 * has is taken from the first that has it; refused only when none has it.
 */
export function planColorwaySizes(cw: SizesColorway, systems: SizesSystem[], asked: string[]): SizePlan {
  const refused = refusalFor(cw);
  if (refused) return { ok: false, error: refused };

  const labels: string[] = [];
  const seen = new Set<string>();
  for (const raw of asked) {
    const label = String(raw ?? "").trim();
    if (!label || seen.has(sizeKey(label))) continue;
    seen.add(sizeKey(label));
    labels.push(label);
  }
  if (!labels.length) return { ok: false, error: "no sizes" };

  const system = systems[0] ?? null;
  const live = systems.flatMap((sys) => sys.entries.filter((e) => !e.archived));
  const retired = systems.flatMap((sys) => sys.entries.filter((e) => e.archived).map((e) => ({ ...e, system: sys.name })));
  // First wins: candidates hold every existing size, so they agree on those.
  const tokenByLabel = new Map<string, string>();
  for (const e of live)
    if (!tokenByLabel.has(e.sizeLabel.toUpperCase())) tokenByLabel.set(e.sizeLabel.toUpperCase(), e.skuToken.toUpperCase());
  const twoD = cw.variants.some((v) => v.dim2);
  const bySku = new Map(cw.variants.map((v) => [normalizeSku(v.variantSku), v]));
  const byLabel = new Map(cw.variants.map((v) => [sizeKey(v.sizeLabel), v]));

  let stem: { stem: string | null; note: string | null } | null = null;
  const warnings: string[] = [];
  const sizes: PlannedSize[] = [];
  const adHoc: string[] = [];

  for (const label of labels) {
    const have = byLabel.get(sizeKey(label));
    if (have) {
      sizes.push({ asked: label, sizeLabel: have.sizeLabel, dim1: have.dim1, dim2: have.dim2, sku: have.variantSku, existing: have, adHoc: false });
      continue;
    }

    const entry = live.find((e) => sizeKey(e.sizeLabel) === sizeKey(label));
    const gone = retired.find((e) => sizeKey(e.sizeLabel) === sizeKey(label));
    if (!entry && gone)
      return { ok: false, error: `size ${label} has been retired from Origio's ${gone.system} size system` };
    if (!entry && system) {
      const offered = system.entries.filter((e) => !e.archived);
      return {
        ok: false,
        error:
          (systems.length === 1
            ? `${label} is not a size in Origio's ${system.name} size system, which ${cw.colorwaySku} is sized in`
            : `${label} is not a size in any of the size systems ${cw.colorwaySku} fits (${systems.map((x) => x.name).join(", ")}); ${system.name} has`) +
          ` (${displaySizes(offered, (e) => e.sizeLabel).map((e) => e.sizeLabel).join(", ")}); pick one of those, or ask Origio to add ${label} to the size system`,
      };
    }
    if (!entry && twoD)
      return {
        ok: false,
        error: `${label} is not a size Origio knows for ${cw.colorwaySku}, which is sized waist × length; ask Origio to add it to the size system`,
      };

    stem ??= skuStemFor(cw, tokenByLabel);
    if (!stem.stem)
      return { ok: false, error: `Origio cannot tell which SKU a new size of ${cw.colorwaySku} takes: ${stem.note}` };

    const dim1 = entry?.dim1 ?? label;
    const dim2 = entry?.dim2 ?? null;
    const token = entry?.skuToken ?? sizeSkuToken({ dim1: label });
    const sku = buildVariantSku(stem.stem, token);
    // A size spelled differently from the one the colourway holds under the same SKU.
    const sameSku = bySku.get(normalizeSku(sku));
    if (sameSku) {
      sizes.push({ asked: label, sizeLabel: sameSku.sizeLabel, dim1: sameSku.dim1, dim2: sameSku.dim2, sku: sameSku.variantSku, existing: sameSku, adHoc: false });
      continue;
    }
    if (sizes.some((s) => !s.existing && normalizeSku(s.sku) === normalizeSku(sku)))
      return { ok: false, error: `sizes ${sizes.find((s) => normalizeSku(s.sku) === normalizeSku(sku))!.asked} and ${label} would both be ${sku}` };
    if (!entry) adHoc.push(label);
    sizes.push({ asked: label, sizeLabel: entry?.sizeLabel ?? label, dim1, dim2, sku, existing: null, adHoc: !entry });
  }

  if (stem?.note) warnings.push(stem.note);
  if (adHoc.length)
    warnings.push(`no Origio size system fits ${cw.colorwaySku}; size(s) ${adHoc.join(", ")} added as written`);
  return { ok: true, sizes, warnings };
}

// ---------------------------------------------------------------------------
// The style Loom applies
// ---------------------------------------------------------------------------

/**
 * The whole colourway as a FeedStyle (see the header for why approved / not
 * dropped). Loom's contract also asks for buy_prices; external-products sends
 * them from the season's COST, but this call has no season price to read, and
 * Loom keeps its buy price when the key is absent.
 */
export function sizesFeedStyle(colorways: LoomColorway[], seasonCode: string | null): Record<string, unknown> | undefined {
  if (!colorways.length) return undefined;
  const payload = buildLoomPayloadFromColorways(colorways, seasonCode ?? "");
  const style = payload.styles[0] as unknown as { colorways: Record<string, unknown>[] } & Record<string, unknown>;
  for (const c of style.colorways) {
    c.approved_for_production = true;
    c.dropped = false;
  }
  return style;
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** What the call needs from the database. Faked in the tests: the only database there is, is production. */
export interface ColorwaySizesStore {
  seasonExists(code: string): Promise<boolean>;
  findColorway(sku: string): Promise<SizesColorway | null>;
  /** The candidate size systems, see planColorwaySizes. */
  sizeSystems(cw: SizesColorway): Promise<SizesSystem[]>;
  /** Variants anywhere in the master holding any of these SKUs. */
  skusTaken(skus: string[]): Promise<Array<{ variantSku: string; colorwaySku: string }>>;
  /** One variant per size, linked to the siblings' seasons; all or nothing. */
  createVariants(cw: SizesColorway, sizes: PlannedSize[]): Promise<void>;
  /** The colourway as the Loom payload builder reads it. */
  loadForFeed(colorwayId: string, seasonCode: string | null): Promise<LoomColorway[]>;
}

export async function addColorwaySizes(
  body: { dry_run?: unknown; season?: unknown; items?: unknown },
  store: ColorwaySizesStore = prismaStore
): Promise<{ dryRun: boolean; items: ColorwaySizesResult[] }> {
  const dryRun = body.dry_run !== false;
  if (!Array.isArray(body.items)) throw new PartnerRequestError("items must be an array");
  // Optional: the plan's season, for the style's prices and image.
  const seasonCode = typeof body.season === "string" && body.season.trim() ? body.season.trim().toUpperCase() : null;
  if (seasonCode && !(await store.seasonExists(seasonCode)))
    throw new PartnerRequestError(`Origio has no season ${seasonCode}`);

  const out: ColorwaySizesResult[] = [];
  for (const raw of body.items as ColorwaySizesItem[]) {
    const key = typeof raw?.loom_key === "string" ? raw.loom_key : "";
    const sku = typeof raw?.colorway_sku === "string" ? raw.colorway_sku.trim() : "";
    if (!key) {
      out.push({ loom_key: "", ok: false, colorway_sku: sku, error: "loom_key is missing" });
      continue;
    }
    try {
      out.push(await oneItem(raw, sku, seasonCode, dryRun, store));
    } catch (err) {
      out.push({ loom_key: key, ok: false, colorway_sku: sku, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { dryRun, items: out };
}

async function oneItem(
  item: ColorwaySizesItem,
  asked: string,
  seasonCode: string | null,
  dryRun: boolean,
  store: ColorwaySizesStore
): Promise<ColorwaySizesResult> {
  const key = item.loom_key;
  const fail = (error: string): ColorwaySizesResult => ({ loom_key: key, ok: false, colorway_sku: asked, error });
  if (!asked) return fail("colorway_sku is missing");
  if (!Array.isArray(item.sizes)) return fail("sizes must be a list of size labels");

  const plan = async () => {
    const cw = await store.findColorway(asked);
    if (!cw) return { cw: null, plan: { ok: false, error: `Origio has no colourway ${asked}` } as SizePlan };
    return { cw, plan: planColorwaySizes(cw, await store.sizeSystems(cw), item.sizes) };
  };

  let { cw, plan: p } = await plan();
  if (!p.ok) return fail(p.error);
  const fresh = p.sizes.filter((s) => !s.existing);
  if (fresh.length) {
    // Another colourway only: a racing call may have just added the size here,
    // and that is resolved below by re-reading, not reported as a clash.
    const taken = (await store.skusTaken(fresh.map((s) => s.sku))).filter(
      (t) => normalizeSku(t.colorwaySku) !== normalizeSku(cw!.colorwaySku)
    );
    if (taken.length)
      return fail(taken.map((t) => `collision: ${t.variantSku} exists on ${t.colorwaySku}`).join("; "));
  }

  if (!dryRun && fresh.length) {
    try {
      await store.createVariants(cw!, fresh);
    } catch (err) {
      // Two calls raced on one size: the other created it. Re-read and answer
      // from what is there now; anything still missing is a real failure.
      if ((err as { code?: string })?.code !== "P2002") throw err;
    }
    ({ cw, plan: p } = await plan());
    if (!p.ok) return fail(p.error);
    const missing = p.sizes.filter((s) => !s.existing);
    if (missing.length) return fail(`Origio did not add ${missing.map((s) => s.asked).join(", ")}`);
  }

  const result: ColorwaySizesResult = {
    loom_key: key,
    ok: true,
    colorway_sku: cw!.colorwaySku,
    variant_skus: Object.fromEntries(p.sizes.map((s) => [s.asked, s.sku])),
    // On a real call every size exists by now; report the ones that did before.
    existing: p.sizes.filter((s) => s.existing && !fresh.some((f) => f.asked === s.asked)).map((s) => s.asked),
    warnings: p.warnings,
  };
  if (!dryRun) {
    const style = sizesFeedStyle(await store.loadForFeed(cw!.id, seasonCode), seasonCode);
    if (!style) return fail(`${cw!.colorwaySku} is gone from Origio`);
    result.style = style;
  }
  return result;
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

const colorwaySelect = {
  id: true,
  colorwaySku: true,
  status: true,
  archived: true,
  kind: true,
  source: true,
  brand: { select: { isLivid: true } },
  variants: {
    select: { id: true, variantSku: true, sizeLabel: true, dim1: true, dim2: true },
    orderBy: { createdAt: "asc" as const },
  },
} as const;

export const prismaStore: ColorwaySizesStore = {
  async seasonExists(code) {
    return !!(await prisma.season.findUnique({ where: { code }, select: { id: true } }));
  },

  async findColorway(asked) {
    // As sent first: 170 older SKUs are not in normalised form (mixed case).
    const row =
      (await prisma.colorway.findUnique({ where: { colorwaySku: asked }, select: colorwaySelect })) ??
      (await prisma.colorway.findUnique({ where: { colorwaySku: normalizeSku(asked) }, select: colorwaySelect }));
    if (!row) return null;
    const { brand, ...rest } = row;
    return { ...rest, isLivid: brand?.isLivid === true };
  },

  async sizeSystems(cw) {
    // The add-size flow's ranking: the draft that created the colourway, then the
    // brand's default — either is the answer on its own — else every system that
    // holds all its sizes (getAddSizeContext ranks those only when neither claims).
    const ctx = await getAddSizeContext(cw.id);
    const ranked = ctx?.systems ?? [];
    const evidence = ranked.filter((s) => !/^holds all|^no sizes yet/.test(s.reason));
    const chosen = evidence.length ? evidence.slice(0, 1) : ranked;
    if (!chosen.length) return [];
    const entries = await prisma.sizeSystemEntry.findMany({
      where: { sizeSystemId: { in: chosen.map((s) => s.id) } },
      select: { id: true, sizeSystemId: true, sizeLabel: true, dim1: true, dim2: true, skuToken: true, archived: true },
    });
    return chosen.map((s) => ({ name: s.name, entries: entries.filter((e) => e.sizeSystemId === s.id) }));
  },

  async skusTaken(skus) {
    const rows = await prisma.variant.findMany({
      where: { variantSku: { in: [...new Set(skus.flatMap((s) => [s, normalizeSku(s)]))] } },
      select: { variantSku: true, colorway: { select: { colorwaySku: true } } },
    });
    return rows.map((r) => ({ variantSku: r.variantSku, colorwaySku: r.colorway.colorwaySku }));
  },

  async createVariants(cw, sizes) {
    await prisma.$transaction(
      async (tx) => {
        // Mirror the siblings' season links; with no siblings, every season the
        // colourway is entered in (as applyAddSize does).
        const links = await tx.seasonVariant.findMany({
          where: { variant: { colorwayId: cw.id } },
          select: { seasonEntryId: true },
        });
        const entryIds = links.length
          ? [...new Set(links.map((l) => l.seasonEntryId))]
          : (await tx.seasonEntry.findMany({ where: { colorwayId: cw.id }, select: { id: true } })).map((e) => e.id);
        for (const s of sizes) {
          const v = await tx.variant.create({
            data: {
              colorwayId: cw.id,
              variantSku: normalizeSku(s.sku),
              barcode: null,
              sizeLabel: s.sizeLabel,
              dim1: s.dim1,
              dim2: s.dim2,
            },
            select: { id: true },
          });
          if (entryIds.length)
            await tx.seasonVariant.createMany({
              data: entryIds.map((seasonEntryId) => ({ seasonEntryId, variantId: v.id })),
              skipDuplicates: true,
            });
        }
      },
      { timeout: 20_000, maxWait: 5_000 }
    );
  },

  async loadForFeed(colorwayId, seasonCode) {
    // No season: a code no season has, so prices, entry and image come back
    // empty and Loom keeps what it holds for them.
    return loadColorwaysForLoom([colorwayId], seasonCode ?? "");
  },
};
