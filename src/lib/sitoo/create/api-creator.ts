// Creating a product and its size family through the Sitoo API.
//
// Gated behind SITOO_CREATE_MODE=api, and sandbox-first. Three guards are
// structural rather than remembered:
//
//   A SKU pre-check, so a create can never duplicate something Sitoo already
//   holds. sitoo/link.ts's rule was "the first push must never create"; here it
//   becomes "a create must first prove nothing matches".
//
//   A whole-account product count before and after, aborting on any shrink.
//   Thirteen products (ids 473-485) disappeared during the push on 12 September
//   and the cause is still unknown; that is the only reason the account check
//   exists, and it should not depend on anyone remembering to run it.
//
//   Strict sequencing. Sitoo returns `429: Too many connections` for concurrent
//   requests, so nothing here may be parallelised for speed.

import {
  createProducts,
  findProductsBySku,
  getProductVariants,
  setProductVariants,
  productCount,
  resolveTarget,
  type SitooTarget,
  type SitooProductCreate,
  type SitooVariantRow,
} from "../client";
import { normalizeSku } from "@/lib/master/sku";
import type {
  SitooCreator,
  SitooCreateInput,
  SitooCreatePlan,
  SitooCreatePlanItem,
  SitooCreateOutcome,
} from "./types";

export class SitooCreateError extends Error {}

const DEFAULT_VAT_ID = 2; // standard 25%, per docs/sitoo-barnes-recreate.md

/**
 * Sitoo's money format, which it enforces: `[-+]?[0-9]+\.[0-9][0-9]`.
 *
 * "0" is rejected. "0.00" is accepted. Every price field has to go through here
 * rather than being passed along as whatever the master happens to hold.
 */
