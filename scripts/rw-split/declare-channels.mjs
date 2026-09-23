// Declare channel membership for the 14 colourways minted by the Red Wing split.
//
// `VariantChannelRef` is evidence; `ChannelPublication` is the DECLARATION, and
// the Loom payload reads row presence. The split carried the evidence across with
// the variant ids but minted colourways that have no publication rows, so a push
// would send these 14 as `sitoo: false, shopify: false` — and Loom SUPPRESSES
// stock errors for a channel declared false. All 14 are live in Sitoo and 9 in
// Shopify, so that would be wrong, and the flags ride on every push, not just a
// membership one.
//
// Same rule as syncChannelMembership, scoped to this split: declare a channel
// where that colourway's own variants carry a ref for it. Additive only, and
// guarded on the unique (colorwayId, channel) — a re-run is a no-op.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const plan = JSON.parse(readFileSync("snapshots/rw-split-plan.json", "utf8"));
const skus = plan.plan.map((p) => p.newColorwaySku);

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const { rows: before } = await client.query(
  `SELECT cw."colorwaySku", r.channel, count(*)::int refs,
          bool_or(cp.id IS NOT NULL) declared
     FROM "Colorway" cw
     JOIN "Variant" v ON v."colorwayId" = cw.id
     JOIN "VariantChannelRef" r ON r."variantId" = v.id
     LEFT JOIN "ChannelPublication" cp ON cp."colorwayId" = cw.id AND cp.channel = r.channel
    WHERE cw."colorwaySku" = ANY($1::text[])
    GROUP BY 1, 2 ORDER BY 1, 2`,
  [skus]
);
console.log("BEFORE — link evidence vs declaration:");
console.table(before);
const todo = before.filter((r) => !r.declared);
console.log(`to declare: ${todo.length}`);

if (APPLY && todo.length) {
  await client.query("BEGIN");
  try {
    for (const t of todo) {
      await client.query(
        `INSERT INTO "ChannelPublication" (id, "colorwayId", channel, published)
         SELECT $1, cw.id, $2::"Channel", false FROM "Colorway" cw WHERE cw."colorwaySku" = $3
         ON CONFLICT ("colorwayId", channel) DO NOTHING`,
        [randomUUID(), t.channel, t.colorwaySku]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  const { rows: after } = await client.query(
    `SELECT cw."colorwaySku", cp.channel, cp.published
       FROM "Colorway" cw JOIN "ChannelPublication" cp ON cp."colorwayId" = cw.id
      WHERE cw."colorwaySku" = ANY($1::text[]) ORDER BY 1, 2`,
    [skus]
  );
  console.log("\nAFTER — declarations now held:");
  console.table(after);
}
console.log(APPLY ? "\nAPPLIED" : "\nDRY RUN — re-run with --apply");
await client.end();
