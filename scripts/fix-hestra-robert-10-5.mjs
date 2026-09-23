// One-off (2026-09-23): Hestra Robert Toffee was imported with size 11 where
// the garment (barcode 7332904030153) is a 10.5. Renames the variant's size and
// SKU in the master and in its import draft. Barcode untouched. Nothing was
// pushed yet (no VariantChannelRef), so no channel needs correcting.
// Guarded on the old SKU + barcode: a re-run is a no-op.
import pg from "pg";
import fs from "fs";

const env = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^ORIGO_DATABASE_URL=["']?([^"'\n]+)/m)[1];
const c = new pg.Client({ connectionString: url });
await c.connect();

const VID = "090a68e4-81f7-4092-9c68-03db7ddadd93";
const DRAFT = "cmucpp0ts000604jnqo69hpyh";
const OLD = "EXT-HST-RBRT-TFF-11";
const NEW = "EXT-HST-RBRT-TFF-10.5";

const show = async (tag) =>
  console.log(tag, (await c.query(`select "variantSku","sizeLabel",dim1,barcode from "Variant" where id=$1`, [VID])).rows[0]);

await show("BEFORE");
await c.query("BEGIN");
try {
  const u = await c.query(
    `update "Variant" set "variantSku"=$1, "sizeLabel"='10.5', dim1='10.5', "updatedAt"=now()
     where id=$2 and "variantSku"=$3 and barcode='7332904030153'`,
    [NEW, VID, OLD],
  );
  console.log("variant rows updated:", u.rowCount);

  const d = (await c.query(`select payload from "ProductDraft" where id=$1 for update`, [DRAFT])).rows[0];
  let n = 0;
  for (const cw of d.payload.colorways)
    for (const v of cw.variants)
      if (v.key === "cc8th7jk" && v.variantSku === OLD) {
        Object.assign(v, { variantSku: NEW, sizeLabel: "10.5", dim1: "10.5", skuToken: "10.5" });
        n++;
      }
  if (n) await c.query(`update "ProductDraft" set payload=$1 where id=$2`, [d.payload, DRAFT]);
  console.log("draft payload variants updated:", n);
  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
}
await show("AFTER");
await c.end();
