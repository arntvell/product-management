// Turning a draft into product, and surviving being interrupted while doing it.
//
// This replaced buildProductsForBrand (src/lib/master/create.ts), which was
// retired in 2026-09 once the style-splits repair showed how much of the Loom
// nesting damage it had caused. What it does differently, and why each one
// matters:
//
//   one Style, many Colorways   create.ts wrote styleSku === colorwaySku and a
//                               Style per row, so colourways never nested under
//                               a style and every manual style carried colour
//                               tokens in its style SKU.
//   one transaction             create.ts issued six un-transactioned
//                               createMany calls; a failure part-way left
//                               partial product behind.
//   a claim before the write    so a double-clicked button, a retried fetch and
//                               two open tabs collapse into one winner.
//   reserved ids                so a retry after a crash reuses the same ids and
//                               the resume probe has something definite to look
//                               for.
//   named collisions            create.ts reported "A style, colorway, or
//                               variant SKU already exists" and left you to
//                               find out which.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Prisma as PrismaTypes } from "@/generated/prisma/client";
import { parseDraftPayload, type DraftPayloadV1 } from "./draft-payload";
import { normalizeSku, findNearDuplicates, isOneOfOne, type SkuMatch } from "./sku";
import { loadSkuCorpus, findExactSkuHolders } from "./sku-corpus";
import { canonical, rejectionReason } from "./barcode";
import { recordDecisions } from "./provenance";
import { missingBrandDefaults } from "./brands";

export class FinalizeError extends Error {}

export interface DraftCollision {
  level: "style" | "colorway" | "variant" | "barcode";
  proposed: string;
  /** Which row in the draft produced it, so the UI can point at the input. */
  row: { colorwayKey?: string; variantKey?: string };
  matches: SkuMatch[];
  /** "certain" is the same garment; "taken" is the string already in use. */
  kind: "certain" | "taken";
}

export interface PreflightReport {
  draftId: string;
  ok: boolean;
  collisions: DraftCollision[];
  errors: string[];
  warnings: string[];
  counts: { styles: number; colorways: number; variants: number; prices: number };
}

export interface FinalizeResult {
  draftId: string;
  styleId: string;
  colorwayIds: string[];
  variantCount: number;
  /** True when the transaction had already committed and this call only observed it. */
  resumed: boolean;
}

interface ReservedIds {
  styleId: string;
  colorways: Array<{ key: string; id: string; entryId: string }>;
  variants: Array<{ key: string; id: string }>;
}

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

export async function preflightDraft(draftId: string): Promise<PreflightReport> {
  const draft = await prisma.productDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new FinalizeError("Draft not found.");
  const payload = parseDraftPayload(draft.payload);
  return preflightPayload(draftId, payload);
}

