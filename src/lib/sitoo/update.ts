// Bringing a product the till ALREADY sells up to date with the master.
//
// The gap this fills: title and price reach Sitoo on CREATE only. `api-creator`
// refuses a colorway whose SKUs all exist ("every SKU already exists in Sitoo")
// and `apply()` skips it, which is correct for a creator and leaves no path at
// all for a rename or a reprice. So the master could be edited and the till kept
// showing the old name and the old price indefinitely, with nothing anywhere
// saying so.
//
// Scope is deliberately narrow, like push.ts: title and retail price, on
// products that exist. It does not create, it does not touch barcodes or SKUs
// (updateBarcode and updateSku own those), and it does not publish.
//
// THE TITLE IS THE MASTER'S NAME, VERBATIM. No size is appended. `createOne`
// appends `sizeLabel`, which is where the 16 live titles ending ", OS" and " OS"
// came from — the size is already carried by the family's `attributes`, and the
// only place a size belongs in a title is the online-vintage drop flow, where it
// is typed into the name and goes to Shopify.
//
// Guards are the ones api-creator established, for the same reasons: production
// named explicitly, strictly sequential calls (Sitoo answers 429 to anything
// concurrent), and a whole-account product count before and after — thirteen
// products vanished unexplained on 12 September and the tripwire should not
// depend on anyone remembering to look.
//
// ITS OWN SWITCH, deliberately not the creator's.
//
// `SITOO_CREATE_ALLOW_PRODUCTION` is set in production, granted on 2026-09-21 so
// the product wizard could publish NEW products to three channels
// (docs/sitoo-live-creates-2026-09-21.md). Reusing it here would have meant that
// one decision silently authorised something else: renaming and repricing the
// 2,367 products the till already sells, in bulk, from a grid. A permission is
// for an operation, not for a system — so this asks for its own.
//
// The cost is one more variable to set. The alternative is a switch whose
// meaning grows every time someone adds a writer, which is how a guard stops
// being one.

import { prisma } from "@/lib/db";
import { channelProductTitle } from "@/lib/master/channel-title";
import { normalizeSku } from "@/lib/master/sku";
import {
  findProductsBySku,
  getProductVariants,
  listProducts,
  productCount,
  resolveTarget,
  setProductVariants,
  toWritableVariantRow,
  updateTitleAndPrice,
  type SitooTarget,
  type SitooVariantRow,
} from "./client";

export class SitooUpdateError extends Error {}

/** Sitoo's money format, which it enforces. "0" is rejected; "0.00" is not. */
function money(value: string | number | null | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value.toString().replace(",", "."));
  return Number.isFinite(n) ? n.toFixed(2) : undefined;
}

/**
 * Sitoo answers `429: Too many connections` when anything else on the account is
 * mid-request. A 429 is a refusal — nothing was done — so the same call is safe
 * to repeat; everything else is thrown as it came.
 */
async function retry429<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt >= 4 || !/429|too many connections/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

export interface SitooUpdateRow {
  colorwayId: string;
  colorwaySku: string;
  variantSku: string;
  productId: number;
  /** "plain" writes through PUT /products/{id}; "family" through the variants PUT. */
  shape: "plain" | "family";
  /**
   * The family this product belongs to, from `variantparentid`. Self-parented
   * for a family of one, another product's id for a real child, null for a plain
   * product. Carried from the read so the apply does not re-GET to find it.
   */
  parentId: number | null;
  titleFrom: string;
  titleTo: string;
  priceFrom: string | null;
  priceTo: string | null;
  get changes(): boolean;
}

export interface SitooUpdatePlan {
  rows: SitooUpdateRow[];
  /**
   * Sizes the TILL sells that the master has never heard of.
   *
   * Sitoo gives every size its own product row, and a family PUT must carry them
   * all — so a size the master does not know is passed back untouched and keeps
   * whatever price it had. That is the only safe behaviour (omitting a row
   * deletes the size), but it means a price change can succeed and leave most of
   * a product wrong: 727 of the 2,057 linked colorways have sizes the master
   * lacks, 2,997 in total, and one Livid jean has 1 size here against 29 there.
   *
   * Reported so a push can say so before it runs, rather than being discovered
   * at the counter.
   */
  untouchedSizes: Array<{ colorwaySku: string; inMaster: number; inSitoo: number }>;
  /** Linked in the master but absent from Sitoo — nothing to update. */
  missing: string[];
  /** No NOK MSRP in the master, so the price is left alone rather than zeroed. */
  withoutPrice: string[];
  accountProductCount: number | null;
  target: SitooTarget;
}

