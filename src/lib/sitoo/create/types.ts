// Creating product in Sitoo, behind an interface with two implementations.
//
// WHAT THE API ACTUALLY ALLOWS
//
// docs/sitoo-barnes-recreate.md concluded a create path "does not exist"
// because the v2 products API rejects `variantparentid`. The rejection is real —
// both that field and `variant` are readOnly — but the conclusion drawn from it
// is not. Checked against the published OpenAPI specs (products v2.26,
// product-variants v2.25):
//
//   POST /sites/{site}/products                        creates. `sku` is the
//                                                      ONLY required field.
//   PUT  /sites/{site}/products/{parent}/productvariants
//                                                      sets the family.
//                                                      `productid: 0` creates a
//                                                      child.
//
// So a size run IS creatable — just not through the field the first attempt
// reached for.
//
// FOUR HAZARDS, all documented, all of which this module has to respect:
//
//   1. The variants PUT is a FULL REPLACEMENT. "Any variants omitted from the
//      payload will be deleted." Always GET and merge first.
//   2. Every field must be sent, including deprecated ones, or they reset to
//      defaults. The guide says specifically to keep sending `friendly`.
//   3. The response is `true`. New child productids are NOT returned — re-GET.
//   4. No concurrency. Parallel requests get `429: Too many connections`, which
//      this codebase has already hit once by using a Promise.all.
//
// Customs is NOT sent. Sitoo has no native HS code, country of origin or weight
// field, and by decision those go to Loom and Shopify only — so there are no
// custom attributes to define and no grams-as-integer workaround to maintain.

import type { SitooTarget } from "../client";

export interface SitooCreateVariant {
  variantId: string;
  sku: string;
  barcode: string | null;
  sizeLabel: string;
}

export interface SitooCreateInput {
  colorwayId: string;
  title: string;
  variants: SitooCreateVariant[];
  /** MSRP, incl. VAT — Sitoo's `moneyprice`. */
  priceNok: string | null;
  /** COST, excl. VAT — Sitoo's `moneypricein`. */
  costNok: string | null;
  /** Sitoo manufacturerid, from the brand's linked BrandChannelRef. */
  manufacturerId: string | null;
  /** Sitoo defaultcategoryid, from the category's mapping. */
  defaultCategoryId: string | null;
  /** FK to a Product Group, NOT a percentage. 2 = standard 25%. */
  vatId: string | null;
  active: boolean;
  activePos: boolean;
}

export interface SitooCreatePlanItem {
  colorwayId: string;
  title: string;
  /** SKUs Sitoo already holds — never created again. */
  existing: Array<{ sku: string; productid: number }>;
  /** SKUs that would be created. */
  toCreate: string[];
  /** The size group that would be set on the parent. */
  sizes: string[];
  blocked: string | null;
}

export interface SitooCreatePlan {
  items: SitooCreatePlanItem[];
  /** Sitoo's product count before anything is written — the A6 tripwire. */
  accountProductCount: number | null;
  target: SitooTarget;
  notes: string[];
}

export interface SitooCreateOutcome {
  colorwayId: string;
  ok: boolean;
  mode: "api" | "worklist";
  parentProductId: string | null;
  created: Array<{ variantId: string; productId: string }>;
  /** Set when mode is "worklist": what a person has to go and do. */
  worklist?: string;
  errors: string[];
}

export interface SitooCreator {
  readonly name: string;
  readonly capabilities: { create: boolean; variantFamily: boolean };
  plan(inputs: SitooCreateInput[], opts?: { target?: SitooTarget }): Promise<SitooCreatePlan>;
  apply(
    inputs: SitooCreateInput[],
    opts?: { target?: SitooTarget; dryRun?: boolean }
  ): Promise<SitooCreateOutcome[]>;
}
