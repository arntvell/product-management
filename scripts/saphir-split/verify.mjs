import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const plan = JSON.parse(readFileSync("snapshots/saphir-split-plan.json", "utf8"));
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL });
await c.connect();
const q = await c.query(`SELECT cw."colorwaySku", cw.color, s."styleName", s."weightKg",
  (SELECT string_agg(v."variantSku"||':'||v."sizeLabel", ',') FROM "Variant" v WHERE v."colorwayId"=cw.id) variants,
  (SELECT string_agg(p.currency||' '||p.amount, ',') FROM "Price" p WHERE p."colorwayId"=cw.id) price,
  (SELECT string_agg(cp.channel::text, ',' ORDER BY cp.channel) FROM "ChannelPublication" cp WHERE cp."colorwayId"=cw.id) pubs,
  (SELECT count(*)::int FROM "SeasonVariant" sv JOIN "SeasonEntry" e ON e.id=sv."seasonEntryId" WHERE e."colorwayId"=cw.id) svlinks,
  cw."fullDescription" IS NOT NULL descr, cw.tags
  FROM "Colorway" cw JOIN "Style" s ON s.id=cw."styleId" WHERE cw."colorwaySku"=ANY($1) ORDER BY s."styleName", 1`, [plan.plan.map(p=>p.newColorwaySku)]);
console.table(q.rows);
const par = await c.query(`SELECT "colorwaySku", archived, (SELECT count(*)::int FROM "Variant" v WHERE v."colorwayId"=cw.id) n FROM "Colorway" cw WHERE "colorwaySku"=ANY($1)`, [plan.parents]);
console.table(par.rows);
await c.end();