function row(
  base: Omit<SitooUpdateRow, "changes">
): SitooUpdateRow {
  return {
    ...base,
    get changes() {
      return (
        this.titleFrom !== this.titleTo ||
        (this.priceTo != null && this.priceFrom !== this.priceTo)
      );
    },
  };
}

/** What a push WOULD do. GETs only — safe against any account. */
export async function planSitooUpdate(
  colorwayIds: string[],
  opts: { target?: SitooTarget } = {}
): Promise<SitooUpdatePlan> {
  const target = resolveTarget(opts.target);

  const cws = await prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    select: {
      id: true,
      name: true,
      colorwaySku: true,
      style: { select: { styleName: true } },
      prices: {
        where: { currency: "NOK", priceType: "MSRP" },
        select: { amount: true },
        take: 1,
      },
      variants: {
        select: {
          variantSku: true,
          channelRefs: {
            where: { channel: "SITOO" },
            select: { externalId: true },
          },
        },
      },
    },
  });

  const bySku = new Map<string, { cw: (typeof cws)[number]; variantSku: string }>();
  for (const cw of cws)
    for (const v of cw.variants)
      if (v.channelRefs.length)
        bySku.set(normalizeSku(v.variantSku), { cw, variantSku: v.variantSku });

  const accountProductCount = await productCount(target);
  const found = await findProductsBySku([...bySku.keys()], target);
  const foundBySku = new Map(found.map((p) => [normalizeSku(p.sku), p]));

  // One listing of the account, not one family read per colorway: a selection of
  // 250 would otherwise be 250 sequential GETs against an API that answers 429
  // to anything concurrent. 15 pages covers all 14,757 products.
  const all = await listProducts(target);
  const parentOf = new Map<number, number>();
  const familySize = new Map<number, number>();
  for (const p of all) {
    const parent = p.variantparentid;
    if (parent == null) continue;
    parentOf.set(p.productid, parent);
    familySize.set(parent, (familySize.get(parent) ?? 0) + 1);
  }

  const rows: SitooUpdateRow[] = [];
  const missing: string[] = [];
  const withoutPrice: string[] = [];

  for (const [key, { cw, variantSku }] of bySku) {
    const p = foundBySku.get(key);
    if (!p) {
      missing.push(variantSku);
      continue;
    }
    const priceTo = money(cw.prices[0]?.amount?.toString());
    if (!priceTo) withoutPrice.push(variantSku);
    rows.push(
      row({
        colorwayId: cw.id,
        colorwaySku: cw.colorwaySku,
        variantSku,
        productId: p.productid,
        // A product that is part of a size family has to be written through the
        // variants PUT: that endpoint carries a title per row, and a product-row
        // write would leave the row the till reads untouched.
        shape: p.variantparentid == null ? "plain" : "family",
        parentId: p.variantparentid ?? null,
        titleFrom: (p.title ?? "").trim(),
        // The composed title, so the till agrees with Shopify on products that
        // have both. For vintage the style IS the product, so this is the name.
        titleTo: channelProductTitle({ name: cw.name, style: cw.style }),
        priceFrom: p.moneyprice ?? null,
        priceTo: priceTo ?? null,
      })
    );
  }

  // Per colorway: how many of its family's rows this push can actually reach.
  const byColorway = new Map<string, { sku: string; ids: number[] }>();
  for (const r of rows) {
    const e = byColorway.get(r.colorwayId) ?? { sku: r.colorwaySku, ids: [] };
    e.ids.push(r.productId);
    byColorway.set(r.colorwayId, e);
  }
  const untouchedSizes: SitooUpdatePlan["untouchedSizes"] = [];
  for (const { sku, ids } of byColorway.values()) {
    const parents = new Set(ids.map((i) => parentOf.get(i)).filter((x): x is number => x != null));
    if (parents.size !== 1) continue; // standalone products, or a split family
    const inSitoo = familySize.get([...parents][0]) ?? ids.length;
    if (inSitoo > ids.length)
      untouchedSizes.push({ colorwaySku: sku, inMaster: ids.length, inSitoo });
  }

  return { rows, missing, withoutPrice, accountProductCount, target, untouchedSizes };
}

export interface SitooUpdateResult {
  /**
   * PRODUCT ROWS written, which is not the same as products in the master.
   *
   * Sitoo gives every size its own product row, so one colorway is four rows for
   * a four-size shoe. Reporting these next to a colorway count produced
   * "Sitoo 4/1" — four of one — on a push that had gone perfectly.
   */
  updated: number;
  unchanged: number;
  failed: Array<{ variantSku: string; error: string }>;
  missing: string[];
  /** The same run counted in COLORWAYS, so a caller can report one unit. */
  colorwaysOk: number;
  colorwaysFailed: number;
}