export async function preflightPayload(
  draftId: string,
  p: DraftPayloadV1
): Promise<PreflightReport> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const collisions: DraftCollision[] = [];

  // --- shape ---
  if (!p.brand.id) errors.push("Choose a brand.");
  if (p.brand.isLivid)
    errors.push(
      "Livid product comes from Threadflow. This builder creates external brands only."
    );
  if (!p.seasonId) errors.push("Choose a season.");
  if (!p.style) errors.push("Choose or name a style.");
  if (!p.channels.length) errors.push("Select at least one channel.");
  if (!p.colorways.length) errors.push("Add at least one colourway.");
  for (const cw of p.colorways) {
    if (!cw.name.trim()) errors.push("Every colourway needs a name.");
    if (!cw.variants.length) errors.push(`"${cw.name || "A colourway"}" has no sizes.`);
    for (const key of ["COST", "MSRP"] as const) {
      const v = cw.prices[key];
      if (v && !/^\d+([.,]\d{1,2})?$/.test(v.trim()))
        errors.push(`"${cw.name}" ${key.toLowerCase()} price "${v}" is not a number.`);
    }
  }

  // --- SKUs, within the batch ---
  const seen = new Map<string, string>();
  const allSkus: string[] = [];
  if (p.style?.mode === "new") allSkus.push(p.style.styleSku);
  for (const cw of p.colorways) {
    allSkus.push(cw.colorwaySku);
    for (const v of cw.variants) allSkus.push(v.variantSku);
  }
  for (const sku of allSkus) {
    const n = normalizeSku(sku);
    if (!n) continue;
    if (seen.has(n)) errors.push(`${sku} is listed twice in this batch.`);
    seen.set(n, sku);
  }

  // --- SKUs, against the master ---
  // Exact holders first: one query across all three levels answers the question
  // most collisions actually are.
  const holders = await findExactSkuHolders(allSkus);
  const push = (
    level: DraftCollision["level"],
    proposed: string,
    row: DraftCollision["row"],
    matches: SkuMatch[],
    kind: DraftCollision["kind"]
  ) => collisions.push({ level, proposed, row, matches, kind });

  if (p.style?.mode === "new") {
    // Checked against BOTH tables: the old manual path wrote
    // styleSku === colorwaySku, so a new style stem can legitimately clash with
    // an old colourway's SKU.
    const hit = holders.get(normalizeSku(p.style.styleSku));
    if (hit)
      push("style", p.style.styleSku, {}, [
        { sku: hit.sku, confidence: "certain", reason: `already a ${hit.level} SKU` },
      ], "taken");
  }

  for (const cw of p.colorways) {
    const hit = holders.get(normalizeSku(cw.colorwaySku));
    if (hit)
      push("colorway", cw.colorwaySku, { colorwayKey: cw.key }, [
        { sku: hit.sku, confidence: "certain", reason: `already a ${hit.level} SKU` },
      ], "taken");
    else {
      // Fuzzy: the same garment entered under a different spelling.
      const corpus = await loadSkuCorpus(cw.colorwaySku, { includeStyles: true });
      const certain = findNearDuplicates(cw.colorwaySku, corpus).filter(
        (m) => m.confidence === "certain"
      );
      if (certain.length)
        push("colorway", cw.colorwaySku, { colorwayKey: cw.key }, certain, "certain");
    }

    for (const v of cw.variants) {
      // EXACT equality only, never compareSku. parseSku reads a size as
      // SIZE_WORDS | \d{4} | \d{2}, so a shoe half-size 9.5 falls into `body`
      // instead and the "different size means different product" guard never
      // fires — two sizes of one shoe would read as duplicates of each other.
      const vh = holders.get(normalizeSku(v.variantSku));
      if (vh)
        push("variant", v.variantSku, { colorwayKey: cw.key, variantKey: v.key }, [
          { sku: vh.sku, confidence: "certain", reason: `already a ${vh.level} SKU` },
        ], "taken");
    }
  }

  // --- barcodes ---
  const proposedBarcodes = new Map<string, string>();
  for (const cw of p.colorways) {
    for (const v of cw.variants) {
      if (!v.barcode) continue;
      const c = canonical(v.barcode);
      if (!c) {
        errors.push(`${v.variantSku}: ${rejectionReason(v.barcode) ?? "not a barcode"}.`);
        continue;
      }
      const prior = proposedBarcodes.get(c);
      if (prior) errors.push(`Barcode ${c} is on both ${prior} and ${v.variantSku}.`);
      proposedBarcodes.set(c, v.variantSku);
    }
  }
  if (proposedBarcodes.size) {
    const codes = [...proposedBarcodes.keys()];
    const [taken, issued] = await Promise.all([
      prisma.variant.findMany({
        where: { barcode: { in: codes } },
        select: { barcode: true, variantSku: true },
      }),
      prisma.barcodeAllocation.findMany({
        where: { barcode: { in: codes } },
        select: { barcode: true, sku: true },
      }),
    ]);
    for (const t of taken)
      collisions.push({
        level: "barcode",
        proposed: t.barcode!,
        row: {},
        matches: [
          { sku: t.variantSku, confidence: "certain", reason: "another variant holds this barcode" },
        ],
        kind: "taken",
      });
    const takenSet = new Set(taken.map((t) => t.barcode));
    for (const i of issued) {
      if (takenSet.has(i.barcode)) continue;
      warnings.push(
        `Barcode ${i.barcode} is in the ledger${i.sku ? `, issued for ${i.sku}` : ""} but on no variant.`
      );
    }
  }

  // --- the outbound links a push needs, checked BEFORE the product exists ---
  errors.push(...(await channelLinkErrors(p)));
  errors.push(...brandDefaultErrors(p));

  // --- warnings worth seeing before you press create ---
  const noBarcode = p.colorways.reduce(
    (a, c) => a + c.variants.filter((v) => !v.barcode).length,
    0
  );
  if (noBarcode && p.channels.includes("LOOM"))
    warnings.push(
      `${noBarcode} size${noBarcode === 1 ? "" : "s"} have no barcode. Loom's registry sends ` +
        `barcoded variants only, so those will not reach it until a barcode is filled in.`
    );
  for (const cw of p.colorways) {
    if (cw.manualSku)
      warnings.push(`${cw.colorwaySku} was edited by hand rather than generated.`);
    if (isOneOfOne(cw.colorwaySku) && cw.kind === null && p.kind === "MERCHANDISE")
      warnings.push(
        `${cw.colorwaySku} is a one-of-one SKU being created as MERCHANDISE. ` +
          `That is right for an individual garment and wrong for a bulk bucket.`
      );
  }

  return {
    draftId,
    ok: errors.length === 0 && collisions.length === 0,
    collisions,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    counts: {
      styles: p.style?.mode === "new" ? 1 : 0,
      colorways: p.colorways.length,
      variants: p.colorways.reduce((a, c) => a + c.variants.length, 0),
      prices: p.colorways.reduce(
        (a, c) => a + (c.prices.COST ? 1 : 0) + (c.prices.MSRP ? 1 : 0),
        0
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------

export async function finalizeDraft(
  draftId: string,
  opts: { dryRun?: boolean } = {}
): Promise<FinalizeResult | PreflightReport> {
  const draft = await prisma.productDraft.findUnique({ where: { id: draftId } });
  if (!draft) throw new FinalizeError("Draft not found.");

  if (draft.status === "COMPLETED")
    return completedResult(draftId, draft.createdStyleIds, draft.createdColorwayIds);
  if (draft.status === "DISCARDED")
    throw new FinalizeError("This draft was discarded.");

  const payload = parseDraftPayload(draft.payload);

  // An interrupted finalize resumes rather than starting over.
  if (draft.status === "FINALIZING")
    return resumeFinalize(draftId, payload, draft.reservedIds as unknown as ReservedIds | null);

  const report = await preflightPayload(draftId, payload);
  if (!report.ok) return report;
  if (opts.dryRun) return report;

  const reserved = mintReservedIds(payload);

  // The mutex. A double-clicked button, a retried fetch and two open tabs all
  // collapse into one winner here, in one statement, with no lock table.
  const claimed = await prisma.productDraft.updateMany({
    where: { id: draftId, status: "DRAFT" },
    data: {
      status: "FINALIZING",
      reservedIds: reserved as unknown as object,
      startedFinalizeAt: new Date(),
      finalizeAttempts: { increment: 1 },
      finalizeError: null,
    },
  });
  if (claimed.count !== 1) {
    const fresh = await prisma.productDraft.findUnique({ where: { id: draftId } });
    if (!fresh) throw new FinalizeError("Draft not found.");
    if (fresh.status === "COMPLETED")
      return completedResult(draftId, fresh.createdStyleIds, fresh.createdColorwayIds);
    return resumeFinalize(
      draftId,
      payload,
      fresh.reservedIds as unknown as ReservedIds | null
    );
  }

  return writeProduct(draftId, payload, reserved, false);
}

/**
 * A draft left FINALIZING by a crash.
 *
 * Probe a reserved id: present means the transaction committed and the crash
 * happened between COMMIT and the status update; absent means it rolled back and
 * the same ids can be used again.
 */
async function resumeFinalize(
  draftId: string,
  payload: DraftPayloadV1,
  reserved: ReservedIds | null
): Promise<FinalizeResult> {
  if (!reserved?.colorways.length)
    throw new FinalizeError(
      "This draft was interrupted before its ids were reserved. Reopen it and create again."
    );

  const probe = await prisma.colorway.findUnique({
    where: { id: reserved.colorways[0].id },
    select: { id: true },
  });

  if (probe) {
    await markCompleted(draftId, reserved);
    return {
      draftId,
      styleId: reserved.styleId,
      colorwayIds: reserved.colorways.map((c) => c.id),
      variantCount: reserved.variants.length,
      resumed: true,
    };
  }
  return writeProduct(draftId, payload, reserved, true);
}

async function writeProduct(
  draftId: string,
  p: DraftPayloadV1,
  reserved: ReservedIds,
  resumed: boolean
): Promise<FinalizeResult> {
  const brandId = p.brand.id!;
  const seasonId = p.seasonId!;
  const style = p.style!;
  const t = p.template;

  const styleId = style.mode === "existing" ? style.id : reserved.styleId;

  const styleRow =
    style.mode === "new"
      ? {
          id: reserved.styleId,
          source: "MANUAL" as const,
          styleSku: normalizeSku(style.styleSku),
          styleName: style.styleName.trim(),
          gender: blank(t.gender),
          unisex: t.unisex,
          category: blank(t.category) ?? "Uncategorized",
          // Dual-written: the id is authoritative for product created here, the
          // text keeps every existing consumer working. Retiring the text column
          // is a later, separate decision.
          categoryId: blank(t.categoryId),
          brandId,
          hsCode: blank(t.hsCode),
          customsDescription: blank(t.customsDescription),
          weightKg: decimal(t.weightKg),
          fiberComposition: blank(t.fiberComposition),
        }
      : null;

  const colorwayRows: PrismaTypes.ColorwayCreateManyInput[] = [];
  const variantRows: PrismaTypes.VariantCreateManyInput[] = [];
  const entryRows: PrismaTypes.SeasonEntryCreateManyInput[] = [];
  const linkRows: PrismaTypes.SeasonVariantCreateManyInput[] = [];
  const priceRows: PrismaTypes.PriceCreateManyInput[] = [];
  const pubRows: PrismaTypes.ChannelPublicationCreateManyInput[] = [];

  const variantIdByKey = new Map(reserved.variants.map((v) => [v.key, v.id]));

  for (const cw of p.colorways) {
    const ids = reserved.colorways.find((c) => c.key === cw.key)!;
    colorwayRows.push({
      id: ids.id,
      source: "MANUAL",
      colorwaySku: normalizeSku(cw.colorwaySku),
      name: cw.name.trim(),
      color: cw.color,
      swatchHex: cw.swatchHex,
      styleId,
      brandId,
      manufacturerId: blank(t.manufacturerId),
      countryOfOrigin: blank(t.countryOfOrigin),
      // The colourway's own category when it has one, else the batch's. An
      // imported file carries a category per line, so a mixed workbook —
      // a brand's shirts and its bags — lands with each colourway under its own
      // rather than all of them under whichever one the style happened to take.
      productType: blank(cw.category) ?? blank(t.category),
      categoryId: blank(cw.categoryId) ?? blank(t.categoryId),
      vendor: p.brand.name,
      // Explicit, never inferred from the SKU. classifyKind reads EXT-VN-* as
      // AGGREGATE (the store-vintage buckets), which is wrong for an individual
      // garment — the MANUAL lock written below is what stops the classifier
      // overruling this later.
      kind: cw.kind ?? p.kind,
      // DRAFT, not ACTIVE. A product created here has no description, no
      // photograph and often no barcode yet — the channel push is what makes it
      // real, and /catalog/publishing is where it is flipped live deliberately.
      // The old create path defaulted to DRAFT for the same reason.
      status: "DRAFT",
    });

    entryRows.push({
      id: ids.entryId,
      colorwayId: ids.id,
      seasonId,
      approvedForProduction: true,
    });

    for (const v of cw.variants) {
      const variantId = variantIdByKey.get(v.key)!;
      variantRows.push({
        id: variantId,
        colorwayId: ids.id,
        variantSku: normalizeSku(v.variantSku),
        barcode: v.barcode ? canonical(v.barcode) : null,
        sizeLabel: v.sizeLabel,
        dim1: v.dim1,
        dim2: v.dim2,
      });
      linkRows.push({ seasonEntryId: ids.entryId, variantId });
    }

    for (const [priceType, amount] of [
      ["COST", cw.prices.COST],
      ["MSRP", cw.prices.MSRP],
    ] as const) {
      if (!amount?.trim()) continue;
      priceRows.push({
        seasonId,
        colorwayId: ids.id,
        currency: "NOK",
        priceType,
        amount: amount.trim().replace(",", "."),
      });
    }

    for (const channel of p.channels)
      pubRows.push({ colorwayId: ids.id, channel, published: false });
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        if (styleRow) await tx.style.createMany({ data: [styleRow], skipDuplicates: resumed });
        await tx.colorway.createMany({ data: colorwayRows, skipDuplicates: resumed });
        if (variantRows.length)
          await tx.variant.createMany({ data: variantRows, skipDuplicates: resumed });
        await tx.seasonEntry.createMany({ data: entryRows, skipDuplicates: resumed });
        if (linkRows.length)
          await tx.seasonVariant.createMany({ data: linkRows, skipDuplicates: true });
        if (priceRows.length)
          await tx.price.createMany({ data: priceRows, skipDuplicates: resumed });
        if (pubRows.length)
          await tx.channelPublication.createMany({ data: pubRows, skipDuplicates: true });
      },
      { timeout: 20_000, maxWait: 5_000 }
    );
  } catch (err) {
    await prisma.productDraft.update({
      where: { id: draftId },
      data: {
        status: "DRAFT",
        finalizeError: err instanceof Error ? err.message : String(err),
      },
    });
    throw await describeWriteFailure(err, p);
  }

  // Outside the transaction: recordDecisions uses `prisma`, not `tx`.
  await recordDecisions(
    p.colorways.map((cw) => {
      const ids = reserved.colorways.find((c) => c.key === cw.key)!;
      return {
        entityType: "colorway" as const,
        entityId: ids.id,
        field: "kind",
        owner: "MANUAL" as const,
        authority: "origio:builder",
        evidence: `set in the product builder (${normalizeSku(cw.colorwaySku)})`,
        lock: true,
      };
    })
  );

  await markCompleted(draftId, reserved);

  return {
    draftId,
    styleId,
    colorwayIds: reserved.colorways.map((c) => c.id),
    variantCount: variantRows.length,
    resumed,
  };
}

async function markCompleted(draftId: string, reserved: ReservedIds): Promise<void> {
  await prisma.productDraft.update({
    where: { id: draftId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      finalizeError: null,
      createdStyleIds: [reserved.styleId],
      createdColorwayIds: reserved.colorways.map((c) => c.id),
    },
  });
}

async function completedResult(
  draftId: string,
  styleIds: string[],
  colorwayIds: string[]
): Promise<FinalizeResult> {
  const variantCount = await prisma.variant.count({
    where: { colorwayId: { in: colorwayIds } },
  });
  return {
    draftId,
    styleId: styleIds[0] ?? "",
    colorwayIds,
    variantCount,
    resumed: true,
  };
}

/**
 * Turn a P2002 into a sentence that names the SKU.
 *
 * createMany reports a constraint, not a value, so the column name is all
 * Postgres gives us — we go back and ask which of the proposed values is
 * actually taken. The old path said "A style, colorway, or variant SKU already
 * exists. SKUs must be unique." and left you to find out which.
 */
async function describeWriteFailure(err: unknown, p: DraftPayloadV1): Promise<Error> {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== "P2002"
  )
    return err instanceof Error ? err : new FinalizeError(String(err));

  const target = err.meta?.target;
  const fields = Array.isArray(target) ? (target as string[]) : [String(target ?? "")];

  const skus: string[] = [];
  if (p.style?.mode === "new") skus.push(p.style.styleSku);
  for (const cw of p.colorways) {
    skus.push(cw.colorwaySku);
    for (const v of cw.variants) skus.push(v.variantSku);
  }

  if (fields.some((f) => f.includes("barcode"))) {
    const codes = p.colorways
      .flatMap((c) => c.variants.map((v) => (v.barcode ? canonical(v.barcode) : null)))
      .filter(Boolean) as string[];
    const taken = await prisma.variant.findMany({
      where: { barcode: { in: codes } },
      select: { barcode: true, variantSku: true },
    });
    return new FinalizeError(
      taken.length
        ? `Barcode already in use: ${taken.map((t) => `${t.barcode} on ${t.variantSku}`).join("; ")}.`
        : "A barcode in this batch is already in use."
    );
  }

  const holders = await findExactSkuHolders(skus);
  const clashes = [...holders.values()].map((h) => `${h.sku} (${h.level})`);
  return new FinalizeError(
    clashes.length
      ? `Already in the master: ${clashes.join(", ")}. Someone may have created these while you were drafting.`
      : `A unique constraint on ${fields.join(", ")} rejected this batch.`
  );
}

