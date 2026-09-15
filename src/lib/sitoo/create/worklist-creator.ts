// The default: emit a worklist, create in the Sitoo UI, then run the linker.
//
// This writes NOTHING to Sitoo, and it ships first for a reason. WORK-DECK B3
// names 38 shop-floor SKUs absent from Sitoo — stock nobody can ring up — and
// that is unblocked by a file and a person, today, without waiting for a write
// path to be trusted. It is also the honest answer for "Sitoo is preselected":
// the batch says "worklist emitted, awaiting the linker", never "pushed".

import { toCsv, UTF8_BOM } from "@/lib/csv";
import { resolveTarget } from "../client";
import type {
  SitooCreator,
  SitooCreateInput,
  SitooCreatePlan,
  SitooCreateOutcome,
} from "./types";

const HEADERS = [
  "SKU",
  "Title",
  "Size",
  "Barcode",
  "Price (moneyprice, incl VAT)",
  "Cost (moneypricein, excl VAT)",
  "VAT id",
  "Category id",
  "Manufacturer id",
  "Active POS",
];

export function sitooWorklistCsv(inputs: SitooCreateInput[]): string {
  const rows: string[][] = [];
  for (const i of inputs)
    for (const v of i.variants)
      rows.push([
        v.sku,
        `${i.title} ${v.sizeLabel}`.trim(),
        v.sizeLabel,
        v.barcode ?? "",
        i.priceNok ?? "",
        i.costNok ?? "",
        i.vatId ?? "2",
        i.defaultCategoryId ?? "",
        i.manufacturerId ?? "",
        i.activePos ? "yes" : "no",
      ]);
  return UTF8_BOM + toCsv(HEADERS, rows);
}

export const worklistCreator: SitooCreator = {
  name: "sitoo-worklist",
  capabilities: { create: false, variantFamily: false },

  async plan(inputs, opts = {}): Promise<SitooCreatePlan> {
    return {
      target: resolveTarget(opts.target),
      accountProductCount: null,
      notes: [
        "Worklist mode: nothing is written to Sitoo. Create the rows in the Sitoo UI, " +
          "then run the Sitoo linker to bind them back to the master.",
      ],
      items: inputs.map((i) => ({
        colorwayId: i.colorwayId,
        title: i.title,
        existing: [],
        toCreate: i.variants.map((v) => v.sku),
        sizes: i.variants.map((v) => v.sizeLabel),
        blocked: i.variants.length ? null : "no sizes",
      })),
    };
  },

  async apply(inputs): Promise<SitooCreateOutcome[]> {
    const csv = sitooWorklistCsv(inputs);
    return inputs.map((i) => ({
      colorwayId: i.colorwayId,
      ok: true,
      mode: "worklist" as const,
      parentProductId: null,
      created: [],
      worklist: csv,
      errors: [],
    }));
  },
};
