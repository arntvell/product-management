// Apply the vintage cleanup to the master (Origio), per plan.mjs.
//
//   - creates the categories the sheet introduces (Selected, Market, …), with
//     their Sitoo ids from sitoo.mjs categories
//   - Style.styleName and Colorway.name take the new name (one-size, one
//     colourway: the style is the colourway)
//   - Style.category/categoryId and Colorway.productType/categoryId take the new
//     category, dual-written as the rest of the master is
//   - the "archive" rows get archived=true, status=ARCHIVED, which is what makes
//     the next Loom push withdraw them (src/lib/loom/push.ts)
//   - every value written gets a MANUAL FieldOwner lock, so enrich/normalize and
//     later syncs cannot put the old value back
//
// SKUs, barcodes and prices are not touched.
//
// DRY RUN BY DEFAULT. --apply writes, in one transaction. Each UPDATE is guarded
// on the value plan.mjs read, so a row edited since the plan is reported, not
// overwritten — re-plan and re-run.
//
//   node scripts/vintage-cleanup/apply-origio.mjs [--apply]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const plan = JSON.parse(readFileSync("snapshots/vintage-cleanup-plan.json", "utf8"));
const CATS = "snapshots/vintage-cleanup-sitoo-categories.json";
const sitooCats = existsSync(CATS) ? JSON.parse(readFileSync(CATS, "utf8")) : {};
const AUTHORITY = "manual:vintage-cleanup-2026-09-24";
const EVIDENCE = "snapshots/vintage-cleanup-input-2026-09-23.xlsx (Loom export marked up by Kristoffer)";

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const result = { mode: APPLY ? "apply" : "dry-run", startedAt: new Date().toISOString() };
try {
  await client.query("BEGIN");

  // 1. categories
  const catIds = {};
  const created = [];
  for (const c of plan.newCategories) {
    const { rows } = await client.query(`select id from "Category" where slug = $1`, [c.slug]);
    if (rows[0]) {
      catIds[c.slug] = rows[0].id;
      continue;
    }
    const sitooId = c.sitooCategoryId ?? sitooCats[c.name] ?? null;
    if (sitooId == null && APPLY)
      throw new Error(`No Sitoo category id for "${c.name}" — run sitoo.mjs categories --apply first`);
    const id = randomUUID();
    await client.query(
      `insert into "Category" (id, slug, name, path, depth, "sortOrder", active, archived,
                               "shopifyProductType", "loomCategory", "sitooCategoryId", "createdAt", "updatedAt")
       values ($1, $2, $3, $2, 0, 0, true, false, $3, null, $4, now(), now())`,
      [id, c.slug, c.name, sitooId == null ? null : String(sitooId)]
    );
    catIds[c.slug] = id;
    created.push({ name: c.name, id, sitooCategoryId: sitooId == null ? null : String(sitooId) });
  }
  result.categoriesCreated = created;

  const rows = plan.plan.map((p) => ({ ...p, catId: p.to.categoryId ?? catIds[p.to.categorySlug] }));
  const missing = rows.filter((r) => !r.catId);
  if (missing.length) throw new Error(`No category id for ${missing.map((m) => m.colorwaySku).join(", ")}`);

  // 2. styles — guarded on the name and category the plan read
  const styles = rows.filter((r) => r.changes.styleName || r.changes.category);
  const s = await client.query(
    `update "Style" s
        set "styleName" = u.name, category = u.cat, "categoryId" = u.catid, "updatedAt" = now()
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
            as u(id, name, cat, catid, fromname, fromcat)
      where s.id = u.id and s."styleName" = u.fromname and s.category = u.fromcat
      returning s.id`,
    [
      styles.map((r) => r.styleId),
      styles.map((r) => r.to.styleName),
      styles.map((r) => r.to.category),
      styles.map((r) => r.catId),
      styles.map((r) => r.from.styleName),
      styles.map((r) => r.from.styleCategory),
    ]
  );
  const sDone = new Set(s.rows.map((x) => x.id));
  result.styles = { planned: styles.length, updated: s.rowCount, stale: styles.filter((r) => !sDone.has(r.styleId)).map((r) => r.styleSku) };

  // 3. colourways
  const cws = rows.filter((r) => r.changes.name || r.changes.category || r.action === "archive");
  const c = await client.query(
    `update "Colorway" c
        set name = u.name, "productType" = u.cat, "categoryId" = u.catid,
            archived = c.archived or u.archive,
            status = case when u.archive then 'ARCHIVED'::"ProductStatus" else c.status end,
            "updatedAt" = now()
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bool[], $6::text[], $7::text[])
            as u(id, name, cat, catid, archive, fromname, fromtype)
      where c.id = u.id and c.name = u.fromname and c."productType" is not distinct from u.fromtype
      returning c.id`,
    [
      cws.map((r) => r.colorwayId),
      cws.map((r) => r.to.name),
      cws.map((r) => r.to.category),
      cws.map((r) => r.catId),
      cws.map((r) => r.action === "archive"),
      cws.map((r) => r.from.name),
      cws.map((r) => r.from.productType),
    ]
  );
  const cDone = new Set(c.rows.map((x) => x.id));
  result.colorways = {
    planned: cws.length,
    updated: c.rowCount,
    archived: cws.filter((r) => r.action === "archive" && cDone.has(r.colorwayId)).map((r) => r.colorwaySku),
    stale: cws.filter((r) => !cDone.has(r.colorwayId)).map((r) => r.colorwaySku),
  };

  // 4. locks — only for rows that actually changed
  const locks = [];
  for (const r of rows) {
    if (sDone.has(r.styleId)) {
      if (r.changes.styleName) locks.push(["style", r.styleId, "styleName"]);
      if (r.changes.category) locks.push(["style", r.styleId, "category"]);
    }
    if (cDone.has(r.colorwayId)) {
      if (r.changes.name) locks.push(["colorway", r.colorwayId, "name"]);
      if (r.changes.category) locks.push(["colorway", r.colorwayId, "productType"]);
      if (r.action === "archive") locks.push(["colorway", r.colorwayId, "status"]);
    }
  }
  if (locks.length) {
    await client.query(
      `insert into "FieldOwner" (id, "entityType", "entityId", field, owner, authority, evidence, "decidedAt", "lockedAt")
       select gen_random_uuid()::text, u.et, u.eid, u.f, 'MANUAL'::"Source", $4, $5, now(), now()
         from unnest($1::text[], $2::text[], $3::text[]) as u(et, eid, f)
       on conflict ("entityType", "entityId", field) do update set
         owner = excluded.owner, authority = excluded.authority, evidence = excluded.evidence,
         "decidedAt" = excluded."decidedAt", "lockedAt" = excluded."lockedAt"`,
      [locks.map((l) => l[0]), locks.map((l) => l[1]), locks.map((l) => l[2]), AUTHORITY, EVIDENCE]
    );
  }
  result.locks = locks.length;

  if (result.styles.stale.length || result.colorways.stale.length) {
    throw new Error(`Stale rows — edited since the plan: ${JSON.stringify({ styles: result.styles.stale, colorways: result.colorways.stale })}`);
  }
  await client.query(APPLY ? "COMMIT" : "ROLLBACK");
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  result.error = e.message;
} finally {
  await client.end();
}

result.finishedAt = new Date().toISOString();
const out = `snapshots/vintage-cleanup-origio-${result.mode}-${result.startedAt.replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, colorways: { ...result.colorways, archived: result.colorways?.archived?.length } }, null, 2));
console.log(`${APPLY && !result.error ? "COMMITTED" : "ROLLED BACK"} → ${out}`);
process.exit(result.error ? 1 : 0);
