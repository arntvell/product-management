// Apply the vintage colourway split planned by plan.mjs.
//
// Vintage is one-of-one, but the importer read each SKU's trailing segment as a
// size and grouped on the rest, collapsing 514 distinct garments into 18
// products. This gives each garment back its own style + colourway, keeping the
// variant id so Loom can follow the move rather than orphaning stock.
//
// DRY RUN BY DEFAULT. Pass --apply to write. Pass --parent=<sku> to do one
// collapsed colourway at a time (Loom asked for EXT-VN-NW alone as the probe).
//
// Idempotent: a variant that has already moved is skipped, so a re-run after a
// partial failure is a no-op for the part that landed.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const parentArg = args.find((a) => a.startsWith("--parent="));
const ONLY = parentArg ? parentArg.slice("--parent=".length) : null;
// One transaction for a whole parent is fine at 26 garments and fragile at 391:
// ~7 round trips each against Neon, nothing committed until the end, and a
// dropped connection loses the lot. Commit in chunks instead — every move is
// guarded on the variant still sitting under its planned parent, so a resumed
// run skips what already landed.
const chunkArg = args.find((a) => a.startsWith("--chunk="));
const CHUNK = chunkArg ? Math.max(1, parseInt(chunkArg.slice("--chunk=".length), 10)) : 25;

// The applier is not vintage-specific: it moves variants out of a parent
// colourway into one style+colourway each, per a plan file. --plan lets another
// split (the Red Wing care products) reuse it rather than fork it.
const planArg = args.find((a) => a.startsWith("--plan="));
const PLAN = planArg ? planArg.slice("--plan=".length) : "snapshots/vintage-split-plan.json";
const outArg = args.find((a) => a.startsWith("--out="));
const plan = JSON.parse(readFileSync(PLAN, "utf8"));

// VPACK25-* is brand "VINTAGE PACK", not Vintage: legacy 25-unit lots ("25X-
// BACKPACK"), not one-of-one garments. Same structural defect, but out of scope
// on Kristoffer's call (2026-09-17) — leave them alone.
const VPACK = /^VPACK25-/;
const inScope = plan.plan.filter((p) => !VPACK.test(p.fromColorwaySku));
const rows = ONLY ? inScope.filter((p) => p.fromColorwaySku === ONLY) : inScope;
if (rows.length === 0) {
  console.error(ONLY ? `No planned rows for parent ${ONLY}.` : "Plan is empty.");
  process.exit(1);
}

// Group by the colourway being dismantled: one transaction per parent, so a
// failure tells you exactly which parent is half-done — and so the probe parent
// can be applied on its own.
const byParent = new Map();
for (const r of rows) {
  if (!byParent.has(r.fromColorwayId)) byParent.set(r.fromColorwayId, []);
  byParent.get(r.fromColorwayId).push(r);
}

const oldBySku = new Map(plan.oldColorways.map((c) => [c.colorwayId, c]));

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const result = {
  startedAt: new Date().toISOString(),
  mode: APPLY ? "apply" : "dry-run",
  parent: ONLY,
  parents: [],
  totals: {
    moved: 0,
    alreadyMoved: 0,
    stylesCreated: 0,
    colorwaysCreated: 0,
    entriesCreated: 0,
    seasonLinksMoved: 0,
    pricesCreated: 0,
    stylesRenamed: 0,
    channelsDeclared: 0,
    colorwaysArchived: 0,
    skipped: 0,
  },
};

const T = result.totals;

