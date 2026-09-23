import pg from "pg";
import { config } from "dotenv";
config({ path: "/Users/kristoffer/product-management-builder/.env.local" });
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL });
await c.connect();
const { rows } = await c.query(`
 SELECT b.name brand, s."styleSku", s."styleName", s.id sid, s."threadflowId" stf, cw.id cwid, cw."colorwaySku", cw.name, cw.source, cw.archived, cw."threadflowId" ctf, cw.kind, cw.status, cw."productType", cw.vendor,
   (SELECT count(*) FROM "Colorway" c2 WHERE c2."styleId"=s.id)::int cws_in_style,
   v."variantSku", v."sizeLabel", v.barcode
 FROM "Colorway" cw JOIN "Brand" b ON b.id=cw."brandId" JOIN "Style" s ON s.id=cw."styleId"
 LEFT JOIN "Variant" v ON v."colorwayId"=cw.id
 WHERE b.name ILIKE '%saphir%' OR cw."colorwaySku" ILIKE 'EXT-ZP%'
 ORDER BY s."styleSku", cw."colorwaySku", v."variantSku"`);
let last=null;
for (const r of rows) {
  const k = r.cwid;
  if (k!==last) { console.log(`\n[${r.brand}] style ${r.styleSku} "${r.styleName}" (${r.cws_in_style} cw${r.stf?' TF':''}) | cw ${r.colorwaySku} "${r.name}" src=${r.source} arch=${r.archived} tf=${r.ctf?'Y':'-'} type=${r.productType}`); last=k; }
  if (r.variantSku) console.log(`    ${r.variantSku.padEnd(24)} size=${String(r.sizeLabel).padEnd(8)} ${r.barcode??''}`);
}
console.log("\ncolourways:", new Set(rows.map(r=>r.cwid)).size, "variants:", rows.filter(r=>r.variantSku).length);
await c.end();
