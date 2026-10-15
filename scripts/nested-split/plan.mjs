// Plan the un-nesting of products Loom holds as "sizes". READ-ONLY: writes a
// plan file and nothing else. Nothing is sent to Loom, not even a validate.
//
//   node scripts/nested-split/plan.mjs                 # the perfumes
//   node scripts/nested-split/plan.mjs --parent=CHIMI
//   node scripts/nested-split/plan.mjs --all
//
// THE DEFECT. The pre-2026-09-17 Cin7 importer stripped the last hyphen segment
// of a SKU and grouped on the rest. That is right when the last segment is a
// size — EXT-RW-8085-9.5 really is size 9.5 of the Iron Ranger. It is wrong when
// the last segment IS the product, which is the case for a perfume number, a
// Kinto colour or a Steamery model. So EXT-BP-BP602EDP30 was read as colourway
// EXT-BP, size "BP602EDP30", and fifteen perfumes became sizes of the one the
// parent took its name from. docs/sku-grouping-fixes-2026-09-17.md fixed the
// importer and named EXT-BP as a known casualty; the existing rows were left for
// a reviewed repair, which is this.
//
// Loom's own best illustration: EXT-STM-1802, a box of tumble dryer balls, is in
// Loom as size "W18/L02" of a fabric shaver.
//
// WHY IT MATTERS MORE THAN A TIDY HIERARCHY. Each phantom carries a
// pio_product_ref, so Pio holds the same shape. A picker filling an order for
// 602 opens product 344203 ("301 Eau de Parfum"), finds a size called
// BP602EDP30, and takes the bottle from the bin the product is labelled as. That
// has already happened to a customer once.
//
// WHAT THIS PLANS. Not a master repair — the master is already right. Every one
// of these variants sits on its own colourway with sizeLabel "OS"; the dry-built
// Loom payload carries 68 styles for the perfumes and not one colourway with
// more than a single variant. Only Loom (and through it Pio) still holds the old
// shape. So the plan is a REPARENT: for each nested variant, the colourway Loom
// has it under and the colourway the master says it belongs to.
//
// Loom refuses a reparent unless asked — the variant row is where stock,
// weighted average cost and every order, PO and receipt line live, so a nesting
// bug upstream would otherwise relocate all of it silently. The apply step is
// `pushColorwaysToLoom(colorwayIds, season, { mode: "data",
// allowVariantReparent: true })`, exactly as the Red Wing split ran it
// (docs/red-wing-care-split.md). This script does not run it.

import { writeFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

// The app keeps its secrets in .env.local, which dotenv does not read by default.
config({ path: ".env.local" });

/**
 * The eleven phantoms, pinned as probed on 2026-10-15.
 *
 * Pinned rather than discovered because a prefix test cannot tell this defect
 * from an ordinary SKU hierarchy: `LIV` is a prefix of 1,594 colourway SKUs and
 * is not a nesting bug. `ownVariants` is what the parent legitimately holds —
 * three of them carry one real product of their own, which must survive the
 * split — and the id refuses a plan built against a different row than the one
 * surveyed. `expectNested` is what should MOVE, so it excludes the parent's own
 * product; EXT-SP is 0 because its single nested-looking variant turned out to
 * be its own, and it needs no repair.
 */
const PHANTOMS = {
  "EXT-BP": { id: "bb5ff342-fbb4-494b-bb4c-94696bf7b136", brand: "Bon Parfumeur", ownVariants: 0, expectNested: 15 },
  CHIMI: { id: "4eefbeb6-ef2a-483b-90ac-a5f646345672", brand: "Chimi", ownVariants: 0, expectNested: 5 },
  "EXT-KNT-TBL-350": { id: "8fd1f74d-5b47-464d-ae1e-28f44cb34c63", brand: "Kinto", ownVariants: 0, expectNested: 3 },
  "EXT-KNT-WB-500": { id: "110ec02e-a6bc-4caf-a2df-720a79699f4d", brand: "Kinto", ownVariants: 0, expectNested: 3 },
  "EXT-PF-11": { id: "899050e9-aecb-43ad-8380-ac80360c4ccb", brand: "P.F. Candle", ownVariants: 0, expectNested: 3 },
  "EXT-PF-RDFS": { id: "f4828c11-d68e-4e74-ae41-2bdb05c4f005", brand: "P.F. Candle", ownVariants: 0, expectNested: 2 },
  "EXT-PR-LCT-X10-MC": { id: "c13fe2c8-9192-4121-a2e0-fcede81af01b", brand: "Paraboot", ownVariants: 0, expectNested: 3 },
  "EXT-STM-CRS": { id: "9cbc3c97-d312-4eba-8951-426a4f4348c3", brand: "Steamery", ownVariants: 0, expectNested: 2 },
  "EXT-FRM": { id: "a87cd1ac-f82b-4ee0-ba5b-463682a2010f", brand: "Frama", ownVariants: 1, expectNested: 6 },
  "EXT-SP": { id: "eac9a3a0-ed25-473f-91d9-5363872b10f2", brand: "Saphir", ownVariants: 1, expectNested: 0 },
  "EXT-STM": { id: "bc9f0b8a-2d38-438f-b39c-b2dad458a75f", brand: "Steamery", ownVariants: 1, expectNested: 8 },
};

const args = process.argv.slice(2);
const all = args.includes("--all");
const parentArg = args.find((a) => a.startsWith("--parent="))?.slice("--parent=".length);
const targets = all ? Object.keys(PHANTOMS) : [parentArg ?? "EXT-BP"];
for (const t of targets) {
  if (!PHANTOMS[t]) {
    console.error(`Unknown parent "${t}". Known: ${Object.keys(PHANTOMS).join(", ")}`);
    process.exit(2);
  }
}

const LOOM = "https://loom.livid.no/api/origio/v1";
const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
if (!token) {
  console.error("Missing LOOM_LOCAL_TOKEN / LOOM_TOKEN — this reads Loom to see what it actually holds.");
  process.exit(2);
}

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

/** Digits-only comparison. Loom and the master may spell a UPC-A differently. */
const bcKey = (s) => {
  const d = String(s ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length === 12 ? "0" + d : d;
};

const plans = [];

for (const parentSku of targets) {
  const pin = PHANTOMS[parentSku];

  const res = await fetch(`${LOOM}/products?sku=${encodeURIComponent(parentSku)}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) {
    console.error(`${parentSku}: Loom answered HTTP ${res.status}`);
    process.exit(1);
  }
  const loomRow = (await res.json()).rows?.find((r) => r.colorway_sku === parentSku);
  if (!loomRow) {
    plans.push({ parentSku, skipped: "Loom holds no colourway with this SKU — nothing nested to move." });
    continue;
  }

  // Refuse a plan built against a different row than the one surveyed.
  if (loomRow.colorway_id !== pin.id) {
    console.error(
      `${parentSku}: Loom's colourway is ${loomRow.colorway_id}, the plan was pinned to ${pin.id}. ` +
        `Re-survey before planning — something has moved.`
    );
    process.exit(1);
  }

  const loomVariants = loomRow.variants ?? [];
  const variantIds = loomVariants.map((v) => v.variant_id).filter(Boolean);
  const variantSkus = loomVariants.map((v) => v.variant_sku).filter(Boolean);

  // Where the master says each of these belongs. Matched on the stable variant
  // id Loom echoes back, with the SKU as a fallback for any row that predates
  // stable ids.
  const { rows: masterRows } = await client.query(
    `SELECT v.id vid, v."variantSku", v.barcode, v."sizeLabel",
            cw.id cwid, cw."colorwaySku", cw.name cwname, cw.status cwstatus,
            s.id sid, s."styleSku", s."styleName",
            b.name brand
       FROM "Variant" v
       JOIN "Colorway" cw ON cw.id = v."colorwayId"
       JOIN "Style"    s  ON s.id  = cw."styleId"
       LEFT JOIN "Brand" b ON b.id = cw."brandId"
      WHERE v.id = ANY($1::text[]) OR v."variantSku" = ANY($2::text[])`,
    [variantIds, variantSkus]
  );
  const byId = new Map(masterRows.map((r) => [r.vid, r]));
  const bySku = new Map(masterRows.map((r) => [r.variantSku, r]));

  const moves = [];
  const stays = [];
  const refusals = [];

  for (const lv of loomVariants) {
    const m = byId.get(lv.variant_id) ?? bySku.get(lv.variant_sku);
    const onHand = (lv.stock ?? []).reduce((a, s) => a + (s.on_hand ?? 0), 0);
    const reserved = (lv.stock ?? []).reduce((a, s) => a + (s.reserved ?? 0), 0);
    const common = {
      variantSku: lv.variant_sku,
      loomVariantId: lv.loom_variant_id,
      variantId: lv.variant_id,
      loomSizeLabel: lv.size_label,
      barcode: lv.barcode,
      onHand,
      reserved,
      averageCost: lv.average_cost ?? null,
    };

    // A variant the master has never heard of cannot be re-parented: there is no
    // colourway to send it to. It stays where it is and a person decides.
    if (!m) {
      refusals.push({ ...common, reason: "no variant in the master matches this id or SKU" });
      continue;
    }

    // The parent's own real product — EXT-FRM, EXT-SP and EXT-STM each have one.
    // It is already in the right place and must not be moved.
    if (m.cwid === pin.id) {
      stays.push({ ...common, reason: "the master puts this on the parent itself — it is the parent's own product" });
      continue;
    }

    // A barcode disagreement means the two systems are not describing the same
    // garment, and moving stock on that assumption is how a mis-ship becomes a
    // stock error as well.
    if (lv.barcode && m.barcode && bcKey(lv.barcode) !== bcKey(m.barcode)) {
      refusals.push({
        ...common,
        masterBarcode: m.barcode,
        reason: `barcode disagrees — Loom ${lv.barcode}, master ${m.barcode}`,
      });
      continue;
    }

    moves.push({
      ...common,
      masterBarcode: m.barcode,
      masterSizeLabel: m.sizeLabel,
      from: { colorwayId: pin.id, colorwaySku: parentSku, name: loomRow.name },
      to: {
        colorwayId: m.cwid,
        colorwaySku: m.colorwaySku,
        name: m.cwname,
        status: m.cwstatus,
        styleId: m.sid,
        styleSku: m.styleSku,
        styleName: m.styleName,
        brand: m.brand,
      },
    });
  }

  // What to push, and in which season. The destinations are the colourways that
  // must be sent; Loom moves a variant when the delivery claims it under its new
  // parent and `allow_variant_reparent` is set.
  const destIds = [...new Set(moves.map((m) => m.to.colorwayId))];
  const { rows: seasonRows } = destIds.length
    ? await client.query(
        `SELECT DISTINCT se.code
           FROM "SeasonEntry" e JOIN "Season" se ON se.id = e."seasonId"
          WHERE e."colorwayId" = ANY($1::text[])`,
        [destIds]
      )
    : { rows: [] };

  plans.push({
    parentSku,
    parentName: loomRow.name,
    brand: pin.brand,
    loomColorwayId: loomRow.colorway_id,
    loomProductId: loomRow.loom_product_id,
    pioProductRef: loomRow.pio_product_ref ?? null,
    pioSyncedAt: loomRow.pio_synced_at ?? null,
    loomVariantCount: loomVariants.length,
    expectedNested: pin.expectNested,
    nestedCountMatchesSurvey: moves.length + refusals.length === pin.expectNested,
    totals: {
      move: moves.length,
      stay: stays.length,
      refuse: refusals.length,
      onHandMoving: moves.reduce((a, m) => a + m.onHand, 0),
      reservedMoving: moves.reduce((a, m) => a + m.reserved, 0),
      variantsWithStockMoving: moves.filter((m) => m.onHand > 0).length,
      // A negative on-hand is not a rounding artefact; it is stock that was
      // decremented for a product whose physical bin is somewhere else, which is
      // the same mis-pick this defect causes. Counted separately so it is not
      // netted away against the positives in the total.
      variantsWithNegativeStock: moves.filter((m) => m.onHand < 0).length,
      destinationColorways: destIds.length,
    },
    // The parent is left holding only what the master says is its own. Zero for
    // eight of the eleven, which is what makes them retirable afterwards.
    parentLeftWith: stays.length,
    push: {
      colorwayIds: destIds,
      seasons: seasonRows.map((r) => r.code),
      mode: "data",
      allowVariantReparent: true,
      note: "pushColorwaysToLoom(colorwayIds, season, { mode: 'data', allowVariantReparent: true })",
    },
    moves,
    stays,
    refusals,
  });
}

await client.end();

mkdirSync("snapshots", { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const out = `snapshots/nested-split-plan-${all ? "all" : targets[0].toLowerCase()}-${stamp}.json`;
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), plans }, null, 2));

