// Re-push to Loom (mode "data") every colourway that survey.mjs found ACTIVE in
// Shopify, with the InventoryItem id already in Origio, but none in Loom.
// Needs a dev server on origin/main (PORT, default 3005).
//
//   node scripts/shopify-inventory-ids/backfill.mjs                 dry run
//   node scripts/shopify-inventory-ids/backfill.mjs --only <cwSku>  dry run, one colourway
//   node scripts/shopify-inventory-ids/backfill.mjs --apply [--only …] [--season X]
//
// Held out: Japan Black d9f57551 — Loom holds a duplicate row (bd928077) that
// owns its SKUs; one refusal fails the whole job, and its stock sits on the
// other row, which is fully linked. Nothing here archives.
import pg from "pg";
import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
config({ path: new URL("../../.env.local", import.meta.url).pathname, quiet: true });

const PORT = process.env.PORT ?? "3005";
const apply = process.argv.includes("--apply");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx > 0 ? process.argv[onlyIdx + 1] : null;
const seasonIdx = process.argv.indexOf("--season");
const onlySeason = seasonIdx > 0 ? process.argv[seasonIdx + 1] : null;
const HOLD = new Set(["d9f57551-9c52-4202-b387-f7c3b6e3eada"]);

const survey = JSON.parse(readFileSync(new URL("./survey.json", import.meta.url)));
const target = survey.missing.filter((m) => m.shopifyStatus === "ACTIVE" && m.origioState === "origio-has-inv");
const ids = new Set(target.map((m) => m.origioColorwayId).filter((id) => !HOLD.has(id)));
const expect = new Map(target.map((m) => [m.origioVariantId, m.shopifyInventoryItemId]));

const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED });
await c.connect();
let cws;
try {
  ({ rows: cws } = await c.query(
    `SELECT cw.id, cw."colorwaySku", cw.archived,
            array_agg(s.code ORDER BY s."sortOrder", s.code) FILTER (WHERE s.code IS NOT NULL) AS seasons
     FROM "Colorway" cw
     LEFT JOIN "SeasonEntry" e ON e."colorwayId" = cw.id
     LEFT JOIN "Season" s ON s.id = e."seasonId"
     WHERE cw.id = ANY($1)
     GROUP BY cw.id`,
    [[...ids]]
  ));
} finally {
  await c.end();
}

const bySeason = new Map();
const held = [...HOLD].map((h) => `${h} (Loom duplicate identity)`);
for (const cw of cws) {
  if (only && cw.colorwaySku !== only) continue;
  if (cw.archived) { held.push(`${cw.colorwaySku} (archived)`); continue; }
  const s = cw.seasons ?? [];
  // Identity is season-free; the season only picks which prices ride along.
  const season = s.includes("CONTINUITY") ? "CONTINUITY" : s.at(-1);
  if (!season) { held.push(`${cw.colorwaySku} (no season)`); continue; }
  (bySeason.get(season) ?? bySeason.set(season, []).get(season)).push(cw.id);
}
console.log("colourways:", cws.length, "held:", held, "by season:", Object.fromEntries([...bySeason].map(([k, v]) => [k, v.length])));

const out = { apply, only, results: [] };
const stamp = Date.now();
for (const [seasonCode, colorwayIds] of bySeason) {
  if (onlySeason && seasonCode !== onlySeason) continue;
  const body = {
    colorwayIds,
    seasonCode,
    mode: "data",
    dryRun: !apply,
    ...(apply ? { eventId: `shopify-inv-ids-2026-09-28-${seasonCode}-${stamp}` } : {}),
  };
  const res = await fetch(`http://localhost:${PORT}/api/catalog/push/loom`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  out.results.push({ seasonCode, status: res.status, j });
  console.log(seasonCode, res.status, JSON.stringify({ ok: j.ok, requested: j.requested, sent: j.sent, skipped: j.skipped, eventId: j.eventId, jobId: j.jobId, error: j.error }));
  if (j.job) console.log("  job:", JSON.stringify({ status: j.job.status, summary: j.job.summary, itemErrors: j.job.itemErrors }));

  if (!apply && j.preview) {
    const sent = j.preview.payload.styles.flatMap((s) => s.colorways);
    const vs = new Map(sent.flatMap((cw) => cw.variants.map((v) => [v.variant_id, { ...v, cw }])));
    const mine = [...expect].filter(([vid]) => vs.has(vid));
    const bad = mine.filter(([vid, inv]) => String(vs.get(vid).shopify_inventory_item_id) !== String(inv));
    console.log(`  variants in payload ${vs.size}; targeted ${mine.length}, carrying the Shopify id ${mine.length - bad.length}`);
    if (bad.length) console.log("  WRONG/MISSING:", bad.map(([vid, inv]) => `${vs.get(vid).sku} want ${inv} got ${vs.get(vid).shopify_inventory_item_id}`));
    console.log("  gid-shaped ids (must be 0):", [...vs.values()].filter((v) => String(v.shopify_inventory_item_id ?? "").startsWith("gid:")).length);
    console.log("  loom:false (must be empty):", sent.filter((cw) => !cw.channels.loom).map((cw) => cw.colorway_sku));
    console.log("  shopify:false:", sent.filter((cw) => !cw.channels.shopify).map((cw) => cw.colorway_sku));
    console.log("  sitoo:false:", sent.filter((cw) => !cw.channels.sitoo).map((cw) => cw.colorway_sku));
  }
}
writeFileSync(new URL(`./backfill-${apply ? "live" : "dry"}${only ? "-" + only : ""}.json`, import.meta.url), JSON.stringify(out, null, 1));
