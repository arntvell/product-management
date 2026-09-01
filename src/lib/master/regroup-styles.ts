// Re-model Cin7-imported products as colorways under real parent styles.
//
// Cin7 has no style concept — only flat variant SKUs, grouped into families of
// one colour. Our importer therefore created one Style per colour, copying the
// same string into styleName and the colorway name. Loom read the feed exactly
// as it was written and built 91 one-colour styles.
//
// This pass corrects the model. The three groups come from Loom's handover of
// 1 September, reconciled against our own data:
//
//   DUPLICATE (17) — the colorway already exists under the right parent, from
//                    Threadflow. Archive ours; do not re-point it, or the
//                    parent ends up with two copies of the same colour.
//   REGROUP   (29) — the parent style already exists here. Re-parent, and take
//                    the garment name off the front of the colorway name.
//   NEW       (45) — no parent exists at all. Create the style, then as above.
import { prisma } from "@/lib/db";

/** Colorways Loom already holds under the correct parent — withdraw ours. */
export const DUPLICATE_SKUS = [
  "LIV-ABY-WH", "LIV-COT-WHT", "LIV-V-WHT", "LIV-ID-BLCK",
  "LIV-INTL-CLST-OX", "LIV-INTL-CLST-PNSTRP-OX", "LIV-INTL-GRY-OX", "LIV-INTL-WHT-OX",
  "LIV-K-JPN-BLCK", "LIV-KRI-JPN-SNDBX", "LIV-KR-JPN-DWN", "LIV-ML-WHT",
  "LIV-NAR-WHT", "LIV-Needle-W", "LIV-SRN-JPN-BLCK-DSK", "LIV-T-JPN-BLCK",
  "LIV-T-JPN-NW-BL",
] as const;

/**
 * Garments with no style record anywhere, and the colorways belonging to them.
 * Livid confirmed each of these; the judgement calls are noted where they
 * differ from grouping on the leading word.
 */
export const NEW_STYLE_GROUPS: { style: string; skus: string[]; note?: string }[] = [
  { style: "Alesis", skus: ["LIV-ALSS-BLCK"] },
  { style: "Ayon", skus: ["LIV-AYO-BLK", "LIV-AYO-GAR-GRN", "LIV-AYN-GRY"],
    note: "one garment; the three Cin7 categories were a mis-categorisation" },
  { style: "Brass", skus: ["LIV-BRS-BLU-POP", "LIV-BRS-GRY-SER", "LIV-BRS-JAP-BON", "LIV-BRS-VOI-STR"] },
  { style: "Buzz", skus: ["LIV-BZZ-BLCK"] },
  { style: "Dunn", skus: ["LIV-DNN-BLCK", "LIV-DUNN-NVY"] },
  { style: "Elmer", skus: ["LIV-ELM-GRY-MEL", "LIV-ELMR-SHDW-RB", "LIV-ELM-WHT"] },
  { style: "Gill", skus: ["LIV-GLL-BRWN-WX"], note: "distinct from Gillish" },
  { style: "Hayes Suit Jacket", skus: ["LIV-HYS-ST-JCKT-SNGL-BRSTD-BLCK"],
    note: "Hayes splits: jacket and trouser are separate garments" },
  { style: "Hayes Suit Pant", skus: ["LIV-HYS-ST-PNT-BLCK"], note: "see above" },
  { style: "Henrey", skus: ["LIV-HNRY-FD-OK-TWLL", "LIV-HNRY-GRPHT-TWLL", "LIV-HNRY-JPN-INDG-DSK"] },
  { style: "Hilda", skus: ["LIV-HLD-BLCK", "LIV-HLD-CHRCL"] },
  { style: "Huff", skus: ["LIV-HUF-BLK-WOL"] },
  { style: "Joelle", skus: ["LIV-JLL-JPN-BLCK", "LIV-JLL-JPN-DWN"] },
  { style: "Kalum", skus: ["LIV-KAL-JAP-SLA"] },
  { style: "Kavon", skus: ["LIV-KAV-WHT"] },
  { style: "Keen", skus: ["LIV-KN-JP-BKNL-S"] },
  { style: "Keri Surf", skus: ["LIV-KER-SURF-JAP-BLU"],
    note: "a short — not the Keri jeans, despite the leading word" },
  { style: "Kerin", skus: ["LIV-KRN-BLCK", "LIV-KRN-CHRCL", "LIV-KRN-TP"] },
  { style: "Kevin", skus: ["LIV-KVN-GRY", "LIV-KVN-NVY"] },
  { style: "Lerke", skus: ["LIV-LRK-BLCK", "LIV-LRK-CHRCL"] },
  { style: "Naia", skus: ["LIV-N-BLCK"] },
  { style: "Nash", skus: ["LIV-NSH-BLCK", "LIV-NSH-TP"] },
  { style: "Pen", skus: ["LIV-PN-BLCK-TCH", "LIV-PEN-STN"] },
  { style: "Rickon", skus: ["LIV-RCKN-WHT"] },
  { style: "Tate", skus: ["LIV-TT-BLCK", "LIV-TT-CHRCL"] },
  { style: "Turnip", skus: ["LIV-TUR-KHKI"] },
];

