// M.O.P buttons (2526-1208-*) — restructure in Origio before the Loom push.
// Approved by Kristoffer 2026-10-07.
//
// Cin7 imported them as five one-colourway styles named "M.O.P button 515 Smoke",
// with only the 17 sizes that had stock that day. Wanted:
//   style 2526-1208 "M.O.P button" → colourway 2526-1208-515 "515 Smoke" → sizes L16…L32
// in the season named exactly STORAGE, in Origio and in Loom (Loom sends STORAGE
// products to Pio without barcodes).
//
//   node scripts/mop-buttons/apply.mjs            dry run: prints the plan, writes nothing
//   node scripts/mop-buttons/apply.mjs --apply    one transaction; re-run is a no-op
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
process.removeAllListeners("warning");

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; })
);

const STYLE_SKU = "2526-1208";
const STYLE_NAME = "M.O.P button";
// The 515 style row becomes the parent; the other four are emptied and deleted.
const KEEP_STYLE_SKU = "2526-1208-515";
const COLOURS = {
  "511": "White",
  "5120": "Trocas Smoke Brown",
  "515": "Smoke",
  "516": "White White",
  "517": "White",
};
const SIZES = ["L16", "L18", "L20", "L22", "L24", "L28", "L32"];

const c = new pg.Client({ connectionString: env.ORIGO_DATABASE_URL_UNPOOLED });
await c.connect();
const q = async (s, p = []) => (await c.query(s, p)).rows;

const snapshot = async () => ({
  styles: await q(`select id, "styleSku", "styleName" from "Style" where "styleSku" like '2526-1208%' order by "styleSku"`),
  colorways: await q(
    `select c.id, c."colorwaySku", c.name, c.color, c.kind, s."styleSku",
            (select string_agg(se2.code, ',') from "SeasonEntry" se join "Season" se2 on se2.id = se."seasonId" where se."colorwayId" = c.id) seasons,
            (select count(*)::int from "Variant" v where v."colorwayId" = c.id) variants,
            (select string_agg(cp.channel::text, ',') from "ChannelPublication" cp where cp."colorwayId" = c.id) pubs
       from "Colorway" c join "Style" s on s.id = c."styleId"
      where c."colorwaySku" like '2526-1208-%' order by c."colorwaySku"`
  ),
  storageSeason: await q(`select id, code, kind from "Season" where code = 'STORAGE'`),
});

const before = await snapshot();
console.log("BEFORE", JSON.stringify(before, null, 1));

const keep = before.styles.find((s) => s.styleSku === KEEP_STYLE_SKU) ??
  before.styles.find((s) => s.styleSku === STYLE_SKU);
if (!keep) throw new Error("no 2526-1208 style row to keep");
const continuity = (await q(`select id from "Season" where code = 'CONTINUITY'`))[0];

const existingVariants = new Set(
  (await q(`select "variantSku" from "Variant" where "variantSku" like '2526-1208-%'`)).map((r) => r.variantSku)
);
const toCreate = [];
for (const code of Object.keys(COLOURS)) {
  for (const size of SIZES) {
    const sku = `${STYLE_SKU}-${code}-${size}`;
    if (!existingVariants.has(sku)) toCreate.push({ colourCode: code, sku, size });
  }
}
console.log(`\nplan: style ${keep.styleSku} → ${STYLE_SKU} "${STYLE_NAME}"; 5 colourways moved/renamed; ` +
  `${toCreate.length} sizes to create; season CONTINUITY → STORAGE`);
console.log("sizes to create:", toCreate.map((v) => v.sku).join(" "));

if (!apply) {
  console.log("\nDry run — nothing written. Re-run with --apply.");
  await c.end();
  process.exit(0);
}

