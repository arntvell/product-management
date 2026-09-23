// Read-only: ask Loom how it resolves every Saphir SKU and barcode we hold.
import pg from "pg";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
const c = new pg.Client({ connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL });
await c.connect();
const { rows } = await c.query(`SELECT v."variantSku", v.barcode FROM "Variant" v JOIN "Colorway" cw ON cw.id=v."colorwayId" JOIN "Brand" b ON b.id=cw."brandId" WHERE b.name ILIKE '%saphir%' ORDER BY 1`);
await c.end();
const res = await fetch("https://loom.livid.no/api/origio/v1/identity", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ skus: rows.map((r) => r.variantSku), barcodes: rows.map((r) => r.barcode).filter(Boolean) }),
});
const j = await res.json();
// --table prints one line per key; without it, the raw JSON.
if (process.argv.includes("--table")) {
  for (const r of j.rows) {
    const v = r.variant;
    console.log(
      r.kind.padEnd(8), r.key.padEnd(18), "->",
      v ? `cw ${v.colorway.sku.padEnd(18)} "${v.colorway.name}" / variant "${v.name}"` : "(no variant)",
      r.colorway ? `| as colourway: ${r.colorway.sku}` : ""
    );
  }
} else {
  console.log(res.status, JSON.stringify(j, null, 1).slice(0, 12000));
}
