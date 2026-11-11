// Loom asks Origio to create the products on a locked Buying plan that exist
// nowhere yet: new styles and colours of external brands, for one season.
//
// Loom must not invent SKUs. Origio's SKU rule and its collision check own them,
// so each item goes through the SAME builder as a hand-typed product: one draft
// per item, preflightPayload for the dry run, finalizeDraft for the real call.
// No second creation path, so the collision checks, the reserved-id claim and
// resume-after-crash apply to a Loom product exactly as to any other.
//
// What a Loom-born product is:
//   LOOM only      `channels: ["LOOM"]`. Its Shopify and Sitoo rows are not
//                  made; the Loom one is made unpublished. Nothing is pushed:
//                  Loom applies the returned FeedStyle itself, and the next
//                  registry push finds the same rows by their ids.
//   origin wizard  An imported draft refuses a brand with no customs defaults
//                  (HS code, country, weight, fibre, description). Buying must
//                  not wait on those, so they may be blank here, and every
//                  item says which are missing. Loom fills them later through
//                  the master-data endpoint.
//   idempotent     on `loom_key`, kept on ProductDraft.loomKey. A repeated real
//                  call returns what the first created. A dry run writes
//                  nothing at all.
import { prisma } from "@/lib/db";
import { emptyDraftPayload, type DraftPayloadV1, type DraftVariant } from "@/lib/master/draft-payload";
import { createDraft, saveDraft } from "@/lib/master/drafts";
import { finalizeDraft, preflightPayload, type PreflightReport } from "@/lib/master/finalize";
import { missingBrandDefaults } from "@/lib/master/brands";
import { buildColorwaySku, buildStyleSku, buildVariantSku, normalizeSku, sizeSkuToken } from "@/lib/master/sku";
import { buildLoomPayload } from "@/lib/loom/payload";

export interface ExternalProductItem {
  loom_key: string;
  brand: { loom_brand_id?: string | null; name?: string | null };
  style_name: string;
  colour?: string | null;
  model_number?: string | null;
  product_type?: string | null;
  origio_category_id?: string | null;
  sizes: string[];
  msrp_nok: number;
  cost_nok: number;
  cost?: { currency: string; amount: number } | null;
}

export type ExternalProductResult =
  | {
      loom_key: string;
      ok: true;
      colorway_sku: string;
      variant_skus: Record<string, string>;
      /** Customs defaults the brand lacks, and anything else worth a look. */
      warnings: string[];
      /** Real call only. */
      style?: unknown;
    }
  | { loom_key: string; ok: false; error: string };

export class PartnerRequestError extends Error {}

function fail(loom_key: string, error: string): ExternalProductResult {
  return { loom_key, ok: false, error };
}

/** The whole call: one season, items in order. Sequential, so two items of one
 * new style see the style the first created. */
export async function createExternalProducts(body: {
  dry_run?: unknown;
  season?: unknown;
  items?: unknown;
}): Promise<{ dryRun: boolean; items: ExternalProductResult[] }> {
  const dryRun = body.dry_run !== false;
  const seasonCode = typeof body.season === "string" ? body.season.trim().toUpperCase() : "";
  if (!seasonCode) throw new PartnerRequestError("season is required");
  if (!Array.isArray(body.items)) throw new PartnerRequestError("items must be an array");
  const season = await prisma.season.findUnique({ where: { code: seasonCode }, select: { id: true, code: true } });
  if (!season) throw new PartnerRequestError(`Origio has no season ${seasonCode}`);

  const out: ExternalProductResult[] = [];
  for (const raw of body.items as ExternalProductItem[]) {
    const key = typeof raw?.loom_key === "string" ? raw.loom_key : "";
    if (!key) {
      out.push(fail("", "loom_key is missing"));
      continue;
    }
    try {
      out.push(await oneItem(raw, season, dryRun));
    } catch (err) {
      out.push(fail(key, err instanceof Error ? err.message : String(err)));
    }
  }
  return { dryRun, items: out };
}