await c.query("BEGIN");
try {
  // 1. Origio needs a STORAGE season for the push route's season guard. Kind
  //    CONTINUITY (season-less) keeps it out of the REGULAR carry-over targets.
  await q(
    `insert into "Season" (id, code, name, kind, "sortOrder", "createdAt", "updatedAt")
     values ($1, 'STORAGE', 'STORAGE', 'CONTINUITY', 0, now(), now())
     on conflict (code) do nothing`,
    [randomUUID()]
  );
  const storage = (await q(`select id from "Season" where code = 'STORAGE'`))[0];

  // 2. The parent style.
  const st = await q(
    `update "Style" set "styleSku" = $2, "styleName" = $3, "updatedAt" = now()
      where id = $1 and ("styleSku" <> $2 or "styleName" <> $3) returning id`,
    [keep.id, STYLE_SKU, STYLE_NAME]
  );
  console.log("style updated:", st.length);

  for (const [code, colour] of Object.entries(COLOURS)) {
    const cwSku = `${STYLE_SKU}-${code}`;
    const name = `${code} ${colour}`;
    const [cw] = await q(`select id from "Colorway" where "colorwaySku" = $1`, [cwSku]);
    if (!cw) throw new Error(`missing colourway ${cwSku}`);

    // 3. Move under the parent and rename "515 Smoke".
    const moved = await q(
      `update "Colorway" set "styleId" = $2, name = $3, color = $4, "updatedAt" = now()
        where id = $1 and ("styleId" <> $2 or name <> $3 or color is distinct from $4) returning id`,
      [cw.id, keep.id, name, colour]
    );

    // 4. File under STORAGE: move the CONTINUITY entry rather than adding a second,
    //    so a CONTINUITY push never carries these to Loom's Archive shelf.
    let [entry] = await q(`select id from "SeasonEntry" where "colorwayId" = $1 and "seasonId" = $2`, [cw.id, storage.id]);
    if (!entry) {
      [entry] = await q(
        `update "SeasonEntry" set "seasonId" = $3 where "colorwayId" = $1 and "seasonId" = $2 returning id`,
        [cw.id, continuity.id, storage.id]
      );
    }
    if (!entry) {
      [entry] = await q(
        `insert into "SeasonEntry" (id, "colorwayId", "seasonId", cancelled, "approvedForProduction", origin)
         values ($1, $2, $3, false, false, 'NEW') returning id`,
        [randomUUID(), cw.id, storage.id]
      );
    }

    // 5. The sizes Cin7's import skipped because they had no stock that day.
    let created = 0;
    for (const v of toCreate.filter((t) => t.colourCode === code)) {
      const r = await q(
        `insert into "Variant" (id, "colorwayId", "variantSku", barcode, "sizeLabel", dim1, dim2, "createdAt", "updatedAt")
         values ($1, $2, $3, null, $4, $4, null, now(), now())
         on conflict ("variantSku") do nothing returning id`,
        [randomUUID(), cw.id, v.sku, v.size]
      );
      created += r.length;
    }
    // Every size belongs to the colourway's season entry.
    await q(
      `insert into "SeasonVariant" ("seasonEntryId", "variantId")
       select $1, v.id from "Variant" v where v."colorwayId" = $2
       on conflict do nothing`,
      [entry.id, cw.id]
    );
    // The Loom declaration — row presence is what the feed reads.
    await q(
      `insert into "ChannelPublication" (id, "colorwayId", channel, published)
       values ($1, $2, 'LOOM', false) on conflict do nothing`,
      [randomUUID(), cw.id]
    );
    console.log(`${cwSku}: moved ${moved.length}, sizes created ${created}`);
  }

  // 6. The four emptied one-colourway styles. Never in Loom, so no shells.
  const del = await q(
    `delete from "Style" s where s."styleSku" like '2526-1208-%' and s.id <> $1
       and not exists (select 1 from "Colorway" c where c."styleId" = s.id) returning "styleSku"`,
    [keep.id]
  );
  console.log("empty styles deleted:", del.map((r) => r.styleSku).join(" ") || "none");

  await c.query("COMMIT");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
}

console.log("\nAFTER", JSON.stringify(await snapshot(), null, 1));
await c.end();
