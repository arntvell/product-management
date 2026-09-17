// Plan the imperfect re-grouping. READ-ONLY: writes a plan file, nothing else.
//
// Today every imperfect colourway is its own style, and both the style and the
// colourway carry one variant's size in the name — "Barnes Japan Rinse Selvage
// 32/34*" for a colourway that holds six sizes. The size leaked in from Cin7's
// family name.
//
// Target, per Kristoffer 2026-09-17:
//   STYLE  "Barnes*"
//     COLOURWAY "Barnes Japan Fade*"   (no size)
//       VARIANTS  W29/L32, W30/L32, …  (already correct — not touched)
//
// The variants are already nested properly; this only fixes names and parentage.
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

/**
 * Strip a size that leaked in from the Cin7 family name. Four shapes in the
 * corpus: ", 3232"  "29/32"  "34 34"  "31 32". Deliberately anchored to the end
 * and to 2-or-4 digit runs so a real name like "501" or "90's" is untouched.
 */
export function stripSize(n) {
  return String(n ?? "")
    .replace(/[,\s]+\d{2}\s*\/\s*\d{2}\s*$/, "")
    .replace(/[,\s]+\d{2}\s+\d{2}\s*$/, "")
    .replace(/[,\s]+\d{4}\s*$/, "")
    .replace(/[\s,]+$/, "")
    .trim();
}

/**
 * Remove the imperfect marker in either convention. Both are live: the newer
 * IMP-LIV-… rows end the name with "*", the older LIV-IMP-… rows say
 * "(Imperfect)" or start with "Imperfect". Mirrors withoutImperfectMarker in
 * src/lib/cin7/import.ts.
 */
const bare = (n) =>
  String(n ?? "")
    .replace(/\*+\s*$/, "")
    .replace(/\(?\bimperfect\b\)?/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,\-]+|[\s,\-]+$/g, "")
    .trim();
/** The family is the first word: Barnes, Keri, Tia. Confirmed against the
 *  wholesale vocabulary — 12 of 13 families are a real Livid style name. */
const family = (n) => bare(n).split(/[\s,]+/)[0];

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const { rows } = await client.query(`
  SELECT s.id AS "styleId", s."styleSku", s."styleName",
         cw.id AS "colorwayId", cw."colorwaySku", cw.name AS "colorwayName",
         (SELECT count(*)::int FROM "Variant" v WHERE v."colorwayId" = cw.id) AS nv
  FROM "Style" s
  JOIN "Colorway" cw ON cw."styleId" = s.id AND cw.archived = false
  WHERE cw.kind <> 'AGGREGATE'
    -- STORAGE-IMPERFECT-EKSTRA-SJEKK / -MANGLER-SKU are internal placeholders
    -- ("extra check", "missing SKU"), not garments. KIND_RULES already treats
    -- the STORAGE- prefix as internal; the name filter below would drag them in.
    AND cw."colorwaySku" NOT LIKE 'STORAGE-%'
    AND (
      s."styleName" LIKE '%*'
      OR cw."colorwaySku" ~ '(^|-)IMP(-|$)'
      OR cw.name ~* 'imperfect'
      OR cw.name LIKE '%*'
    )
  ORDER BY cw."colorwaySku"
`);

// Wholesale SKU per family, to mint a readable style SKU (IMP-LIV-M-BRNS).
const wholesale = new Map();
for (const f of new Set(rows.map((r) => family(canonical(r))))) {
  const w = await client.query(
    `SELECT "styleSku" FROM "Style" WHERE lower("styleName") = lower($1) AND "styleName" NOT LIKE '%*' LIMIT 1`,
    [f]
  );
  wholesale.set(f, w.rows[0]?.styleSku ?? null);
}

// --- group by family -------------------------------------------------------
const families = new Map();
/**
 * The colourway name as it should read. When an imperfect was nested under a
 * wholesale style, the importer stored the family name LESS the style name —
 * "Japan Sandbox, 3134*" under "Fealy Twisted" — so the style name has to go
 * back on. Cin7 calls that row "Fealy Twisted Japan Sandbox, 3134*".
 */