/** Cases where the colorway name must not decide the parent. */
const PARENT_OVERRIDE: Record<string, string> = {
  // The SKU says Henrey; the name says Initial. Livid confirmed: Initial.
  "LIV-HNRY-NVY-PNSTRP": "Initial",
};

/** Ayon's three colorways are one garment, mis-categorised in Cin7. */
const CATEGORY_OVERRIDE: Record<string, string> = {
  "LIV-AYO-BLK": "Sweatshirt",
  "LIV-AYO-GAR-GRN": "Sweatshirt",
  "LIV-AYN-GRY": "Sweatshirt",
};

export interface RegroupAction {
  kind: "archive" | "regroup" | "new-style";
  colorwayId: string;
  colorwaySku: string;
  fromStyleSku: string;
  fromName: string;
  toStyleName?: string;
  toStyleSku?: string;
  toName?: string;
  createsStyle?: boolean;
  note?: string;
}

export interface RegroupPlan {
  actions: RegroupAction[];
  stylesToCreate: string[];
  counts: {
    archive: number;
    regroup: number;
    newStyle: number;
    stylesCreated: number;
    unmatched: number;
  };
  unmatched: { colorwaySku: string; name: string; reason: string }[];
}

function stripPrefix(name: string, prefix: string): string {
  const n = name.trim();
  if (n.toLowerCase() === prefix.toLowerCase()) return n;
  if (n.toLowerCase().startsWith(prefix.toLowerCase() + " ")) {
    return n.slice(prefix.length).trim() || n;
  }
  return n;
}