function mintReservedIds(p: DraftPayloadV1): ReservedIds {
  return {
    styleId: p.style?.mode === "existing" ? p.style.id : randomUUID(),
    colorways: p.colorways.map((c) => ({
      key: c.key,
      id: randomUUID(),
      entryId: randomUUID(),
    })),
    variants: p.colorways.flatMap((c) =>
      c.variants.map((v) => ({ key: v.key, id: randomUUID() }))
    ),
  };
}


/**
 * The links a Sitoo push needs, checked at create time rather than at push time.
 *
 * Sitoo takes `manufacturerid` (which it uses for brands) and
 * `defaultcategoryid` (its navigation) on the product itself. Both come from
 * OUR side — the brand's SITOO BrandChannelRef and the category's
 * sitooCategoryId — and neither is inferable from the product. stepSitoo
 * already refuses without them, but by then the garment exists in the master,
 * has been through a push batch, and someone is reading a failed item error to
 * find out that a reference table was never filled in.
 *
 * So the same refusal is made here, where it costs one screen instead of a
 * batch. Only when SITOO is a target: a Shopify- or Loom-only product has no use
 * for either id, and demanding them would block product that is fine.
 *
 * The ambiguous case is an error for the same reason it is one in
 * push-orchestrator: manufacturerid lands on a real product in the till, and
 * nothing downstream would flag a coin flip as a guess.
 */