function canonical(r) {
  let n = bare(r.colorwayName);
  const styleBare = bare(r.styleName);
  const styleHead = styleBare.split(/[\s,]+/)[0];
  if (styleHead && n.split(/[\s,]+/)[0]?.toLowerCase() !== styleHead.toLowerCase()) {
    n = `${styleBare} ${n}`.trim();
  }
  return stripSize(n);
}

for (const r of rows) {
  const f = family(canonical(r));
  if (!families.has(f)) families.set(f, []);
  families.get(f).push({ ...r, newColorwayName: `${canonical(r)}*` });
}

const plan = { generatedAt: new Date().toISOString(), families: [], merges: [], emptyingStyleIds: [] };
const keptStyleIds = new Set();

for (const [f, items] of [...families.entries()].sort()) {
  const ws = wholesale.get(f);
  const newStyleSku = ws ? `IMP-${ws}` : `IMP-LIV-${f.toUpperCase()}`;

  // Two colourways that reduce to the same name are the same colourway, split
  // by the old bug. Merge into the one with the most variants; ties go to the
  // lowest SKU so the choice is deterministic.
  const byName = new Map();
  for (const it of items) {
    if (!byName.has(it.newColorwayName)) byName.set(it.newColorwayName, []);
    byName.get(it.newColorwayName).push(it);
  }
  const colorways = [];
  for (const [name, group] of byName) {
    group.sort((a, b) => b.nv - a.nv || a.colorwaySku.localeCompare(b.colorwaySku));
    const [survivor, ...dupes] = group;
    colorways.push({
      colorwayId: survivor.colorwayId,
      colorwaySku: survivor.colorwaySku,
      fromStyleId: survivor.styleId,
      fromStyleName: survivor.styleName,
      oldName: survivor.colorwayName,
      newName: name,
      variants: survivor.nv,
    });
    for (const d of dupes) {
      plan.merges.push({
        mergeColorwayId: d.colorwayId,
        mergeColorwaySku: d.colorwaySku,
        intoColorwayId: survivor.colorwayId,
        intoColorwaySku: survivor.colorwaySku,
        name,
        variants: d.nv,
        fromStyleId: d.styleId,
      });
    }
  }

  plan.families.push({
    family: f,
    newStyleName: `${f}*`,
    newStyleSku,
    wholesaleAnchor: ws,
    colorways,
  });
  for (const it of items) if (!keptStyleIds.has(it.styleId)) keptStyleIds.add(it.styleId);
}

// Every one of the old per-colourway styles empties out: nothing stays behind,
// because each held exactly one colourway and all of them move.
plan.emptyingStyleIds = [...keptStyleIds];

plan.counts = {
  families: plan.families.length,
  colorwaysAfterMerge: plan.families.reduce((a, f) => a + f.colorways.length, 0),
  colorwaysMergedAway: plan.merges.length,
  variantsTotal:
    plan.families.reduce((a, f) => a + f.colorways.reduce((b, c) => b + c.variants, 0), 0) +
    plan.merges.reduce((a, m) => a + m.variants, 0),
  stylesToCreate: plan.families.length,
  stylesEmptying: plan.emptyingStyleIds.length,
  noWholesaleAnchor: plan.families.filter((f) => !f.wholesaleAnchor).map((f) => f.family),
};

await client.end();
writeFileSync("snapshots/imperfect-regroup-plan.json", JSON.stringify(plan, null, 2));
console.log(JSON.stringify(plan.counts, null, 2));
for (const f of plan.families) {
  console.log(`\n"${f.newStyleName}"  [${f.newStyleSku}]  ${f.colorways.length} colourways`);
  for (const c of f.colorways) console.log(`   "${c.newName}"  (was "${c.oldName}")  ${c.variants} sizes`);
}
for (const m of plan.merges) console.log(`\nMERGE ${m.mergeColorwaySku} (${m.variants} variants) -> ${m.intoColorwaySku} as "${m.name}"`);
console.log("\nplan -> snapshots/imperfect-regroup-plan.json");