async function oneItem(
  item: ExternalProductItem,
  season: { id: string; code: string },
  dryRun: boolean
): Promise<ExternalProductResult> {
  const key = item.loom_key;

  // A real call that has been made before returns what it made.
  if (!dryRun) {
    const prior = await prisma.productDraft.findUnique({
      where: { loomKey: key },
      select: { id: true, status: true, revision: true },
    });
    if (prior?.status === "COMPLETED" || prior?.status === "FINALIZING") return finish(key, prior.id, season.code, []);
    if (prior?.status === "DISCARDED")
      return fail(key, "this line's earlier product draft was discarded in Origio; ask Origio to look at it");
    // A DRAFT left by a failed attempt is rebuilt from this call below.
  }

  const styleName = item.style_name?.trim();
  if (!styleName) return fail(key, "style_name is missing");
  const sizes = [...new Set((item.sizes ?? []).map((s) => String(s).trim()).filter(Boolean))];
  if (!sizes.length) return fail(key, "no sizes");
  if (!(item.msrp_nok > 0)) return fail(key, "msrp_nok must be a positive number");
  if (!(item.cost_nok >= 0)) return fail(key, "cost_nok must be a number");

  // --- brand ---
  const brand = await resolveBrand(item.brand);
  if (!brand) return fail(key, `Origio has no brand "${item.brand?.name ?? item.brand?.loom_brand_id}"`);
  if (brand.isLivid) return fail(key, "Livid products come from Threadflow, not from Loom");

  // --- template: the brand's defaults, blanks allowed (see the header) ---
  const t = brand.template;
  const template = {
    ...emptyDraftPayload().template,
    gender: t?.gender ?? "",
    unisex: t?.unisex ?? false,
    hsCode: t?.hsCode ?? "",
    customsDescription: t?.customsDescription ?? "",
    weightKg: t?.weightKg?.toString() ?? "",
    fiberComposition: t?.fiberComposition ?? "",
    countryOfOrigin: t?.countryOfOrigin ?? "",
    manufacturerId: t?.manufacturerId ?? "",
    defaultSizeSystemId: t?.defaultSizeSystemId ?? "",
  };
  const warnings: string[] = [];
  const missing = missingBrandDefaults(template);
  if (missing.length) warnings.push(`${brand.name} has no ${missing.join(", ")} in Origio yet`);

  // --- category ---
  const category = await resolveCategory(item.origio_category_id, item.product_type);
  if (category === "unknown-id") return fail(key, `origio_category_id ${item.origio_category_id} is not an Origio category`);
  if (category) {
    template.categoryId = category.id;
    template.category = category.name;
  } else if (item.product_type?.trim()) {
    // No Origio category matched: kept as Loom wrote it, which is what reaches
    // the colourway's product type and Loom's feed.
    template.category = item.product_type.trim();
    warnings.push(`no Origio category matches "${item.product_type.trim()}"; kept as written`);
  }

  // --- style: the brand's own of that name, else a new one ---
  const existing = await prisma.style.findFirst({
    where: { brandId: brand.id, styleName: { equals: styleName, mode: "insensitive" } },
    select: { id: true, styleSku: true, styleName: true },
  });
  const styleSku =
    existing?.styleSku ??
    buildStyleSku({ prefix: "EXT", brandToken: brand.skuToken, brandName: brand.name, style: styleName });

  // --- colourway and sizes ---
  const colourName = item.colour?.trim() || styleName;
  // The same colour under the same style is the same garment. The SKU check
  // alone misses it for the many older products whose SKUs predate the rule
  // (Paraboot's Fine boot laces / Cafe is EXT-PB-LCT-FNL-CF, where the rule
  // now gives EXT-PB-LCT-FNL-NR-CF), so it is asked by name as well.
  if (existing) {
    const same = await prisma.colorway.findFirst({
      where: { styleId: existing.id, name: { equals: colourName, mode: "insensitive" } },
      select: { colorwaySku: true, archived: true },
    });
    if (same)
      return fail(
        key,
        `${existing.styleName} ${colourName} is already in Origio as ${same.colorwaySku}` +
          `${same.archived ? " (archived)" : ""}; order that product instead`
      );
  }
  const colorwaySku = normalizeSku(buildColorwaySku(styleSku, colourName));
  const entries = template.defaultSizeSystemId
    ? await prisma.sizeSystemEntry.findMany({
        where: { sizeSystemId: template.defaultSizeSystemId, archived: false },
        select: { id: true, sizeLabel: true, dim1: true, dim2: true, skuToken: true },
      })
    : [];
  const byLabel = new Map(entries.map((e) => [e.sizeLabel.trim().toLowerCase(), e]));
  const variants: DraftVariant[] = sizes.map((label, i) => {
    const l = label.toLowerCase();
    const e = byLabel.get(l) ?? byLabel.get(l.replace(",", "."));
    // Not in the brand's size system: a size typed ad hoc, the way the wizard
    // takes one — its token is the label itself.
    const skuToken = e?.skuToken ?? sizeSkuToken({ dim1: label });
    return {
      key: `v${i}`,
      entryId: e?.id ?? null,
      sizeLabel: e?.sizeLabel ?? label,
      dim1: e?.dim1 ?? label,
      dim2: e?.dim2 ?? null,
      skuToken,
      variantSku: normalizeSku(buildVariantSku(colorwaySku, skuToken)),
      barcode: null,
      barcodeSource: null,
    };
  });
  const adHoc = variants.filter((v) => !v.entryId).map((v) => v.sizeLabel);
  if (adHoc.length && entries.length)
    warnings.push(`size(s) ${adHoc.join(", ")} are not in ${brand.name}'s size system; added as written`);

  const payload: DraftPayloadV1 = {
    version: 1,
    origin: "wizard",
    brand: { id: brand.id, name: brand.name, skuToken: brand.skuToken, isLivid: false },
    seasonId: season.id,
    channels: ["LOOM"],
    kind: "MERCHANDISE",
    template,
    style: existing
      ? { mode: "existing", id: existing.id, styleSku: existing.styleSku, styleName: existing.styleName }
      : { mode: "new", styleName, styleSku, manualSku: false },
    colorways: [
      {
        key: "c0",
        name: colourName,
        color: item.colour?.trim() || null,
        swatchHex: null,
        colorwaySku,
        manualSku: false,
        kind: null,
        categoryId: null,
        category: null,
        sizeSystemId: template.defaultSizeSystemId || null,
        variants,
        prices: { COST: item.cost_nok.toFixed(2), MSRP: item.msrp_nok.toFixed(2) },
      },
    ],
  };

  const skus = Object.fromEntries(sizes.map((s, i) => [s, variants[i].variantSku]));

  if (dryRun) {
    const report = await preflightPayload(`loom:${key}`, payload);
    if (!report.ok) return fail(key, reportError(report));
    // The builder's "no barcode, so not in Loom's registry" note is about the
    // registry push, which since 2026-09-23 sends unbarcoded variants too — and
    // a product Loom asked for is applied by Loom itself. Noise for a buyer.
    const notes = report.warnings.filter((w) => !/no barcode/i.test(w));
    return { loom_key: key, ok: true, colorway_sku: colorwaySku, variant_skus: skus, warnings: [...warnings, ...notes] };
  }

  // --- real: a draft keyed on loom_key, then the ordinary finalize ---
  let draftId: string;
  const prior = await prisma.productDraft.findUnique({ where: { loomKey: key }, select: { id: true, revision: true } });
  if (prior) {
    await saveDraft(prior.id, { revision: prior.revision, payload, step: "review" });
    draftId = prior.id;
  } else {
    draftId = await createDraft();
    await saveDraft(draftId, { revision: 0, payload, step: "review" });
    try {
      await prisma.productDraft.update({ where: { id: draftId }, data: { loomKey: key } });
    } catch {
      // Two calls raced on one loom_key and the other claimed it. Drop ours and
      // answer with theirs.
      await prisma.productDraft.update({ where: { id: draftId }, data: { status: "DISCARDED" } });
      const winner = await prisma.productDraft.findUnique({ where: { loomKey: key }, select: { id: true } });
      if (!winner) throw new Error("could not claim this loom_key");
      return finish(key, winner.id, season.code, warnings);
    }
  }
  const result = await finalizeDraft(draftId);
  if ("ok" in result) return fail(key, reportError(result));
  return finish(key, draftId, season.code, warnings);
}