function money(value: string | null | undefined): string {
  const n = Number((value ?? "").toString().replace(",", "."));
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export const apiCreator: SitooCreator = {
  name: "sitoo-api",
  capabilities: { create: true, variantFamily: true },

  async plan(inputs, opts = {}): Promise<SitooCreatePlan> {
    const target = resolveTarget(opts.target);
    const notes: string[] = [];
    const items: SitooCreatePlanItem[] = [];

    const before = await productCount(target);

    for (const input of inputs) {
      const skus = input.variants.map((v) => v.sku);
      const found = await findProductsBySku(skus, target);
      const bySku = new Map(found.map((f) => [normalizeSku(f.sku), f]));

      const existing = skus
        .map((s) => ({ sku: s, hit: bySku.get(normalizeSku(s)) }))
        .filter((x) => x.hit)
        .map((x) => ({ sku: x.sku, productid: x.hit!.productid }));

      items.push({
        colorwayId: input.colorwayId,
        title: input.title,
        existing,
        toCreate: skus.filter((s) => !bySku.has(normalizeSku(s))),
        sizes: input.variants.map((v) => v.sizeLabel),
        blocked:
          input.variants.length === 0
            ? "no sizes"
            : existing.length === skus.length
              ? "every SKU already exists in Sitoo"
              : null,
      });
    }

    if (before === null)
      notes.push("Could not read Sitoo's product count — the account tripwire is unavailable.");

    return { items, accountProductCount: before, target, notes };
  },

  async apply(inputs, opts = {}): Promise<SitooCreateOutcome[]> {
    const target = resolveTarget(opts.target);
    if (target === "production" && process.env.SITOO_CREATE_ALLOW_PRODUCTION !== "yes")
      throw new SitooCreateError(
        "Refusing to create in Sitoo production. Rehearse against the sandbox first, " +
          "then set SITOO_CREATE_ALLOW_PRODUCTION=yes deliberately."
      );

    const plan = await this.plan(inputs, { target });
    if (opts.dryRun)
      return plan.items.map((i) => ({
        colorwayId: i.colorwayId,
        ok: !i.blocked,
        mode: "api" as const,
        parentProductId: null,
        created: [],
        errors: i.blocked ? [i.blocked] : [],
      }));

    const before = plan.accountProductCount;
    const outcomes: SitooCreateOutcome[] = [];

    for (const input of inputs) {
      const planned = plan.items.find((i) => i.colorwayId === input.colorwayId);
      if (planned?.blocked) {
        outcomes.push({
          colorwayId: input.colorwayId,
          ok: false,
          mode: "api",
          parentProductId: null,
          created: [],
          errors: [planned.blocked],
        });
        continue;
      }

      try {
        outcomes.push(await createOne(input, planned!, target));
      } catch (err) {
        outcomes.push({
          colorwayId: input.colorwayId,
          ok: false,
          mode: "api",
          parentProductId: null,
          created: [],
          errors: [err instanceof Error ? err.message : String(err)],
        });
      }
    }

    // The tripwire. A shrink means something removed product while we were
    // writing, which is the 12 September signature and must stop everything.
    const after = await productCount(target);
    if (before !== null && after !== null && after < before)
      throw new SitooCreateError(
        `Sitoo's product count FELL from ${before} to ${after} during this run. ` +
          `Thirteen products vanished unexplained on 12 September; stop and investigate ` +
          `before writing anything else.`
      );

    return outcomes;
  },
};

async function createOne(
  input: SitooCreateInput,
  planned: SitooCreatePlanItem,
  target: SitooTarget
): Promise<SitooCreateOutcome> {
  const errors: string[] = [];

  // 1. Create every SKU that does not exist yet, as plain products. The family
  //    is set afterwards — variantparentid is readOnly and cannot be posted.
  const toCreate = input.variants.filter((v) => planned.toCreate.includes(v.sku));
  const payload: SitooProductCreate[] = toCreate.map((v) => ({
    sku: v.sku,
    title: `${input.title} ${v.sizeLabel}`.trim(),
    ...(input.priceNok ? { moneyprice: input.priceNok } : {}),
    ...(input.costNok ? { moneypricein: input.costNok } : {}),
    vatid: input.vatId ? Number(input.vatId) : DEFAULT_VAT_ID,
    ...(input.defaultCategoryId ? { defaultcategoryid: Number(input.defaultCategoryId) } : {}),
    ...(input.manufacturerId ? { manufacturerid: Number(input.manufacturerId) } : {}),
    ...(v.barcode ? { barcode: v.barcode } : {}),
    activepos: input.activePos,
    stockcountenable: true,
  }));

  const results = payload.length ? await createProducts(payload, target) : [];
  // A batch returns 200 even when items fail — read each one.
  results.forEach((r, i) => {
    if (r.statuscode !== 200 || r.return == null)
      errors.push(`${payload[i].sku}: ${r.errortext ?? `statuscode ${r.statuscode}`}`);
  });

  // 2. Learn every productid, including the ones that already existed.
  const all = await findProductsBySku(
    input.variants.map((v) => v.sku),
    target
  );
  const idBySku = new Map(all.map((p) => [normalizeSku(p.sku), p.productid]));

  const missing = input.variants.filter((v) => !idBySku.has(normalizeSku(v.sku)));
  if (missing.length)
    errors.push(`Sitoo has no product for ${missing.map((m) => m.sku).join(", ")} after create.`);

  const resolved = input.variants.filter((v) => idBySku.has(normalizeSku(v.sku)));
  if (!resolved.length)
    return {
      colorwayId: input.colorwayId,
      ok: false,
      mode: "api",
      parentProductId: null,
      created: [],
      errors,
    };

  // 3. Set the family on the FIRST product — the parent is one of the sizes,
  //    self-referencing, which is how Sitoo models "the main variant".
  const parentId = idBySku.get(normalizeSku(resolved[0].sku))!;

  // FULL REPLACEMENT: read what is there and merge, or the PUT deletes whatever
  // it does not mention.
  const current = await getProductVariants(parentId, target);
  const currentBySku = new Map(
    (current?.variants ?? []).map((v) => [normalizeSku(v.sku), v])
  );

  const rows: SitooVariantRow[] = resolved.map((v) => {
    const existing = currentBySku.get(normalizeSku(v.sku));
    return {
      productid: idBySku.get(normalizeSku(v.sku))!,
      sku: v.sku,
      // Deprecated but required — the PUT 400s without each of these.
      active: input.active,
      deliverystatus: existing?.deliverystatus ?? "1",
      activepos: input.activePos,
      title: `${input.title} ${v.sizeLabel}`.trim(),
      attributes: [v.sizeLabel],
      // All three price fields are required by this endpoint. Defaulting to the
      // retail price rather than "0" matters: moneypriceorg is the struck-through
      // "original" price, and a zero there would show the garment as a 100%
      // discount on the till.
      moneyprice: money(input.priceNok ?? existing?.moneyprice),
      moneypriceorg: money(existing?.moneypriceorg ?? input.priceNok),
      moneyofferprice: money(existing?.moneyofferprice),
      ...(input.costNok ? { moneypricein: money(input.costNok) } : {}),
      // Required on this endpoint. An empty string is how you say "none" —
      // `barcode: null` is rejected with a 400, which updateBarcode already
      // documents for the product endpoint and which holds here too.
      barcode: v.barcode ?? existing?.barcode ?? "",
      // Deprecated, but the guide is explicit that it must still be sent and
      // must be unique. The SKU is what it recommends.
      friendly: existing?.friendly || v.sku.toLowerCase(),
    };
  });

  // Anything already in the family that is not ours stays — omitting it would
  // delete it.
  for (const [key, v] of currentBySku)
    if (!resolved.some((r) => normalizeSku(r.sku) === key)) rows.push(v);

  const sizes = [...new Set(rows.map((r) => r.attributes[0]).filter(Boolean))];
  await setProductVariants(
    parentId,
    { groups: [{ name: "Size", options: sizes }], variants: rows },
    target
  );

  // 4. The PUT answers `true` and nothing else, so re-read to learn the ids the
  //    children were actually given.
  const after = await findProductsBySku(
    input.variants.map((v) => v.sku),
    target
  );
  const finalIds = new Map(after.map((p) => [normalizeSku(p.sku), p.productid]));

  return {
    colorwayId: input.colorwayId,
    ok: errors.length === 0,
    mode: "api",
    parentProductId: String(parentId),
    created: input.variants
      .filter((v) => finalIds.has(normalizeSku(v.sku)))
      .map((v) => ({
        variantId: v.variantId,
        productId: String(finalIds.get(normalizeSku(v.sku))!),
      })),
    errors,
  };
}