async function channelLinkErrors(p: DraftPayloadV1): Promise<string[]> {
  if (!p.channels.includes("SITOO") || !p.brand.id) return [];
  const errs: string[] = [];

  const brand = await prisma.brand.findUnique({
    where: { id: p.brand.id },
    select: {
      name: true,
      channelRefs: {
        where: { system: "SITOO", role: "BRAND" },
        select: { externalId: true, externalName: true },
      },
    },
  });
  const ids = [
    ...new Set((brand?.channelRefs ?? []).map((r) => r.externalId).filter((x): x is string => !!x)),
  ];
  if (ids.length === 0)
    errs.push(
      `"${brand?.name ?? p.brand.name}" is not linked to a Sitoo manufacturer, so a product ` +
        `created for Sitoo would carry no brand in the till. Link it on /catalog/brands/identity, ` +
        `or untick Sitoo.`
    );
  else if (ids.length > 1)
    errs.push(
      `"${brand?.name ?? p.brand.name}" is linked to ${ids.length} Sitoo manufacturers ` +
        `(${ids.join(", ")}). Pick one on /catalog/brands/identity — the push refuses to guess ` +
        `which the till should show, and it would refuse this product too.`
    );

  // Every category the batch actually uses: the template's, plus any colourway
  // that overrides it.
  const categoryIds = [
    ...new Set(
      [p.template.categoryId, ...p.colorways.map((c) => c.categoryId)].filter(
        (x): x is string => !!x
      )
    ),
  ];
  if (!categoryIds.length) {
    errs.push("Choose a category — Sitoo needs one to file the product under.");
  } else {
    const cats = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, sitooCategoryId: true },
    });
    const found = new Set(cats.map((c) => c.id));
    for (const id of categoryIds)
      if (!found.has(id)) errs.push("A category on this draft no longer exists — pick it again.");
    for (const c of cats)
      if (!c.sitooCategoryId)
        errs.push(
          `Category "${c.name}" has no Sitoo navigation id, so the product would land ` +
            `uncategorised in the till. Set it on /catalog/categories, or untick Sitoo.`
        );
  }

  return errs;
}