/** The answer for a draft that has been (or is being) created. */
async function finish(
  key: string,
  draftId: string,
  seasonCode: string,
  warnings: string[]
): Promise<ExternalProductResult> {
  let draft = await prisma.productDraft.findUnique({ where: { id: draftId }, select: { status: true, createdColorwayIds: true } });
  // An interrupted finalize resumes here rather than reporting half a product.
  if (draft?.status === "FINALIZING") {
    const r = await finalizeDraft(draftId);
    if ("ok" in r) return fail(key, reportError(r));
    draft = await prisma.productDraft.findUnique({ where: { id: draftId }, select: { status: true, createdColorwayIds: true } });
  }
  const colorwayId = draft?.createdColorwayIds[0];
  if (draft?.status !== "COMPLETED" || !colorwayId) return fail(key, "Origio did not finish creating this product");

  const cw = await prisma.colorway.findUnique({
    where: { id: colorwayId },
    select: {
      colorwaySku: true,
      variants: { select: { variantSku: true, sizeLabel: true } },
      prices: { where: { priceType: "COST", currency: "NOK", season: { code: seasonCode } }, select: { amount: true } },
    },
  });
  if (!cw) return fail(key, "the created product is gone from Origio");

  const feed = await buildLoomPayload([colorwayId], seasonCode);
  const style = feed.styles[0] as { colorways: Record<string, unknown>[] } | undefined;
  // Loom's contract asks for the buy price as buy_prices. The registry push does
  // not send it (that is the parked loom-buy-price work); only this answer does.
  const cost = cw.prices[0] ? Number(cw.prices[0].amount) : null;
  if (style && cost !== null) for (const c of style.colorways) c.buy_prices = { NOK: cost };

  return {
    loom_key: key,
    ok: true,
    colorway_sku: cw.colorwaySku,
    variant_skus: Object.fromEntries(cw.variants.map((v) => [v.sizeLabel, v.variantSku])),
    warnings,
    style,
  };
}