/** A stable style SKU for a garment we are creating. */
function styleSkuFor(styleName: string): string {
  return (
    "LIV-STY-" +
    styleName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

export async function planRegroup(): Promise<RegroupPlan> {
  const actions: RegroupAction[] = [];
  const unmatched: RegroupPlan["unmatched"] = [];

  // The 91 Loom reported are the Cin7 colorways that (a) went out in the feed,
  // so Loom holds a style for them, and (b) carry the colour in the style name.
  // Restricting to what was actually pushed matters: the wider catalogue holds
  // ~2,700 more products with the same shape, and they are not in scope until
  // they are sent.
  const carriers = (
    await prisma.colorway.findMany({
      where: {
        source: "CIN7_IMPORT",
        publications: { some: { channel: "LOOM" } },
      },
      select: {
        id: true, colorwaySku: true, name: true, productType: true, styleId: true,
        style: { select: { styleSku: true, styleName: true, gender: true, category: true } },
      },
    })
  ).filter((c) => c.style.styleName.trim().toLowerCase() === c.name.trim().toLowerCase());
  const bySku = new Map(carriers.map((c) => [c.colorwaySku, c]));

  // 1. Duplicates — archive, never re-point.
  const dupSet = new Set<string>(DUPLICATE_SKUS);
  for (const sku of DUPLICATE_SKUS) {
    const c = bySku.get(sku);
    if (!c) { unmatched.push({ colorwaySku: sku, name: "", reason: "duplicate not found in master" }); continue; }
    actions.push({
      kind: "archive", colorwayId: c.id, colorwaySku: c.colorwaySku,
      fromStyleSku: c.style.styleSku, fromName: c.name,
      note: "Loom holds this colorway under the correct parent already",
    });
  }

  // 2. New styles — create the garment, then hang its colorways off it.
  const newSet = new Set<string>();
  const stylesToCreate: string[] = [];
  for (const group of NEW_STYLE_GROUPS) {
    let created = false;
    for (const sku of group.skus) {
      newSet.add(sku);
      const c = bySku.get(sku);
      if (!c) { unmatched.push({ colorwaySku: sku, name: "", reason: `no master record for ${group.style}` }); continue; }
      // Strip the FULL garment name, not just its first word — otherwise
      // "Hayes Suit Pant Black" under style "Hayes Suit Pant" keeps the garment
      // in its colour and reads as "Suit Pant Black".
      const base = group.style;
      actions.push({
        kind: "new-style", colorwayId: c.id, colorwaySku: c.colorwaySku,
        fromStyleSku: c.style.styleSku, fromName: c.name,
        toStyleName: group.style, toStyleSku: styleSkuFor(group.style),
        toName: stripPrefix(c.name, base), createsStyle: !created, note: group.note,
      });
      if (!created) { stylesToCreate.push(group.style); created = true; }
    }
  }

  // 3. Everything left regroups under a style that already exists here.
  const tfStyles = await prisma.style.findMany({
    where: { source: "THREADFLOW" },
    select: { id: true, styleSku: true, styleName: true },
  });
  const known = [...tfStyles].sort((a, b) => b.styleName.length - a.styleName.length);

  for (const c of carriers) {
    if (dupSet.has(c.colorwaySku) || newSet.has(c.colorwaySku)) continue;
    const forced = PARENT_OVERRIDE[c.colorwaySku];
    const hit = forced
      ? known.find((k) => k.styleName.trim().toLowerCase() === forced.toLowerCase())
      : known.find((k) => {
          const n = c.name.trim().toLowerCase();
          const s = k.styleName.trim().toLowerCase();
          return n === s || n.startsWith(s + " ");
        });
    if (!hit) {
      unmatched.push({ colorwaySku: c.colorwaySku, name: c.name, reason: "no parent style found" });
      continue;
    }
    actions.push({
      kind: "regroup", colorwayId: c.id, colorwaySku: c.colorwaySku,
      fromStyleSku: c.style.styleSku, fromName: c.name,
      toStyleName: hit.styleName, toStyleSku: hit.styleSku,
      toName: stripPrefix(c.name, hit.styleName),
      note: forced ? "parent set by hand — the SKU disagrees with the name" : undefined,
    });
  }

  return {
    actions, stylesToCreate,
    counts: {
      archive: actions.filter((a) => a.kind === "archive").length,
      regroup: actions.filter((a) => a.kind === "regroup").length,
      newStyle: actions.filter((a) => a.kind === "new-style").length,
      stylesCreated: stylesToCreate.length,
      unmatched: unmatched.length,
    },
    unmatched,
  };
}

export interface RegroupResult extends RegroupPlan {
  stylesCreated: number;
  colorwaysReparented: number;
  colorwaysArchived: number;
  categoriesCorrected: number;
}

export async function applyRegroup(): Promise<RegroupResult> {
  const plan = await planRegroup();

  // Create the missing styles first, reusing one if the SKU already exists.
  const styleIdBySku = new Map<string, string>();
  for (const a of plan.actions) {
    if (a.kind !== "new-style" || !a.createsStyle || !a.toStyleSku) continue;
    const source = plan.actions.find((x) => x.toStyleSku === a.toStyleSku);
    const first = await prisma.colorway.findUnique({
      where: { id: source!.colorwayId },
      select: { productType: true, brandId: true, style: { select: { gender: true, category: true } } },
    });
    const style = await prisma.style.upsert({
      where: { styleSku: a.toStyleSku },
      create: {
        source: "MANUAL",
        styleSku: a.toStyleSku,
        styleName: a.toStyleName!,
        gender: first?.style.gender ?? null,
        category: first?.productType ?? first?.style.category ?? "Uncategorized",
        brandId: first?.brandId ?? null,
      },
      update: {},
      select: { id: true },
    });
    styleIdBySku.set(a.toStyleSku, style.id);
  }

  // Resolve every target style id.
  for (const a of plan.actions) {
    if (!a.toStyleSku || styleIdBySku.has(a.toStyleSku)) continue;
    const s = await prisma.style.findUnique({ where: { styleSku: a.toStyleSku }, select: { id: true } });
    if (s) styleIdBySku.set(a.toStyleSku, s.id);
  }

  let reparented = 0;
  let archived = 0;
  let categories = 0;
  const CHUNK = 50;
  const moves = plan.actions.filter((a) => a.kind !== "archive" && a.toStyleSku);
  for (let i = 0; i < moves.length; i += CHUNK) {
    await prisma.$transaction(
      moves.slice(i, i + CHUNK).map((a) => {
        const data: Record<string, unknown> = {
          styleId: styleIdBySku.get(a.toStyleSku!)!,
          name: a.toName!,
        };
        const cat = CATEGORY_OVERRIDE[a.colorwaySku];
        if (cat) { data.productType = cat; categories++; }
        return prisma.colorway.update({ where: { id: a.colorwayId }, data });
      }),
      { timeout: 60_000 }
    );
    reparented += moves.slice(i, i + CHUNK).length;
  }

  const archiveIds = plan.actions.filter((a) => a.kind === "archive").map((a) => a.colorwayId);
  if (archiveIds.length) {
    const res = await prisma.colorway.updateMany({
      where: { id: { in: archiveIds } },
      data: { archived: true, status: "ARCHIVED" },
    });
    archived = res.count;
  }

  return {
    ...plan,
    stylesCreated: styleIdBySku.size,
    colorwaysReparented: reparented,
    colorwaysArchived: archived,
    categoriesCorrected: categories,
  };
}
