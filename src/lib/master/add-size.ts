// Adding a size to a product that already exists — the third way into
// /catalog/products/new, beside the wizard and the importer.
//
// Those two create a style and its colourways from nothing. This one adds one
// or more sizes to a colourway that is already in the master and, usually,
// already on sale: Shopify has the product, Sitoo has the till rows, Loom has
// the stock registry. So it is not a draft. There is nothing to review across
// steps and no ids to reserve; the colourway exists, and the new variant is one
// row plus its channel copies.
//
// THE THREE RULES THAT MAKE IT SAFE
//
//   The size comes from the product's size system. Variant has no foreign key
//   to SizeSystemEntry — sizes are plain strings — so "the same system" is
//   inferred: the one the draft that created the colourway used, else the
//   brand's default, else any system that already holds every existing size.
//   No free text: a size the system does not know is added to the system
//   first (the Hestra 10.5 lesson), so the next import can use it too.
//
//   The SKU follows the structure. variantSku === colorwaySku + "-" + skuToken
//   is relied on by pio.ts, cin7/import.ts and normalize-size-labels.ts. The new
//   SKU is derived, never typed, and if the existing sizes do not follow one
//   stem the add is refused rather than guessed.
//
//   Each channel gets a narrow write. Shopify gets one productVariantsBulkCreate
//   on the live product (shopify/add-variant.ts), Sitoo one product joined to
//   the existing family (sitoo/add-variant.ts), and Loom a re-send of the
//   colourway in mode "data", which is how Loom learns a new size. Nothing
//   re-pushes the colourway's title, description or prices to Shopify or Sitoo.
//
// Apply is idempotent by construction, so "retry" is "run it again": a variant
// that already exists is not created twice, and a channel whose link row is
// already there is not written twice.

import { prisma } from "@/lib/db";
import { buildVariantSku, normalizeSku, sizeSkuToken } from "./sku";
import { canonical, rejectionReason, recordIssued } from "./barcode";
import { recordDecisions } from "./provenance";
import { parseDraftPayload } from "./draft-payload";
import { channelProductTitle } from "./channel-title";
import { displaySizes } from "./size-order";
import { declareChannel } from "./channel-membership";
import { loomScope, type LoomGroup } from "./variant-barcodes";
import { pushColorwaysToLoom } from "@/lib/loom/push";
import {
  planShopifyAddSize,
  applyShopifyAddSize,
  type ShopifyAddSizeInput,
} from "@/lib/shopify/add-variant";
import { planSitooAddSize, applySitooAddSize, type SitooAddSizeInput } from "@/lib/sitoo/add-variant";
import type { SizeSystemKind } from "@/generated/prisma/enums";

/** Recorded on FieldOwner for every barcode this flow writes. */
export const ADD_SIZE_AUTHORITY = "manual:add-size";

// ---------------------------------------------------------------------------
// Finding the product
// ---------------------------------------------------------------------------

export interface AddSizeSearchRow {
  colorwayId: string;
  colorwaySku: string;
  /** "Style Colour" — an imported colourway is named by its colour alone. */
  title: string;
  brand: string | null;
  category: string | null;
  sizes: string[];
  seasons: string[];
  status: string;
  shopify: boolean;
  sitoo: boolean;
  loom: boolean;
}

export interface AddSizeSearchOptions {
  q?: string;
  brandId?: string;
  categoryId?: string;
  limit?: number;
}

/**
 * External brands only, like the rest of /catalog/products/new: Livid product
 * arrives through the Threadflow feed, which owns its nesting and would never
 * know about a size added here.
 */