async function resolveBrand(b: ExternalProductItem["brand"]) {
  const select = {
    id: true,
    name: true,
    isLivid: true,
    skuToken: true,
    loomBrandId: true,
    template: true,
  } as const;
  if (b?.loom_brand_id) {
    const byId = await prisma.brand.findUnique({ where: { loomBrandId: b.loom_brand_id }, select });
    if (byId) return byId;
  }
  if (!b?.name?.trim()) return null;
  const byName = await prisma.brand.findFirst({
    where: { name: { equals: b.name.trim(), mode: "insensitive" }, archived: false },
    select,
  });
  // Remember Loom's id the first time the name finds the brand, so a later
  // respelling in Loom still reaches it.
  if (byName && b.loom_brand_id && !byName.loomBrandId)
    await prisma.brand
      .update({ where: { id: byName.id }, data: { loomBrandId: b.loom_brand_id } })
      .catch(() => undefined);
  return byName;
}

async function resolveCategory(
  id: string | null | undefined,
  productType: string | null | undefined
): Promise<{ id: string; name: string } | null | "unknown-id"> {
  if (id) {
    const c = await prisma.category.findUnique({ where: { id }, select: { id: true, name: true } });
    return c ?? "unknown-id";
  }
  const text = productType?.trim();
  if (!text) return null;
  const hits = await prisma.category.findMany({
    where: {
      archived: false,
      mergedIntoId: null,
      OR: [{ loomCategory: { equals: text, mode: "insensitive" } }, { name: { equals: text, mode: "insensitive" } }],
    },
    select: { id: true, name: true },
  });
  // Exactly one, or none: two candidates is a guess.
  return hits.length === 1 ? hits[0] : null;
}

/** A preflight refusal, written for a buyer. */
function reportError(r: PreflightReport): string {
  const parts = [
    ...r.collisions.map(
      (c) => `collision: ${c.proposed} exists (${c.kind}${c.matches[0] ? `, ${c.matches[0].sku}` : ""})`
    ),
    ...r.errors,
  ];
  return parts.join("; ") || "refused by Origio's checks";
}