// --- what a person reads ----------------------------------------------------
let totalMove = 0, totalStock = 0, totalRefuse = 0;
for (const p of plans) {
  if (p.skipped) {
    console.log(`\n${p.parentSku}: ${p.skipped}`);
    continue;
  }
  const t = p.totals;
  totalMove += t.move; totalStock += t.onHandMoving; totalRefuse += t.refuse;
  console.log(
    `\n${p.parentSku}  "${p.parentName}"  (${p.brand})  Pio ${p.pioProductRef ?? "—"}`
  );
  console.log(
    `  move ${t.move}  stay ${t.stay}  refuse ${t.refuse}  ` +
      `→ ${t.destinationColorways} colourways, seasons ${p.push.seasons.join(",") || "—"}`
  );
  console.log(
    `  stock moving: ${t.onHandMoving} on hand across ${t.variantsWithStockMoving} variants, ${t.reservedMoving} reserved`
  );
  if (t.variantsWithNegativeStock) {
    console.log(
      `  ! ${t.variantsWithNegativeStock} variant(s) hold NEGATIVE stock — sold from a bin they are not in. Worth counting before the move.`
    );
  }
  if (!p.nestedCountMatchesSurvey) {
    console.log(`  ! ${t.move + t.refuse} to move, the 2026-10-15 survey saw ${p.expectedNested} — re-read before applying`);
  }
  for (const m of p.moves) {
    console.log(
      `    ${m.variantSku.padEnd(24)} size ${`"${m.loomSizeLabel}"`.padEnd(20)} → ${m.to.colorwaySku.padEnd(24)} "${m.to.name}"` +
        (m.onHand ? `  (${m.onHand} on hand${m.onHand < 0 ? " — NEGATIVE" : ""})` : "")
    );
  }
  for (const s of p.stays) console.log(`    = ${s.variantSku.padEnd(24)} stays — ${s.reason}`);
  for (const r of p.refusals) console.log(`    ! ${r.variantSku.padEnd(24)} REFUSED — ${r.reason}`);
}

console.log(
  `\n${totalMove} variant(s) to move, ${totalStock} unit(s) of stock travelling with them, ${totalRefuse} refused.`
);
console.log(`Plan written to ${out}`);
console.log("Nothing was sent to Loom. Applying needs allow_variant_reparent and a go-ahead.");
