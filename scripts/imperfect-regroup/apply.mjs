// Apply the imperfect re-grouping planned by plan.mjs.
//
// Every imperfect colourway is its own style today, and both names carry one
// variant's size. This gives each family a single "<Family>*" style, renames the
// colourways without the size, and folds the one duplicate pair together.
//
// Colourway ids never change — Loom's hard condition, and what lets it treat
// this as a re-parent rather than a delete and recreate. Variants are already
// nested correctly and are only touched for the merge.
//
// DRY RUN BY DEFAULT. --apply to write, --family=Barnes to do one family.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const famArg = args.find((a) => a.startsWith("--family="));
const ONLY = famArg ? famArg.slice("--family=".length) : null;

const plan = JSON.parse(readFileSync("snapshots/imperfect-regroup-plan.json", "utf8"));
const families = ONLY ? plan.families.filter((f) => f.family === ONLY) : plan.families;
if (!families.length) {
  console.error(ONLY ? `No planned family ${ONLY}.` : "Plan is empty.");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const result = { startedAt: new Date().toISOString(), mode: APPLY ? "apply" : "dry-run", families: [], totals: {
  stylesCreated: 0, colorwaysMoved: 0, colorwaysRenamed: 0, alreadyDone: 0,
  variantsMerged: 0, colorwaysArchived: 0, skipped: 0,
} };
const T = result.totals;

for (const f of families) {
  const p = { family: f.family, style: f.newStyleName, moved: 0, renamed: 0, alreadyDone: 0, merged: 0, skipped: [] };
  await client.query("BEGIN");
  try {
    // --- the surviving style -------------------------------------------------
    let styleId;
    const found = await client.query(`SELECT id FROM "Style" WHERE "styleSku" = $1`, [f.newStyleSku]);
    if (found.rowCount > 0) {
      styleId = found.rows[0].id;
    } else {
      // Brand and category come from a colourway's current style, so the new
      // parent inherits the family's own classification rather than a guess.
      const src = await client.query(
        `SELECT s."brandId", s.category, s."categoryId", s.source, s.gender, s.unisex
         FROM "Style" s WHERE s.id = $1`,
        [f.colorways[0].fromStyleId]
      );
      const b = src.rows[0] ?? {};
      styleId = randomUUID();
      await client.query(
        `INSERT INTO "Style" (id, source, "styleSku", "styleName", category, "categoryId", "brandId", gender, unisex, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())`,
        [styleId, b.source ?? "MANUAL", f.newStyleSku, f.newStyleName,
         b.category ?? "Uncategorized", b.categoryId ?? null, b.brandId ?? null,
         b.gender ?? null, b.unisex ?? false]
      );
      T.stylesCreated++;
    }

    // --- move and rename each colourway -------------------------------------
    for (const c of f.colorways) {
      const cur = await client.query(`SELECT "styleId", name FROM "Colorway" WHERE id = $1`, [c.colorwayId]);
      if (cur.rowCount === 0) { p.skipped.push({ sku: c.colorwaySku, why: "colourway gone" }); T.skipped++; continue; }
      if (cur.rows[0].styleId === styleId && cur.rows[0].name === c.newName) {
        p.alreadyDone++; T.alreadyDone++; continue;
      }
      const upd = await client.query(
        `UPDATE "Colorway" SET "styleId" = $1, name = $2, "updatedAt" = now()
         WHERE id = $3 AND "styleId" = $4`,
        [styleId, c.newName, c.colorwayId, c.fromStyleId]
      );
      if (upd.rowCount !== 1) {
        // Already re-parented by an earlier run: rename in place rather than fail.
        const r2 = await client.query(
          `UPDATE "Colorway" SET name = $1, "updatedAt" = now() WHERE id = $2 AND "styleId" = $3`,
          [c.newName, c.colorwayId, styleId]
        );
        if (r2.rowCount !== 1) { p.skipped.push({ sku: c.colorwaySku, why: "moved by someone else" }); T.skipped++; continue; }
        p.renamed++; T.colorwaysRenamed++;
        continue;
      }
      p.moved++; T.colorwaysMoved++; T.colorwaysRenamed++;
    }

    // --- fold the duplicate pair --------------------------------------------
    // Two colourways that reduce to the same name were always one colourway,
    // split by the old size-in-name bug. The variants move; the empty shell is
    // archived so the withdrawal can reach Loom in the same push.
    for (const m of plan.merges.filter((m) => f.colorways.some((c) => c.colorwayId === m.intoColorwayId))) {
      const mv = await client.query(
        `UPDATE "Variant" SET "colorwayId" = $1 WHERE "colorwayId" = $2`,
        [m.intoColorwayId, m.mergeColorwayId]
      );
      if (mv.rowCount > 0) { p.merged += mv.rowCount; T.variantsMerged += mv.rowCount; }
      const left = await client.query(`SELECT count(*)::int n FROM "Variant" WHERE "colorwayId" = $1`, [m.mergeColorwayId]);
      if (left.rows[0].n === 0) {
        await client.query(`UPDATE "Colorway" SET archived = true, "updatedAt" = now() WHERE id = $1`, [m.mergeColorwayId]);
        T.colorwaysArchived++;
      }
    }

    if (APPLY) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK");
    p.error = err.message;
    result.families.push(p);
    console.error(`FAILED on ${f.family}: ${err.message}`);
    break;
  }
  result.families.push(p);
  console.log(`  ${f.newStyleName.padEnd(12)} moved ${p.moved}, renamed ${p.renamed}, already ${p.alreadyDone}, merged-variants ${p.merged}${p.skipped.length ? `, skipped ${p.skipped.length}` : ""}`);
}

await client.end();
result.finishedAt = new Date().toISOString();
writeFileSync(ONLY ? `snapshots/imperfect-regroup-result-${ONLY}.json` : "snapshots/imperfect-regroup-result.json", JSON.stringify(result, null, 2));
console.log(`\n${APPLY ? "APPLIED" : "DRY RUN (nothing written)"}`);
console.log("totals:", JSON.stringify(T));
if (!APPLY) console.log("\nRe-run with --apply to write.");
