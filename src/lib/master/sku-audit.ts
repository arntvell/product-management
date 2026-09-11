// Where the master's SKUs disagree with themselves.
//
// The catalogue was built by several people over several years across Cin7,
// Threadflow and Shopify, with no enforced convention, so the same garment
// family can carry half a dozen spellings. Keri alone runs to seven stems:
// LIV-KERI-, LIV-KR-, LIV-KRI-, LIV-KRLN-, LIV-KRSRF-, LIV-KRN- and LIV-Keri-C.
//
// This is a report, not a migration. A SKU is an identifier other systems have
// already stored, printed and picked stock against, so rewriting one is a real
// change with real consequences — it belongs behind a decision, not a script.

import { prisma } from "@/lib/db";
import { normalizeSku, parseSku } from "./sku";

/** The retired gender-prefixed scheme: LIV-M-… for men, LIV-W-… for women. */
const LEGACY_STEM = /^LIV-[MW]$/;

export interface StemGroup {
  styleName: string;
  stems: string[];
  skus: string[];
  /** True when one of the stems is the retired LIV-M-/LIV-W- form. */
  legacy: boolean;
}

export interface AliasRow {
  variantSku: string;
  channel: string;
  externalSku: string;
}

export interface SkuAudit {
  /** Styles whose colourways do not agree on a stem. */
  stemDrift: StemGroup[];
  legacyScheme: StemGroup[];
  /** SKUs that are not upper case — they compare unequal to their own twin. */
  mixedCase: string[];
  /** Sizes written 28/34 rather than 2834. */
  slashedSize: string[];
  /** Leftovers from previous merges. */
  tombstones: string[];
  /** What other systems call the same garment. */
  aliases: AliasRow[];
  totals: { colorways: number; variants: number };
}

/** The stem is everything before the colour — prefix plus style tokens. */
function stemOf(sku: string): string {
  const parts = parseSku(sku);
  return [...parts.modifiers, parts.prefix ?? "", parts.body[0] ?? ""]
    .filter(Boolean)
    .join("-");
}

export async function auditSkus(): Promise<SkuAudit> {
  const [colorways, variants, refs] = await Promise.all([
    prisma.colorway.findMany({
      where: { kind: "MERCHANDISE", archived: false },
      select: { colorwaySku: true, style: { select: { styleName: true } } },
    }),
    prisma.variant.findMany({ select: { variantSku: true } }),
    prisma.variantChannelRef.findMany({
      where: { NOT: { externalSku: null } },
      select: {
        channel: true,
        externalSku: true,
        variant: { select: { variantSku: true } },
      },
      orderBy: { externalSku: "asc" },
    }),
  ]);

  const byStyle = new Map<string, string[]>();
  for (const c of colorways) {
    const list = byStyle.get(c.style.styleName) ?? [];
    list.push(c.colorwaySku);
    byStyle.set(c.style.styleName, list);
  }

  const stemDrift: StemGroup[] = [];
  const legacyScheme: StemGroup[] = [];
  for (const [styleName, skus] of byStyle) {
    const stems = [...new Set(skus.map((s) => stemOf(s)))];
    if (stems.length < 2) continue;
    const group: StemGroup = {
      styleName,
      stems: stems.sort(),
      skus: [...skus].sort(),
      legacy: stems.some((s) => LEGACY_STEM.test(s)),
    };
    (group.legacy ? legacyScheme : stemDrift).push(group);
  }
  const byName = (a: StemGroup, b: StemGroup) => a.styleName.localeCompare(b.styleName);
  stemDrift.sort(byName);
  legacyScheme.sort(byName);

  const allSkus = [
    ...colorways.map((c) => c.colorwaySku),
    ...variants.map((v) => v.variantSku),
  ];

  return {
    stemDrift,
    legacyScheme,
    mixedCase: allSkus.filter((s) => s !== s.toUpperCase() && !s.includes("--merged-into-")).sort(),
    slashedSize: allSkus.filter((s) => /\d{2}\/\d{2}/.test(s)).sort(),
    tombstones: allSkus.filter((s) => s.includes("--merged-into-")).sort(),
    aliases: refs
      .filter((r) => normalizeSku(r.variant.variantSku) !== normalizeSku(r.externalSku!))
      .map((r) => ({
        variantSku: r.variant.variantSku,
        channel: r.channel,
        externalSku: r.externalSku!,
      })),
    totals: { colorways: colorways.length, variants: variants.length },
  };
}