for (const [fromColorwayId, items] of byParent) {
  const parent = oldBySku.get(fromColorwayId);
  const label = parent?.colorwaySku ?? fromColorwayId;
  const p = { parent: label, planned: items.length, moved: 0, alreadyMoved: 0, skipped: [], archived: false };

  const startedAt = Date.now();
  const chunks = [];
  for (let i = 0; i < items.length; i += CHUNK) chunks.push(items.slice(i, i + CHUNK));
  let movedTotal = 0;
  let failed = false;

  for (const [ci, chunk] of chunks.entries()) {
  await client.query("BEGIN");
  try {
    for (const it of chunk) {
      // Idempotence + safety in one check: only move a variant that is still
      // under the parent we planned against. Anything else — already moved, or
      // moved by someone else since the plan was written — is left alone.
      const cur = await client.query(
        `SELECT "colorwayId" FROM "Variant" WHERE id = $1`,
        [it.variantId]
      );
      if (cur.rowCount === 0) {
        p.skipped.push({ sku: it.variantSku, why: "variant no longer exists" });
        T.skipped++;
        continue;
      }
      if (cur.rows[0].colorwayId !== fromColorwayId) {
        p.alreadyMoved++;
        T.alreadyMoved++;
        continue;
      }

      // --- style -------------------------------------------------------------
      let styleId;
      const sFound = await client.query(`SELECT id FROM "Style" WHERE "styleSku" = $1`, [it.newStyleSku]);
      // Optional plan fields (Saphir): `styleName` when the style is not named
      // like the colourway, `renameStyle` to correct a reused style's name, and
      // `styleWeightKg` so a new style keeps its customs weight. Absent, the
      // vintage behaviour is unchanged.
      const styleName = it.styleName ?? it.name;
      if (sFound.rowCount > 0) {
        styleId = sFound.rows[0].id;
        if (it.renameStyle) {
          const ren = await client.query(
            `UPDATE "Style" SET "styleName" = $1, "updatedAt" = now()
             WHERE id = $2 AND "styleName" IS DISTINCT FROM $1`,
            [styleName, styleId]
          );
          T.stylesRenamed += ren.rowCount;
        }
      } else {
        styleId = randomUUID();
        {
          await client.query(
            `INSERT INTO "Style" (id, source, "styleSku", "styleName", category, "categoryId", "brandId", "weightKg", "createdAt", "updatedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
            [styleId, it.source, it.newStyleSku, styleName, it.category ?? "Uncategorized", it.categoryId, it.brandId,
             it.styleWeightKg ?? null]
          );
        }
        T.stylesCreated++;
      }

      // --- colourway ---------------------------------------------------------
      // Style name and colourway name are the same for vintage: the garment has
      // one name, and there is exactly one of it.
      let colorwayId;
      const cFound = await client.query(`SELECT id FROM "Colorway" WHERE "colorwaySku" = $1`, [it.newColorwaySku]);
      if (cFound.rowCount > 0) {
        colorwayId = cFound.rows[0].id;
      } else {
        colorwayId = randomUUID();
        // The six Bon Parfumeur rows sat under a vintage parent by accident, so
        // their inherited productType/vendor describe the wrong product ("Blouse",
        // "Vintage" on a hand cream). Drop them rather than carry the mistake over.
        const productType = it.brandChanged ? null : it.productType;
        const vendor = it.brandChanged ? null : it.vendor;
        {
          await client.query(
            `INSERT INTO "Colorway"
               (id, source, "colorwaySku", name, "productType", "categoryId", "styleId",
                "brandId", "countryOfOrigin", status, vendor, kind, tags, color, "fullDescription",
                "createdAt", "updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, now(), now())`,
            [colorwayId, it.source, it.newColorwaySku, it.name, productType, it.categoryId,
             styleId, it.brandId, it.countryOfOrigin, it.status, vendor, it.kind,
             it.tags ?? [], it.color ?? null, it.fullDescription ?? null]
          );
        }
        T.colorwaysCreated++;
      }

      // --- season entry ------------------------------------------------------
      let entryId;
      const eFound = await client.query(
        `SELECT id FROM "SeasonEntry" WHERE "colorwayId" = $1 AND "seasonId" = $2`,
        [colorwayId, it.seasonId]
      );
      if (eFound.rowCount > 0) {
        entryId = eFound.rows[0].id;
      } else {
        entryId = randomUUID();
        {
          await client.query(
            `INSERT INTO "SeasonEntry" (id, "colorwayId", "seasonId", origin) VALUES ($1,$2,$3,'NEW')`,
            [entryId, colorwayId, it.seasonId]
          );
        }
        T.entriesCreated++;
      }

      // --- the move ----------------------------------------------------------
      // Variant id is untouched: it is the identity Loom matches on, and keeping
      // it is what makes this a move rather than a delete-and-recreate. Vintage
      // is one-size, so the mis-read size token becomes OS.
      {
        const upd = await client.query(
          `UPDATE "Variant" SET "colorwayId" = $1, "sizeLabel" = 'OS', dim1 = 'OS', dim2 = NULL
           WHERE id = $2 AND "colorwayId" = $3`,
          [colorwayId, it.variantId, fromColorwayId]
        );
        if (upd.rowCount !== 1) throw new Error(`variant ${it.variantSku} did not move (rowCount ${upd.rowCount})`);

        // The old CONTINUITY link points at the parent's entry. Leaving it would
        // let the next sync's cross-colourway cleanup remove it anyway; delete it
        // deliberately and link the variant to its own entry.
        await client.query(
          `DELETE FROM "SeasonVariant" sv USING "SeasonEntry" e
           WHERE sv."seasonEntryId" = e.id AND sv."variantId" = $1 AND e."colorwayId" = $2`,
          [it.variantId, fromColorwayId]
        );
        await client.query(
          `INSERT INTO "SeasonVariant" ("seasonEntryId", "variantId") VALUES ($1,$2)
           ON CONFLICT DO NOTHING`,
          [entryId, it.variantId]
        );
      }
      T.seasonLinksMoved++;
      p.moved++;
      T.moved++;

      // --- channel declaration -----------------------------------------------
      // A minted colourway has no ChannelPublication, so the Loom payload would
      // declare it absent from channels it is live in — and Loom suppresses
      // stock errors for a channel declared false. The plan names the channels
      // the variant's own refs prove; declare them in the same transaction.
      // Additive, and a re-run is a no-op on the (colorwayId, channel) unique.
      for (const ch of it.declareChannels ?? []) {
        const dec = await client.query(
          `INSERT INTO "ChannelPublication" (id, "colorwayId", channel, published)
           VALUES ($1, $2, $3::"Channel", false)
           ON CONFLICT ("colorwayId", channel) DO NOTHING`,
          [randomUUID(), colorwayId, ch]
        );
        T.channelsDeclared += dec.rowCount;
      }

      // --- price -------------------------------------------------------------
      if (it.priceNok != null) {
        {
          await client.query(
            `INSERT INTO "Price" (id, "seasonId", "colorwayId", currency, "priceType", amount)
             VALUES ($1,$2,$3,'NOK','MSRP',$4)
             ON CONFLICT ("seasonId","colorwayId",currency,"priceType") DO NOTHING`,
            [randomUUID(), it.seasonId, colorwayId, it.priceNok]
          );
        }
        T.pricesCreated++;
      }
    }

    if (APPLY) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    p.error = err.message;
    console.error(`FAILED on parent ${label}, chunk ${ci + 1}/${chunks.length}: ${err.message}`);
    failed = true;
    break;
  }
  movedTotal = p.moved;
  if (chunks.length > 1) {
    const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`  ${label}: chunk ${ci + 1}/${chunks.length} — ${movedTotal}/${items.length} moved (${secs}s)`);
  }
  }

  // --- archive the emptied parent -------------------------------------------
  // Only once it is genuinely empty. The withdrawal has to reach Loom in the
  // same push as the new products, or the stock is stranded between parents.
  if (!failed) {
    const left = await client.query(`SELECT count(*)::int n FROM "Variant" WHERE "colorwayId" = $1`, [fromColorwayId]);
    // On an apply the moves are committed, so the count is the truth. A dry run
    // rolls each chunk back, so subtract what it would have moved.
    const remaining = APPLY ? left.rows[0].n : left.rows[0].n - p.moved;
    if (remaining === 0) {
      if (APPLY) await client.query(`UPDATE "Colorway" SET archived = true WHERE id = $1`, [fromColorwayId]);
      p.archived = true;
      T.colorwaysArchived++;
    } else {
      p.variantsLeftBehind = remaining;
    }
  }
  result.parents.push(p);
  if (failed) break;
}

await client.end();

result.finishedAt = new Date().toISOString();
const base = PLAN.replace(/-plan\.json$/, "").replace(/^.*\//, "");
const out = outArg
  ? outArg.slice("--out=".length)
  : ONLY
    ? `snapshots/${base}-result-${ONLY}.json`
    : `snapshots/${base}-result.json`;
writeFileSync(out, JSON.stringify(result, null, 2));

console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (nothing written)"}${ONLY ? ` — parent ${ONLY}` : ""}`);
for (const p of result.parents) {
  const bits = [`moved ${p.moved}/${p.planned}`];
  if (p.alreadyMoved) bits.push(`already ${p.alreadyMoved}`);
  if (p.skipped.length) bits.push(`skipped ${p.skipped.length}`);
  bits.push(p.archived ? "parent archived" : `parent keeps ${p.variantsLeftBehind ?? "?"}`);
  if (p.error) bits.push(`ERROR ${p.error}`);
  console.log(`  ${p.parent.padEnd(24)} ${bits.join(", ")}`);
}
console.log("\ntotals:", JSON.stringify(T));
console.log(`result → ${out}`);
if (!APPLY) console.log("\nRe-run with --apply to write.");