/**
 * The customs block an imported product has nowhere else to get.
 *
 * The import file has seven columns and customs is not among them — by design,
 * because HS code, weight, fibre, country and the customs description are the
 * same for every garment a brand makes and retyping them per batch is how two
 * batches of the same boot end up disagreeing. They are copied onto the draft
 * from the brand at import, so an empty one here means the brand was
 * incomplete, and the product would go out to Loom and Shopify with a blank
 * where its customs data belongs.
 *
 * Scoped to import-born drafts. The wizard has these fields on its own template
 * step; gating a hand-typed draft on the brand would refuse work the operator
 * is in the middle of doing correctly.
 *
 * Manufacturer is not checked — it is a factory, not a customs fact.
 */
function brandDefaultErrors(p: DraftPayloadV1): string[] {
  if (p.origin !== "import") return [];
  const missing = missingBrandDefaults({
    hsCode: p.template.hsCode,
    countryOfOrigin: p.template.countryOfOrigin,
    weightKg: p.template.weightKg,
    fiberComposition: p.template.fiberComposition,
    customsDescription: p.template.customsDescription,
  });
  if (!missing.length) return [];
  return [
    `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. An imported ` +
      `product inherits these from the brand, so fill them in on ` +
      `${p.brand.name ? `"${p.brand.name}"` : "the brand"} and import the file again — ` +
      `this draft holds the values as they were when it was created.`,
  ];
}

function blank(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function decimal(v: string | null | undefined): string | null {
  const t = v?.trim().replace(",", ".");
  return t && /^\d+(\.\d+)?$/.test(t) ? t : null;
}
