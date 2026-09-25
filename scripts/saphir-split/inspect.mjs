import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL });
await c.connect();
const P = ["EXT-ZP","EXT-ZP-1925","EXT-ZP-PB","EXT-SP-PT1925"];
const cw = await c.query(`SELECT * FROM "Colorway" WHERE "colorwaySku"=ANY($1)`, [P]);
for (const r of cw.rows) { const o={}; for (const [k,v] of Object.entries(r)) if (v!==null && !(Array.isArray(v)&&!v.length)) o[k]=v; console.log(JSON.stringify(o)); }
const st = await c.query(`SELECT * FROM "Style" WHERE id=ANY($1)`, [cw.rows.map(r=>r.styleId)]);
for (const r of st.rows) { const o={}; for (const [k,v] of Object.entries(r)) if (v!==null) o[k]=v; console.log("STYLE", JSON.stringify(o)); }
const ids = cw.rows.map(r=>r.id);
for (const t of ["MediaAsset","Price","SeasonEntry","ChannelPublication","ChannelContent","SeasonImage","PushBatchItem"]) {
  const q = await c.query(`SELECT "colorwayId", count(*)::int n FROM "${t}" WHERE "colorwayId"=ANY($1) GROUP BY 1`, [ids]);
  console.log(t, JSON.stringify(q.rows.map(r=>[cw.rows.find(x=>x.id===r.colorwayId).colorwaySku, r.n])));
}
const pr = await c.query(`SELECT cw."colorwaySku", s.code, p.currency, p."priceType", p.amount FROM "Price" p JOIN "Colorway" cw ON cw.id=p."colorwayId" JOIN "Season" s ON s.id=p."seasonId" WHERE p."colorwayId"=ANY($1)`, [ids]);
console.table(pr.rows);
const se = await c.query(`SELECT cw."colorwaySku", s.code FROM "SeasonEntry" e JOIN "Colorway" cw ON cw.id=e."colorwayId" JOIN "Season" s ON s.id=e."seasonId" WHERE e."colorwayId"=ANY($1)`, [ids]);
console.table(se.rows);
const vr = await c.query(`SELECT v."variantSku", r.channel, count(*)::int FROM "Variant" v JOIN "VariantChannelRef" r ON r."variantId"=v.id WHERE v."colorwayId"=ANY($1) GROUP BY 1,2 ORDER BY 1,2`, [ids]);
console.table(vr.rows);
const vcols = await c.query(`SELECT * FROM "Variant" WHERE "colorwayId"=ANY($1) LIMIT 1`, [ids]);
console.log("VARIANT sample", JSON.stringify(vcols.rows[0]));
// convention: external multi-colourway styles
const conv = await c.query(`SELECT s."styleSku", s."styleName", cw."colorwaySku", cw.name, cw.color FROM "Style" s JOIN "Colorway" cw ON cw."styleId"=s.id JOIN "Brand" b ON b.id=s."brandId"
  WHERE b."isLivid" IS NOT TRUE AND s.id IN (SELECT "styleId" FROM "Colorway" GROUP BY 1 HAVING count(*)>1) ORDER BY random() LIMIT 20`);
console.table(conv.rows);
await c.end();
