// Adding one size to a garment the till already sells.
//
// NOT the api-creator's createOne. That builds a family from the master's view
// of the colourway: it retitles and reprices every sibling to the master's
// values and takes the first variant in the list as the parent — correct for a
// product it is creating, wrong for one that has been selling for years. Here
// the existing family is the authority, and the new size is shaped after it:
//
//   - The one new SKU is created as a plain product, copying the sibling's
//     VAT, category, manufacturer and prices.
//   - If the siblings are in a family, the family is re-read, the new size is
//     appended, and every existing row is passed back VERBATIM. The PUT is a
//     full replacement — a row omitted is a size deleted.
//   - If the siblings stand alone, the new size stands alone too. Inventing a
//     family on a product that never had one is a restructure of the till,
//     which is not what "add a size" asked for.
//
// Everything else follows api-creator.ts: production named explicitly, the
// SITOO_CREATE_ALLOW_PRODUCTION guard, the whole-account count tripwire for the
// 12 September disappearance, and strictly sequential calls (429 otherwise).

import {
  createProducts as createProductsRaw,
  findProductsBySku as findProductsBySkuRaw,
  getProduct as getProductRaw,
  getProductVariants as getProductVariantsRaw,
  productCount,
  setProductVariants as setProductVariantsRaw,
  type SitooTarget,
  type SitooVariantRow,
} from "./client";
import { normalizeSku } from "@/lib/master/sku";
import { sortSizes } from "@/lib/master/size-order";

const TARGET: SitooTarget = "production";

/**
 * Sitoo answers `429: Too many connections` when anything else on the account
 * is mid-request — another session's push, a linker run. A 429 is a refusal, so
 * nothing was done and the same call is safe to repeat; everything else is
 * thrown as it came.
 */
async function retry429<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4 || !/→ 429/.test(err instanceof Error ? err.message : "")) throw err;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}
const findProductsBySku = (skus: string[], t: SitooTarget) => retry429(() => findProductsBySkuRaw(skus, t));
const getProduct = (id: number, t: SitooTarget) => retry429(() => getProductRaw(id, t));
const createProducts = (p: Parameters<typeof createProductsRaw>[0], t: SitooTarget) =>
  retry429(() => createProductsRaw(p, t));
const setProductVariants = (id: number, v: Parameters<typeof setProductVariantsRaw>[1], t: SitooTarget) =>
  retry429(() => setProductVariantsRaw(id, v, t));

/** getProductVariants swallows every error into null, so a 429 has to be retried on the null. */
async function getProductVariants(id: number, t: SitooTarget) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await getProductVariantsRaw(id, t);
    if (res) return res;
    await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
  }
  return null;
}
const DEFAULT_VAT_ID = 2;