export async function searchColorwaysForAddSize(
  opts: AddSizeSearchOptions
): Promise<{ rows: AddSizeSearchRow[]; truncated: boolean }> {
  const q = opts.q?.trim() ?? "";
  if (!q && !opts.brandId && !opts.categoryId) return { rows: [], truncated: false };
  const limit = opts.limit ?? 60;

  const words = q.split(/\s+/).filter(Boolean);
  const cws = await prisma.colorway.findMany({
    where: {
      source: { not: "THREADFLOW" },
      status: { not: "ARCHIVED" },
      kind: "MERCHANDISE",
      NOT: { brand: { isLivid: true } },
      ...(opts.brandId ? { brandId: opts.brandId } : {}),
      ...(opts.categoryId
        ? { OR: [{ categoryId: opts.categoryId }, { categoryId: null, style: { categoryId: opts.categoryId } }] }
        : {}),
      // Every word must match somewhere, so "hestra robert" narrows rather than widens.
      AND: words.map((w) => ({
        OR: [
          { name: { contains: w, mode: "insensitive" as const } },
          { colorwaySku: { contains: w, mode: "insensitive" as const } },
          { style: { styleName: { contains: w, mode: "insensitive" as const } } },
          { brand: { name: { contains: w, mode: "insensitive" as const } } },
          { variants: { some: { variantSku: { contains: w, mode: "insensitive" as const } } } },
          { variants: { some: { barcode: w } } },
        ],
      })),
    },
    orderBy: [{ style: { styleName: "asc" } }, { name: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      status: true,
      style: { select: { styleName: true, categoryRef: { select: { name: true } } } },
      brand: { select: { name: true } },
      categoryRef: { select: { name: true } },
      variants: {
        select: { sizeLabel: true, createdAt: true, channelRefs: { select: { channel: true } } },
        orderBy: { createdAt: "asc" },
      },
      entries: { select: { season: { select: { code: true } } } },
      publications: { select: { channel: true, published: true, externalId: true } },
    },
  });

  const rows = cws.slice(0, limit).map((c) => ({
    colorwayId: c.id,
    colorwaySku: c.colorwaySku,
    title: channelProductTitle(c),
    brand: c.brand?.name ?? null,
    category: c.categoryRef?.name ?? c.style.categoryRef?.name ?? null,
    sizes: displaySizes(c.variants.map((v) => v.sizeLabel), (l) => l),
    seasons: c.entries.map((e) => e.season.code),
    status: c.status,
    shopify:
      c.publications.some((p) => p.channel === "SHOPIFY" && p.externalId) ||
      c.variants.some((v) => v.channelRefs.some((r) => r.channel === "SHOPIFY")),
    sitoo: c.variants.some((v) => v.channelRefs.some((r) => r.channel === "SITOO")),
    loom: c.publications.some((p) => p.channel === "LOOM" && p.published),
  }));
  return { rows, truncated: cws.length > limit };
}

// ---------------------------------------------------------------------------
// The product's size system, and the SKU a new size would take
// ---------------------------------------------------------------------------

export interface AddSizeOption {
  entryId: string;
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
  skuToken: string;
  /** The SKU this size would get. */
  sku: string;
  /** Already held by some variant — offered, but it will be refused. */
  taken: string | null;
}

export interface AddSizeSystem {
  id: string;
  name: string;
  kind: SizeSystemKind;
  /** Why this system is believed to be the product's. */
  reason: string;
  options: AddSizeOption[];
  /** The stem new SKUs hang off. Null when the existing sizes do not agree on one. */
  skuStem: string | null;
  skuNote: string | null;
}

export interface AddSizeContext {
  colorway: {
    id: string;
    colorwaySku: string;
    title: string;
    brand: string | null;
    category: string | null;
    status: string;
    seasons: string[];
  };
  variants: Array<{
    id: string;
    sizeLabel: string;
    variantSku: string;
    barcode: string | null;
    shopify: boolean;
    sitoo: boolean;
  }>;
  channels: { shopify: boolean; sitoo: boolean; loom: boolean; loomSeasons: string[] };
  systems: AddSizeSystem[];
  /** Set when no size system can be the product's. */
  refusal: string | null;
}

async function loadColorway(colorwayId: string) {
  return prisma.colorway.findUnique({
    where: { id: colorwayId },
    include: {
      style: { include: { categoryRef: true } },
      brand: { include: { template: { select: { defaultSizeSystemId: true } } } },
      categoryRef: true,
      variants: { include: { channelRefs: true, seasonLinks: true }, orderBy: { createdAt: "asc" } },
      entries: { include: { season: true } },
      prices: { include: { season: true } },
      publications: true,
    },
  });
}
type LoadedColorway = NonNullable<Awaited<ReturnType<typeof loadColorway>>>;

function refusalFor(cw: LoadedColorway): string | null {
  if (cw.source === "THREADFLOW" || cw.brand?.isLivid)
    return "Livid product arrives through the Threadflow feed — add the size in Threadflow.";
  if (cw.status === "ARCHIVED") return "This colourway is archived.";
  if (cw.kind !== "MERCHANDISE") return `This is a ${cw.kind.toLowerCase()} record, not merchandise.`;
  return null;
}

/** The size system the draft that created this colourway used, if one did. */
async function draftSizeSystemId(cw: LoadedColorway): Promise<string | null> {
  const drafts = await prisma.productDraft.findMany({
    where: { createdColorwayIds: { has: cw.id } },
    select: { payload: true },
  });
  for (const d of drafts) {
    try {
      const p = parseDraftPayload(d.payload);
      const hit = p.colorways.find((c) => normalizeSku(c.colorwaySku) === normalizeSku(cw.colorwaySku));
      if (hit?.sizeSystemId) return hit.sizeSystemId;
    } catch {
      /* an unparseable old draft simply offers no hint */
    }
  }
  return null;
}

/**
 * One stem for the new SKU, or a reason there isn't one.
 *
 * The expected shape is colorwaySku + "-" + token. Imported colourways drift
 * from it — a Cin7 re-nest can leave the colourway renamed while its variants
 * keep their old stem — so a common stem the siblings DO agree on is accepted,
 * with a note, and disagreement is refused.
 */
function skuStemFor(
  cw: LoadedColorway,
  tokenByLabel: Map<string, string>
): { stem: string | null; note: string | null } {
  if (!cw.variants.length) return { stem: normalizeSku(cw.colorwaySku), note: null };

  const stems = new Set<string>();
  const unplaced: string[] = [];
  for (const v of cw.variants) {
    // A size added outside the system still spells its token the standard way.
    const token = tokenByLabel.get(v.sizeLabel.toUpperCase()) ?? sizeSkuToken(v).toUpperCase();
    const sku = normalizeSku(v.variantSku);
    if (!token || !sku.endsWith(`-${token}`)) {
      unplaced.push(v.variantSku);
      continue;
    }
    stems.add(sku.slice(0, -(token.length + 1)));
  }
  if (unplaced.length)
    return {
      stem: null,
      note: `${unplaced.join(", ")} ${unplaced.length === 1 ? "does" : "do"} not end in ${unplaced.length === 1 ? "its" : "their"} size token, so the SKU a new size should take cannot be read off the siblings.`,
    };
  if (stems.size > 1)
    return { stem: null, note: `The existing sizes use ${stems.size} different SKU stems (${[...stems].join(", ")}).` };
  const stem = [...stems][0];
  if (stem !== normalizeSku(cw.colorwaySku))
    return {
      stem,
      note: `The existing sizes hang off ${stem}, not the colourway SKU ${cw.colorwaySku}; the new size follows its siblings.`,
    };
  return { stem, note: null };
}

export async function getAddSizeContext(colorwayId: string): Promise<AddSizeContext | null> {
  const cw = await loadColorway(colorwayId);
  if (!cw) return null;

  const labels = cw.variants.map((v) => v.sizeLabel.toUpperCase());
  const twoD = cw.variants.some((v) => v.dim2);
  const [systems, fromDraft] = await Promise.all([
    prisma.sizeSystem.findMany({
      where: { archived: false },
      include: { entries: { orderBy: { position: "asc" } } },
      orderBy: { name: "asc" },
    }),
    draftSizeSystemId(cw),
  ]);
  const brandDefault = cw.brand?.template?.defaultSizeSystemId ?? null;

  const kindFits = (s: (typeof systems)[number]) => !cw.variants.length || (s.kind === "TWO_D") === twoD;
  const missingFrom = (s: (typeof systems)[number]) => {
    const known = new Set(s.entries.map((e) => e.sizeLabel.toUpperCase()));
    return cw.variants.filter((v) => !known.has(v.sizeLabel.toUpperCase())).map((v) => v.sizeLabel);
  };

  // Evidence first: the draft that created the colourway, then the brand's
  // default. Either keeps its claim when a size was later added outside it —
  // Hestra Robert Toffee's 10.5 is not in Gloves, and dropping Gloves for that
  // made "any system holding all four sizes" the answer, which was UK Shoes.
  // Coverage alone is only the fallback when there is no evidence at all.
  const ranked: Array<{ s: (typeof systems)[number]; reason: string; outside: string[] }> = [];
  const claim = (id: string | null, reason: string) => {
    const s = systems.find((x) => x.id === id);
    if (!s || !kindFits(s) || ranked.some((r) => r.s.id === s.id)) return;
    const outside = missingFrom(s);
    // A system holding none of the product's sizes is not its system, whatever the record says.
    if (cw.variants.length && outside.length === cw.variants.length) return;
    ranked.push({ s, reason, outside });
  };
  claim(fromDraft, "used by the draft that created this colourway");
  claim(brandDefault, `${cw.brand?.name}'s default size system`);
  if (!ranked.length)
    for (const s of systems)
      if (kindFits(s) && !missingFrom(s).length)
        ranked.push({
          s,
          reason: cw.variants.length ? `holds all ${cw.variants.length} existing sizes` : "no sizes yet",
          outside: [],
        });

  const out: AddSizeSystem[] = [];
  for (const { s, reason, outside } of ranked) {
    const tokenByLabel = new Map(s.entries.map((e) => [e.sizeLabel.toUpperCase(), e.skuToken.toUpperCase()]));
    const { stem, note: stemNote } = skuStemFor(cw, tokenByLabel);
    const note =
      [
        outside.length
          ? `${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} on the product but not in ${s.name}` +
            " — added outside the system; it stays where it is."
          : null,
        stemNote,
      ]
        .filter(Boolean)
        .join(" ") || null;
    const have = new Set(labels);
    const offered = s.entries.filter((e) => !e.archived && !have.has(e.sizeLabel.toUpperCase()));
    const skus = stem ? offered.map((e) => buildVariantSku(stem, e.skuToken)) : [];
    const taken = skus.length
      ? await prisma.variant.findMany({
          where: { variantSku: { in: skus } },
          select: { variantSku: true, colorway: { select: { colorwaySku: true } } },
        })
      : [];
    const takenBy = new Map(taken.map((t) => [normalizeSku(t.variantSku), t.colorway.colorwaySku]));
    out.push({
      id: s.id,
      name: s.name,
      kind: s.kind,
      reason,
      skuStem: stem,
      skuNote: note,
      options: displaySizes(offered, (e) => e.sizeLabel).map((e) => {
        const sku = stem ? buildVariantSku(stem, e.skuToken) : "";
        return {
          entryId: e.id,
          sizeLabel: e.sizeLabel,
          dim1: e.dim1,
          dim2: e.dim2,
          skuToken: e.skuToken,
          sku,
          taken: sku ? (takenBy.get(normalizeSku(sku)) ?? null) : null,
        };
      }),
    });
  }

  const refused = refusalFor(cw);
  const loomSeasons = cw.publications.some((p) => p.channel === "LOOM" && p.published)
    ? cw.entries.map((e) => e.season.code)
    : [];
  return {
    colorway: {
      id: cw.id,
      colorwaySku: cw.colorwaySku,
      title: channelProductTitle(cw),
      brand: cw.brand?.name ?? null,
      category: cw.categoryRef?.name ?? cw.style.categoryRef?.name ?? null,
      status: cw.status,
      seasons: cw.entries.map((e) => e.season.code),
    },
    variants: displaySizes(cw.variants, (v) => v.sizeLabel).map((v) => ({
      id: v.id,
      sizeLabel: v.sizeLabel,
      variantSku: v.variantSku,
      barcode: v.barcode,
      shopify: v.channelRefs.some((r) => r.channel === "SHOPIFY"),
      sitoo: v.channelRefs.some((r) => r.channel === "SITOO"),
    })),
    channels: {
      shopify:
        cw.publications.some((p) => p.channel === "SHOPIFY" && p.externalId) ||
        cw.variants.some((v) => v.channelRefs.some((r) => r.channel === "SHOPIFY")),
      sitoo: cw.variants.some((v) => v.channelRefs.some((r) => r.channel === "SITOO")),
      loom: loomSeasons.length > 0,
      loomSeasons,
    },
    systems: out,
    refusal:
      refused ??
      (out.length
        ? null
        : `No size system holds all of this colourway's sizes (${cw.variants.map((v) => v.sizeLabel).join(", ") || "none"}). ` +
          "Add the missing ones to the right system on /catalog/size-systems, then come back."),
  };
}

// ---------------------------------------------------------------------------
// Plan and apply
// ---------------------------------------------------------------------------

export interface AddSizeRequest {
  colorwayId: string;
  sizeSystemId: string;
  sizes: Array<{ entryId: string; barcode?: string | null }>;
}

export type StepState =
  | "write"
  | "written"
  | "exists"
  | "not-live"
  | "refused"
  | "skipped"
  | "failed"
  | "n/a";

export interface StepOutcome {
  state: StepState;
  note?: string;
  /** Human-readable detail: price, locations, family — what the write will look like. */
  detail?: string[];
  /** A barcode the channel already holds for this SKU, offered when none was typed. */
  suggestBarcode?: string;
}

export interface AddSizeRow {
  sizeLabel: string;
  sku: string;
  barcode: string | null;
  variantId: string | null;
  master: StepOutcome;
  shopify: StepOutcome;
  sitoo: StepOutcome;
}

export interface AddSizeReport {
  dryRun: boolean;
  colorwayId: string;
  errors: string[];
  warnings: string[];
  rows: AddSizeRow[];
  /** Loom sends for the caller to run, one per season, mode "data". */
  loomGroups: LoomGroup[];
  loom: StepOutcome;
}

interface Resolved {
  cw: LoadedColorway;
  errors: string[];
  warnings: string[];
  sizes: Array<{
    entry: { id: string; sizeLabel: string; dim1: string; dim2: string | null; skuToken: string };
    sku: string;
    barcode: string | null;
    /** Set when a previous run already created it on this colourway. */
    existing: LoadedColorway["variants"][number] | null;
  }>;
}

async function resolveRequest(req: AddSizeRequest): Promise<Resolved | { fatal: string }> {
  const ctx = await getAddSizeContext(req.colorwayId);
  if (!ctx) return { fatal: "Colourway not found." };
  if (ctx.refusal) return { fatal: ctx.refusal };
  const system = ctx.systems.find((s) => s.id === req.sizeSystemId);
  if (!system) return { fatal: "That size system is not one this product can take sizes from." };
  if (!system.skuStem) return { fatal: system.skuNote ?? "No SKU stem for this product." };
  if (!req.sizes.length) return { fatal: "Pick at least one size." };

  const cw = (await loadColorway(req.colorwayId))!;
  const entries = await prisma.sizeSystemEntry.findMany({ where: { sizeSystemId: system.id } });
  const byId = new Map(entries.map((e) => [e.id, e]));

  const errors: string[] = [];
  const warnings: string[] = [];
  if (system.skuNote) warnings.push(system.skuNote);
  const sizes: Resolved["sizes"] = [];
  const seenLabels = new Set<string>();
  const seenCodes = new Map<string, string>();

  for (const s of req.sizes) {
    const entry = byId.get(s.entryId);
    if (!entry || entry.archived) {
      errors.push("A picked size is not in the size system (or has been retired from it).");
      continue;
    }
    const label = entry.sizeLabel.toUpperCase();
    if (seenLabels.has(label)) {
      errors.push(`${entry.sizeLabel} is picked twice.`);
      continue;
    }
    seenLabels.add(label);

    const sku = buildVariantSku(system.skuStem, entry.skuToken);
    const existing =
      cw.variants.find((v) => normalizeSku(v.variantSku) === normalizeSku(sku)) ?? null;
    if (!existing && cw.variants.some((v) => v.sizeLabel.toUpperCase() === label)) {
      errors.push(`This colourway already has a ${entry.sizeLabel}.`);
      continue;
    }

    const raw = (s.barcode ?? "").trim();
    let barcode: string | null = null;
    if (raw) {
      barcode = canonical(raw);
      if (!barcode) {
        errors.push(`${entry.sizeLabel}: barcode ${raw} ${rejectionReason(raw) ?? "is not a barcode"}.`);
        continue;
      }
      const prior = seenCodes.get(barcode);
      if (prior) errors.push(`Barcode ${barcode} is on both ${prior} and ${entry.sizeLabel}.`);
      seenCodes.set(barcode, entry.sizeLabel);
    } else if (!existing) {
      warnings.push(
        `${entry.sizeLabel} has no barcode. It will be created, but it cannot be scanned at the till ` +
          "and Loom links it by SKU until one is added in the variant editor."
      );
    }
    if (existing && barcode && existing.barcode && existing.barcode !== barcode)
      errors.push(
        `${sku} already exists with barcode ${existing.barcode}. Change it in the variant editor, not here.`
      );
    sizes.push({ entry, sku, barcode: existing?.barcode ?? barcode, existing });
  }

  // SKUs and barcodes held anywhere else in the master.
  const fresh = sizes.filter((s) => !s.existing);
  if (fresh.length) {
    const takenSku = await prisma.variant.findMany({
      where: { variantSku: { in: fresh.map((s) => s.sku) } },
      select: { variantSku: true, colorway: { select: { colorwaySku: true } } },
    });
    for (const t of takenSku)
      errors.push(`${t.variantSku} already exists, on ${t.colorway.colorwaySku}.`);

    const codes = fresh.map((s) => s.barcode).filter((b): b is string => !!b);
    if (codes.length) {
      const [takenCode, ledger] = await Promise.all([
        prisma.variant.findMany({ where: { barcode: { in: codes } }, select: { barcode: true, variantSku: true } }),
        prisma.barcodeAllocation.findMany({ where: { barcode: { in: codes } }, select: { barcode: true, sku: true } }),
      ]);
      for (const t of takenCode) errors.push(`Barcode ${t.barcode} already belongs to ${t.variantSku}.`);
      const held = new Set(takenCode.map((t) => t.barcode));
      for (const l of ledger)
        if (!held.has(l.barcode) && l.sku && !fresh.some((s) => normalizeSku(s.sku) === normalizeSku(l.sku!)))
          warnings.push(`Barcode ${l.barcode} is in the ledger as issued for ${l.sku}, but on no variant.`);
    }
  }

  return { cw, errors, warnings, sizes };
}

function masterPriceNok(cw: LoadedColorway): string | null {
  const nok = cw.prices
    .filter((p) => p.currency === "NOK" && p.priceType === "MSRP")
    .sort((a, b) => b.season.sortOrder - a.season.sortOrder);
  return nok[0]?.amount.toString() ?? null;
}

function shopifyInput(
  r: Resolved,
  s: Resolved["sizes"][number],
  variantId: string
): ShopifyAddSizeInput {
  const siblings = r.cw.variants.filter((v) => v.id !== variantId);
  return {
    colorwayId: r.cw.id,
    publicationGid: r.cw.publications.find((p) => p.channel === "SHOPIFY")?.externalId ?? null,
    siblingVariantGids: siblings.flatMap((v) =>
      v.channelRefs.filter((c) => c.channel === "SHOPIFY").map((c) => c.externalId)
    ),
    siblingSkus: siblings.map((v) => v.variantSku),
    masterPriceNok: masterPriceNok(r.cw),
    size: { variantId, sku: s.sku, barcode: s.barcode, sizeLabel: s.entry.sizeLabel },
  };
}

function sitooInput(r: Resolved, s: Resolved["sizes"][number], variantId: string): SitooAddSizeInput {
  return {
    siblings: r.cw.variants
      .filter((v) => v.id !== variantId)
      .flatMap((v) =>
        v.channelRefs
          .filter((c) => c.channel === "SITOO")
          .map((c) => ({ sku: v.variantSku, sizeLabel: v.sizeLabel, productId: c.externalId }))
      ),
    size: { variantId, sku: s.sku, barcode: s.barcode, sizeLabel: s.entry.sizeLabel },
    fallbackTitle: channelProductTitle(r.cw),
  };
}

function describeShopify(p: Awaited<ReturnType<typeof planShopifyAddSize>>): string[] {
  if (p.state !== "write") return [];
  return [
    `${p.productTitle} (${p.productStatus?.toLowerCase()})`,
    `price ${p.price}${p.compareAtPrice ? `, was ${p.compareAtPrice}` : ""} — from ${p.priceSource === "siblings" ? "its sizes" : "the master"}`,
    p.tracked ? "inventory tracked, like its sizes" : "inventory NOT tracked — its sizes are untracked too",
    (p.locations?.length ?? 0) > 1
      ? `its sizes are stocked in ${p.locations!.length} locations; Shopify stocks the new one at its default ` +
        "location only (Origio's token cannot write inventory)"
      : "stocked at Shopify's default location, like its sizes",
    ...(p.reorder ? [`size picker reordered: ${p.reorder.join(" · ")}`] : []),
  ];
}

function describeSitoo(p: Awaited<ReturnType<typeof planSitooAddSize>>): string[] {
  if (p.state !== "write" && p.state !== "skipped") return [];
  if (!p.shape) return [];
  return [
    `"${p.title}" at ${p.price}, copied from ${p.copiedFrom}`,
    p.shape === "family"
      ? `joins family ${p.parentProductId}: ${p.sizes?.join(" · ")}`
      : "a separate product, like its siblings",
  ];
}

export async function planAddSize(req: AddSizeRequest): Promise<AddSizeReport> {
  return run(req, true);
}

export async function applyAddSize(req: AddSizeRequest): Promise<AddSizeReport> {
  return run(req, false);
}

async function run(req: AddSizeRequest, dryRun: boolean): Promise<AddSizeReport> {
  const report: AddSizeReport = {
    dryRun,
    colorwayId: req.colorwayId,
    errors: [],
    warnings: [],
    rows: [],
    loomGroups: [],
    loom: { state: "n/a" },
  };
  const resolved = await resolveRequest(req);
  if ("fatal" in resolved) {
    report.errors.push(resolved.fatal);
    return report;
  }
  const r = resolved;
  report.errors.push(...r.errors);
  report.warnings.push(...r.warnings);

  const rows: AddSizeRow[] = r.sizes.map((s) => ({
    sizeLabel: s.entry.sizeLabel,
    sku: s.sku,
    barcode: s.barcode,
    variantId: s.existing?.id ?? null,
    master: s.existing
      ? { state: "exists", note: "created by an earlier run — the channels are checked again" }
      : { state: "write" },
    shopify: { state: "n/a" },
    sitoo: { state: "n/a" },
  }));
  report.rows = rows;

  // Nothing is written anywhere while anything is wrong: a half-applied batch
  // of sizes is harder to reason about than a refused one.
  if (report.errors.length) {
    for (const row of rows) if (row.master.state === "write") row.master = { state: "refused", note: "fix the errors above first" };
    return report;
  }

  // 1. Master.
  if (!dryRun) {
    const fresh = r.sizes.filter((s) => !s.existing);
    if (fresh.length) {
      // Mirror the siblings' season links; with no siblings, every season the
      // colourway is entered in.
      const linked = new Set(r.cw.variants.flatMap((v) => v.seasonLinks.map((l) => l.seasonEntryId)));
      const entryIds = linked.size ? [...linked] : r.cw.entries.map((e) => e.id);

      const created = await prisma.$transaction(
        async (tx) => {
          const out: Array<{ sku: string; id: string }> = [];
          for (const s of fresh) {
            const v = await tx.variant.create({
              data: {
                colorwayId: r.cw.id,
                variantSku: normalizeSku(s.sku),
                barcode: s.barcode,
                sizeLabel: s.entry.sizeLabel,
                dim1: s.entry.dim1,
                dim2: s.entry.dim2,
              },
              select: { id: true },
            });
            if (entryIds.length)
              await tx.seasonVariant.createMany({
                data: entryIds.map((seasonEntryId) => ({ seasonEntryId, variantId: v.id })),
                skipDuplicates: true,
              });
            out.push({ sku: s.sku, id: v.id });
          }
          return out;
        },
        { timeout: 20_000, maxWait: 5_000 }
      );
      const idBySku = new Map(created.map((c) => [c.sku, c.id]));
      for (const row of rows)
        if (idBySku.has(row.sku)) {
          row.variantId = idBySku.get(row.sku)!;
          row.master = { state: "written" };
        }

      // Attribution, outside the transaction (provenance uses `prisma`). The
      // lock is what stops a Cin7 re-import overruling a barcode set here.
      await recordDecisions(
        fresh
          .filter((s) => s.barcode)
          .map((s) => ({
            entityType: "variant" as const,
            entityId: idBySku.get(s.sku)!,
            field: "barcode",
            owner: "MANUAL" as const,
            authority: ADD_SIZE_AUTHORITY,
            evidence: `size ${s.entry.sizeLabel} added to ${r.cw.colorwaySku}`,
            lock: true,
          }))
      );
      await recordIssued(
        prisma,
        fresh.filter((s) => s.barcode).map((s) => ({ barcode: s.barcode!, sku: s.sku, authority: ADD_SIZE_AUTHORITY }))
      );
    }
  }

  // Re-read after the master write so the channel inputs see the new rows.
  const cw = dryRun ? r.cw : (await loadColorway(r.cw.id))!;
  const rr: Resolved = { ...r, cw };

  // 2. Shopify, then Sitoo — independently, one size at a time. One channel
  //    being down must not stop the other, and Loom goes last so it carries the
  //    Shopify inventory ids in the same send.
  for (const [i, s] of r.sizes.entries()) {
    const row = rows[i];
    const variantId = row.variantId ?? `planned:${s.sku}`;
    const variant = cw.variants.find((v) => v.id === row.variantId);

    if (variant?.channelRefs.some((c) => c.channel === "SHOPIFY")) {
      row.shopify = { state: "exists", note: "already linked to Shopify" };
    } else {
      try {
        const input = shopifyInput(rr, s, variantId);
        if (dryRun) {
          const p = await planShopifyAddSize(input);
          row.shopify = { state: p.state, note: p.note, detail: describeShopify(p) };
          if (p.state === "exists" && !s.barcode && p.existingNode?.barcode)
            row.shopify.suggestBarcode = p.existingNode.barcode;
        } else {
          const res = await applyShopifyAddSize(input);
          row.shopify = {
            state: res.written ? "written" : res.state,
            note: [res.note, ...res.warnings].filter(Boolean).join("; ") || undefined,
            detail: describeShopify(res),
          };
          // Found live under this SKU — an earlier run that crashed before
          // recording it. applyShopifyAddSize links it rather than leaving the gap.
          if (res.state === "exists" && res.refs?.linked) row.shopify.note = `${res.note} — linked`;
        }
      } catch (e) {
        row.shopify = { state: "failed", note: (e as Error).message };
      }
    }

    if (variant?.channelRefs.some((c) => c.channel === "SITOO")) {
      row.sitoo = { state: "exists", note: "already linked to Sitoo" };
    } else {
      try {
        const input = sitooInput(rr, s, variantId);
        if (dryRun) {
          const p = await planSitooAddSize(input);
          row.sitoo = { state: p.state, note: p.note, detail: describeSitoo(p) };
        } else {
          const res = await applySitooAddSize(input);
          row.sitoo = { state: res.written ? "written" : res.state, note: res.note, detail: describeSitoo(res) };
          if ((res.written || res.state === "exists") && res.productId && row.variantId) {
            await prisma.variantChannelRef.upsert({
              where: { variantId_channel: { variantId: row.variantId, channel: "SITOO" } },
              create: {
                variantId: row.variantId,
                channel: "SITOO",
                externalId: res.productId,
                lastPushedAt: new Date(),
                lastPushStatus: res.written ? "created" : "matched",
              },
              update: { externalId: res.productId, lastPushedAt: new Date(), lastPushStatus: res.written ? "created" : "matched" },
            });
            if (res.state === "exists") row.sitoo = { state: "exists", note: `${res.note} — linked` };
          }
        }
      } catch (e) {
        row.sitoo = { state: "failed", note: (e as Error).message };
      }
    }
  }

  // Declare what now holds the garment, BEFORE the Loom send reads it — the
  // flags ride on every Loom push, and `false` makes Loom suppress stock errors.
  if (!dryRun) {
    if (rows.some((x) => x.shopify.state === "written" || x.shopify.state === "exists"))
      await declareChannel([cw.id], "SHOPIFY");
    if (rows.some((x) => x.sitoo.state === "written" || x.sitoo.state === "exists")) await declareChannel([cw.id], "SITOO");
  }

  // 3. Loom: the colourway re-sent in every season it is entered in.
  const loom = await loomScope([cw.id]);
  if (loom.archived.has(cw.id)) {
    report.loom = { state: "refused", note: "archived — re-sending would un-archive it in Loom" };
  } else if (!loom.live.has(cw.id)) {
    report.loom = { state: "not-live", note: "never pushed to Loom — the size goes out with its first publish" };
  } else if (!loom.groups.length) {
    report.loom = { state: "refused", note: "in Loom, but entered in no season to send it under" };
  } else {
    const skipped: string[] = [];
    if (dryRun) {
      try {
        for (const g of loom.groups) {
          const res = await pushColorwaysToLoom(g.colorwayIds, g.seasonCode, { dryRun: true, mode: "data" });
          for (const s of res.skipped) skipped.push(`${g.seasonCode}: ${s.reason}`);
        }
      } catch (e) {
        report.loom = { state: "failed", note: (e as Error).message };
      }
    }
    if (report.loom.state !== "failed") {
      const groups = dryRun
        ? loom.groups.filter((g) => !skipped.some((s) => s.startsWith(`${g.seasonCode}:`)))
        : loom.groups;
      report.loomGroups = groups;
      report.loom = groups.length
        ? {
            state: "write",
            note: `colourway re-sent in ${groups.map((g) => g.seasonCode).join(", ")}`,
            ...(skipped.length ? { detail: skipped } : {}),
          }
        : { state: "refused", note: skipped.join("; ") };
    }
  }

  return report;
}
