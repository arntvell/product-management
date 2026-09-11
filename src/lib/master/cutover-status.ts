// State of the cutover, read from the database.
//
// Each step of docs/cutover-runbook.md leaves a trace. This reads those traces
// so the surface can show what has actually been done rather than what someone
// remembers doing.

import { prisma } from "@/lib/db";
import { RANGE_INTERNAL, RANGE_PRODUCTION } from "./barcode";

export interface CutoverStep {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  /** Numbers worth showing next to the step. */
  stats: Array<{ label: string; value: string }>;
}

export interface CutoverStatus {
  steps: CutoverStep[];
  /** Set when the schema is ahead of the database — nothing else can be read. */
  migrationError: string | null;
}

function n(x: number): string {
  return x.toLocaleString("en-GB");
}

export async function getCutoverStatus(): Promise<CutoverStatus> {
  try {
    const [
      variants,
      withBarcode,
      distinctBarcode,
      ledgerProduction,
      ledgerInternal,
      kindCounts,
      sitooRefs,
      shopifyRefs,
      attributed,
      colorways,
    ] = await Promise.all([
      prisma.variant.count(),
      prisma.variant.count({ where: { NOT: { barcode: null } } }),
      // COUNT(DISTINCT ...) in SQL. Prisma's `distinct` is applied client-side,
      // so the findMany form loads every barcode into memory on every render of
      // this force-dynamic page.
      prisma
        .$queryRaw<[{ c: bigint }]>`SELECT COUNT(DISTINCT "barcode") AS c FROM "Variant" WHERE "barcode" IS NOT NULL`
        .then((r) => Number(r[0]?.c ?? 0)),
      prisma.barcodeAllocation.findFirst({
        where: { range: RANGE_PRODUCTION },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      }),
      prisma.barcodeAllocation.findFirst({
        where: { range: RANGE_INTERNAL },
        orderBy: { sequence: "desc" },
        select: { sequence: true },
      }),
      prisma.colorway.groupBy({ by: ["kind"], _count: { _all: true } }),
      prisma.variantChannelRef.count({ where: { channel: "SITOO" } }),
      prisma.variantChannelRef.count({ where: { channel: "SHOPIFY" } }),
      prisma.fieldOwner.count({ where: { NOT: { authority: null } } }),
      prisma.colorway.count(),
    ]);

    const ledgerTotal = await prisma.barcodeAllocation.count();
    const nonMerch = kindCounts
      .filter((k) => k.kind !== "MERCHANDISE")
      .reduce((a, b) => a + b._count._all, 0);
    const duplicates = withBarcode - distinctBarcode;

    const steps: CutoverStep[] = [
      {
        key: "ledger",
        label: "Barcode ledger loaded",
        detail:
          "Every issued number recorded, so allocation cannot reissue one that is already on a garment.",
        done: ledgerTotal > 0,
        stats: [
          { label: "recorded", value: n(ledgerTotal) },
          { label: `${RANGE_PRODUCTION} high-water`, value: n(ledgerProduction?.sequence ?? 0) },
          { label: `${RANGE_INTERNAL} high-water`, value: n(ledgerInternal?.sequence ?? 0) },
        ],
      },
      {
        key: "kind",
        label: "Product kind classified",
        detail:
          "Merchandise, material, aggregate and the rest, held in the model instead of a reconciliation script.",
        done: nonMerch > 0,
        stats: [
          { label: "colorways", value: n(colorways) },
          { label: "not merchandise", value: n(nonMerch) },
          ...kindCounts
            .filter((k) => k.kind !== "MERCHANDISE")
            .map((k) => ({ label: k.kind.toLowerCase(), value: n(k._count._all) })),
        ],
      },
      {
        key: "link",
        label: "Channels linked",
        detail:
          "Each Origio variant mapped to the Sitoo product and Shopify variant that already represent it. Matching only — neither linker creates.",
        done: sitooRefs > 0 || shopifyRefs > 0,
        stats: [
          { label: "variants", value: n(variants) },
          { label: "sitoo", value: n(sitooRefs) },
          { label: "shopify", value: n(shopifyRefs) },
        ],
      },
      {
        key: "attribution",
        label: "Corrections attributed",
        detail:
          'Values carry the authority that decided them, so "why does this say X?" is answerable from the database.',
        done: attributed > 0,
        stats: [{ label: "fields with an authority", value: n(attributed) }],
      },
      {
        key: "unique",
        label: "Barcode uniqueness enforced",
        detail:
          "The last migration. Until it runs, one barcode can sit on two garments and nothing objects.",
        done: duplicates === 0 && withBarcode > 0,
        stats: [
          { label: "with a barcode", value: n(withBarcode) },
          { label: "distinct", value: n(distinctBarcode) },
          { label: "blocking rows", value: n(duplicates) },
        ],
      },
    ];

    return { steps, migrationError: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { steps: [], migrationError: message };
  }
}