/** Sitoo's money format. "230" is rejected, "230.00" is accepted. */
function money(value: unknown): string {
  const n = Number(String(value ?? "").replace(",", "."));
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export interface SitooAddSizeInput {
  /** Existing sizes linked to Sitoo, with the productid the master holds. */
  siblings: Array<{ sku: string; sizeLabel: string; productId: string }>;
  size: { variantId: string; sku: string; barcode: string | null; sizeLabel: string };
  /** "Style Colour", used only when a sibling's title does not end in its size. */
  fallbackTitle: string;
}

export interface SitooAddSizePlan {
  state: "write" | "not-live" | "refused" | "exists" | "skipped" | "failed";
  note?: string;
  /** "family" appends to the parent's variant group; "standalone" mirrors siblings that have none. */
  shape?: "family" | "standalone";
  parentProductId?: number;
  title?: string;
  price?: string;
  copiedFrom?: string;
  /**
   * Set when Sitoo already holds the SKU. With shape "family" it is a product
   * created by an earlier run whose family join failed: the retry joins it
   * instead of creating it again.
   */
  existingProductId?: number;
  sizes?: string[];
  /** The fields copied from the sibling, so the check shows what a missing one would drop. */
  copied?: { vatid: unknown; manufacturerid: unknown; defaultcategoryid: unknown };
}

export interface SitooAddSizeResult extends SitooAddSizePlan {
  written: boolean;
  productId?: string;
}

/** Whether this environment may write to production Sitoo at all. */
export function sitooWriteGate(): string | null {
  if (!(process.env.SITOO_API_ID && process.env.SITOO_API_KEY && process.env.SITOO_BASE_URL))
    return "SITOO_* is not configured in this environment";
  if (process.env.SITOO_CREATE_MODE !== "api")
    return "Sitoo creates are not switched on here (SITOO_CREATE_MODE is not api)";
  if (process.env.SITOO_CREATE_ALLOW_PRODUCTION !== "yes")
    return "production Sitoo creates are not allowed here (SITOO_CREATE_ALLOW_PRODUCTION)";
  return null;
}

interface Resolved {
  plan: SitooAddSizePlan;
  model?: Record<string, unknown>;
  familyRow?: SitooVariantRow;
  groups?: { name: string; options: string[] }[];
}

function titleFor(modelTitle: string | null | undefined, modelSize: string, input: SitooAddSizeInput): string {
  const t = (modelTitle ?? "").trim();
  const suffix = ` ${modelSize}`;
  if (t && t.toUpperCase().endsWith(suffix.toUpperCase()))
    return `${t.slice(0, -suffix.length)} ${input.size.sizeLabel}`.trim();
  return `${input.fallbackTitle} ${input.size.sizeLabel}`.trim();
}

/** Natural size order when every option has one; otherwise the family's own order, new size last. */
function orderSizes(options: string[]): string[] {
  return sortSizes(options) ?? options;
}

async function resolve(input: SitooAddSizeInput): Promise<Resolved> {
  if (!input.siblings.length)
    return { plan: { state: "not-live", note: "not linked to Sitoo — the size goes out with the product's first publish" } };

  const [hit] = await findProductsBySku([input.size.sku], TARGET);
  const mine = hit && normalizeSku(hit.sku) === normalizeSku(input.size.sku) ? hit : null;
  const existsAlready: Resolved = {
    plan: {
      state: "exists",
      existingProductId: mine?.productid,
      note: `Sitoo already has ${mine?.sku} as product ${mine?.productid}`,
    },
  };
  // Already in a family: nothing left to do but link it.
  if (mine?.variantparentid) return existsAlready;

  const found = await findProductsBySku(input.siblings.map((s) => s.sku), TARGET);
  const bySku = new Map(found.map((f) => [normalizeSku(f.sku), f]));
  const linked = input.siblings
    .map((s) => ({ s, hit: bySku.get(normalizeSku(s.sku)) }))
    .filter((x) => x.hit && String(x.hit.productid) === x.s.productId);
  if (!linked.length)
    return {
      plan: {
        state: "refused",
        note: "the master's Sitoo links for this colourway no longer match Sitoo's products — run the Sitoo linker first",
      },
    };

  const parents = [...new Set(linked.map((x) => x.hit!.variantparentid).filter((p): p is number => !!p))];
  if (parents.length > 1)
    return {
      plan: { state: "refused", note: `the sizes sit in ${parents.length} Sitoo families (${parents.join(", ")}) — which one gets the new size is a decision` },
    };
  // The parent references itself, so a sibling with no parent id really is outside the family.
  if (parents.length === 1 && linked.some((x) => !x.hit!.variantparentid))
    return {
      plan: { state: "refused", note: "some sizes are in a Sitoo family and some stand alone — tidy that in Sitoo first" },
    };

  const modelSibling = linked[0];
  const model = (await getProduct(modelSibling.hit!.productid, TARGET)) as unknown as Record<string, unknown>;

  const copied = { vatid: model.vatid, manufacturerid: model.manufacturerid, defaultcategoryid: model.defaultcategoryid };

  // Standalone like its siblings: an existing product is simply the answer.
  if (parents.length === 0 && mine) return existsAlready;

  if (parents.length === 0) {
    const title = titleFor(model.title as string, modelSibling.s.sizeLabel, input);
    return {
      model,
      plan: {
        state: "write",
        shape: "standalone",
        title,
        price: money(model.moneyprice),
        copiedFrom: modelSibling.s.sku,
        copied,
        note: "the existing sizes are separate products in Sitoo, so this one will be too",
      },
    };
  }

  const parentId = parents[0];
  const family = await getProductVariants(parentId, TARGET);
  if (!family) return { plan: { state: "refused", note: `could not read Sitoo family ${parentId}` } };
  if (family.groups.length !== 1)
    return {
      plan: { state: "refused", note: `Sitoo family ${parentId} has ${family.groups.length} variant groups — only a single size group can take a new size` },
    };
  const options = family.groups[0].options;
  if (options.some((o) => o.toUpperCase() === input.size.sizeLabel.toUpperCase()))
    return { plan: { state: "refused", note: `Sitoo family ${parentId} already has a "${input.size.sizeLabel}"` } };

  const familyRow = family.variants.find((v) => normalizeSku(v.sku) === normalizeSku(modelSibling.s.sku));
  if (!familyRow)
    return { plan: { state: "refused", note: `${modelSibling.s.sku} is not in its own Sitoo family ${parentId}` } };

  const title = titleFor(familyRow.title, modelSibling.s.sizeLabel, input);
  const groups = [{ name: family.groups[0].name, options: orderSizes([...options, input.size.sizeLabel]) }];
  return {
    model,
    familyRow,
    groups,
    plan: {
      state: "write",
      shape: "family",
      parentProductId: parentId,
      title,
      price: money(familyRow.moneyprice),
      copiedFrom: modelSibling.s.sku,
      copied,
      sizes: groups[0].options,
      // Created by an earlier run and left standalone when the family PUT
      // failed (the Rototo 21947/21948 shape): join it, do not create it twice.
      ...(mine
        ? {
            existingProductId: mine.productid,
            note: `Sitoo already has ${mine.sku} as product ${mine.productid}, outside the family — it will be joined`,
          }
        : {}),
    },
  };
}

export async function planSitooAddSize(input: SitooAddSizeInput): Promise<SitooAddSizePlan> {
  const r = await resolve(input);
  // The gate is reported on the plan too, so "Save and push" says in advance
  // that Sitoo will be skipped here rather than after the fact.
  const gate = sitooWriteGate();
  if (r.plan.state === "write" && gate) return { ...r.plan, state: "skipped", note: gate };
  return r.plan;
}

export async function applySitooAddSize(input: SitooAddSizeInput): Promise<SitooAddSizeResult> {
  const gate = sitooWriteGate();
  const r = await resolve(input);
  if (r.plan.state === "exists")
    return {
      ...r.plan,
      written: false,
      productId: r.plan.existingProductId ? String(r.plan.existingProductId) : undefined,
    };
  if (r.plan.state !== "write") return { ...r.plan, written: false };
  if (gate) return { ...r.plan, state: "skipped", note: gate, written: false };

  const model = r.model!;
  const before = await productCount(TARGET);

  let productId = r.plan.existingProductId ?? 0;
  if (!productId) {
    const created = await createProducts(
      [
        {
          sku: input.size.sku,
          title: r.plan.title,
          moneyprice: money(model.moneyprice),
          ...(model.moneypricein != null ? { moneypricein: money(model.moneypricein) } : {}),
          vatid: Number(model.vatid) || DEFAULT_VAT_ID,
          ...(model.defaultcategoryid ? { defaultcategoryid: Number(model.defaultcategoryid) } : {}),
          ...(model.manufacturerid ? { manufacturerid: Number(model.manufacturerid) } : {}),
          ...(input.size.barcode ? { barcode: input.size.barcode } : {}),
          activepos: model.activepos !== false,
          stockcountenable: true,
        },
      ],
      TARGET
    );
    const c = created[0];
    if (!c || c.statuscode !== 200 || c.return == null)
      throw new Error(`Sitoo create ${input.size.sku}: ${c?.errortext ?? `statuscode ${c?.statuscode}`}`);
    productId = c.return;
  }

  // From here the product EXISTS in Sitoo, so nothing may throw past this
  // point: the caller has to learn the productid to record the link, or a retry
  // would find an unlinked orphan. A failed join comes back written AND failed.
  if (r.plan.shape === "family") {
    try {
      productId = await joinFamily(input, r, productId);
    } catch (err) {
      return {
        ...r.plan,
        state: "failed",
        written: true,
        productId: String(productId),
        note:
          `created as Sitoo product ${productId} but not joined to family ${r.plan.parentProductId}: ` +
          `${err instanceof Error ? err.message : String(err)} — "Retry what failed" joins it`,
      };
    }
  }

  const after = await productCount(TARGET);
  if (before !== null && after !== null && after < before)
    throw new Error(
      `Sitoo's product count FELL from ${before} to ${after} while adding ${input.size.sku}. ` +
        `Stop and investigate before writing anything else to Sitoo.`
    );

  return { ...r.plan, written: true, productId: String(productId) };
}

/** Append the new product to its siblings' family. Returns its productid as Sitoo now reports it. */
async function joinFamily(input: SitooAddSizeInput, r: Resolved, productId: number): Promise<number> {
  const model = r.model!;
  const parentId = r.plan.parentProductId!;
  // Re-read, never reuse the plan's copy: the PUT replaces the family, and
  // whatever changed in Sitoo since the plan would otherwise be deleted.
  const family = await getProductVariants(parentId, TARGET);
  if (!family || family.groups.length !== 1) throw new Error(`family ${parentId} could not be re-read`);
  const row = r.familyRow!;
  const newRow: SitooVariantRow = {
    productid: productId,
    sku: input.size.sku,
    active: row.active,
    activepos: row.activepos,
    deliverystatus: row.deliverystatus ?? "1",
    title: r.plan.title!,
    attributes: [input.size.sizeLabel],
    moneyprice: money(row.moneyprice),
    moneypriceorg: money(row.moneypriceorg ?? row.moneyprice),
    moneyofferprice: money(row.moneyofferprice),
    // Required on this endpoint; an external brand's sibling may carry none.
    moneypricein: money(row.moneypricein ?? model.moneypricein),
    barcode: input.size.barcode ?? "",
    friendly: input.size.sku.toLowerCase(),
  };
  const options = orderSizes([...new Set([...family.groups[0].options, input.size.sizeLabel])]);
  await setProductVariants(
    parentId,
    { groups: [{ name: family.groups[0].name, options }], variants: [...family.variants, newRow] },
    TARGET
  );
  const [after] = await findProductsBySku([input.size.sku], TARGET);
  return after?.productid ?? productId;
}