/** Write the plan. Sequential, guarded, and it re-reads what it wrote. */
export async function applySitooUpdate(
  colorwayIds: string[],
  opts: { target?: SitooTarget } = {}
): Promise<SitooUpdateResult> {
  const target = resolveTarget(opts.target);
  if (target === "production" && process.env.SITOO_UPDATE_ALLOW_PRODUCTION !== "yes")
    throw new SitooUpdateError(
      "Refusing to rename or reprice in Sitoo production. This is not covered by " +
        "SITOO_CREATE_ALLOW_PRODUCTION, which authorises creating products — set " +
        "SITOO_UPDATE_ALLOW_PRODUCTION=yes to allow changing ones the till already sells."
    );

  const plan = await planSitooUpdate(colorwayIds, { target });
  const before = plan.accountProductCount;
  const todo = plan.rows.filter((r) => r.changes);

  const failed: SitooUpdateResult["failed"] = [];
  let updated = 0;

  // Plain products first, one PUT each. The endpoint patches, so only the keys
  // sent move.
  for (const r of todo.filter((x) => x.shape === "plain")) {
    try {
      await retry429(() =>
        updateTitleAndPrice(
          r.productId,
          {
            ...(r.titleFrom !== r.titleTo ? { title: r.titleTo } : {}),
            ...(r.priceTo && r.priceFrom !== r.priceTo ? { moneyprice: r.priceTo } : {}),
          },
          target
        )
      );
      updated++;
    } catch (err) {
      failed.push({
        variantSku: r.variantSku,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Families: one PUT per family, carrying every existing row. The PUT is a FULL
  // REPLACEMENT — a row omitted is a size deleted — so rows that are not ours are
  // passed back verbatim.
  const families = new Map<number, SitooUpdateRow[]>();
  for (const r of todo.filter((x) => x.shape === "family")) {
    // `variantparentid` IS the family key — self for a family of one, the
    // parent's id for a real child. Grouping on it means one PUT per family
    // however many of its sizes are being renamed.
    const parentId = r.parentId ?? r.productId;
    families.set(parentId, [...(families.get(parentId) ?? []), r]);
  }

  for (const [parentId, members] of families) {
    try {
      const fam = await retry429(() => getProductVariants(parentId, target));
      const current: SitooVariantRow[] = fam?.variants ?? [];
      const mine = new Map(members.map((m) => [m.productId, m]));
      const next = current.map((v) => {
        // Every row goes through toWritableVariantRow, ours and foreign alike.
        // The GET carries fields the PUT refuses outright — `pricelisthasvolume`
        // is the one that failed a live push — so a row cannot be handed back
        // as it arrived, even when nothing about it is changing.
        const row = toWritableVariantRow(v);
        const m = mine.get(v.productid);
        if (!m) return row; // not ours: unchanged, but still rebuilt
        return {
          ...row,
          title: m.titleTo,
          ...(m.priceTo ? { moneyprice: m.priceTo } : {}),
          // moneypriceorg and moneyofferprice are passed through untouched:
          // defaulting org to the retail price shows the garment as a discount.
        };
      });
      const sizes = [...new Set(next.map((r) => r.attributes?.[0]).filter(Boolean))];
      await retry429(() =>
        setProductVariants(
          parentId,
          { groups: [{ name: "Size", options: sizes as string[] }], variants: next },
          target
        )
      );
      updated += members.length;
    } catch (err) {
      for (const m of members)
        failed.push({
          variantSku: m.variantSku,
          error: err instanceof Error ? err.message : String(err),
        });
    }
  }

  // The tripwire. A shrink means something removed product while we were
  // writing, which is the 12 September signature and must stop everything.
  const after = await productCount(target);
  if (before !== null && after !== null && after < before)
    throw new SitooUpdateError(
      `Sitoo's product count FELL from ${before} to ${after} during this run. ` +
        `Thirteen products vanished unexplained on 12 September; stop and ` +
        `investigate before writing anything else.`
    );

  // A colorway counts as done only if none of its rows failed: a shoe with one
  // size left on the old price is not updated, it is half-updated.
  const failedSkus = new Set(failed.map((f) => f.variantSku));
  const touched = new Set(plan.rows.map((r) => r.colorwayId));
  const colorwaysFailed = new Set(
    plan.rows.filter((r) => failedSkus.has(r.variantSku)).map((r) => r.colorwayId)
  );

  return {
    updated,
    unchanged: plan.rows.length - todo.length,
    failed,
    missing: plan.missing,
    colorwaysOk: touched.size - colorwaysFailed.size,
    colorwaysFailed: colorwaysFailed.size,
  };
}
