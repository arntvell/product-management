// Give a twin's live record back the identity Loom and Pio are bound to.
//
//   npx tsx scripts/twin-pin/swap-ids.ts --only=LIV-SRN-JPN-BLCK-DSK            dry run
//   npx tsx scripts/twin-pin/swap-ids.ts --only=LIV-SRN-JPN-BLCK-DSK --apply    writes Origio
//
// ORIGIO ONLY. Reads Loom to check the shape, sends nothing.
//
// The 2026-09-15 merge kept the Threadflow-born row (colorway + sizes) and
// tombstoned the Cin7 row. Loom identifies products and sizes by OUR ids, and
// its stock, Pio link and Sitoo link sit on the Cin7 ids, so Loom's live product
// is an empty shell and its archived one holds everything. Siren Black Dusk:
// 243 units on archived 814a12d1, 1 on live dec4bee2.
//
// Moving sizes between products in Loom would leave the shells behind under the
// live product with duplicate barcodes. So this swaps IDS, not rows: the content
// stays put and only the ids trade places. Every foreign key to Colorway and
// Variant is ON UPDATE CASCADE (checked on the live database 2026-10-28), so
// each relation stays with its content. A later Loom push then UPDATES both
// records in place (live → 814a12d1 un-archived, shell → dec4bee2 archived) and
// moves nothing.
//
// Plain-text holders that do not cascade, handled here:
//   FieldOwner.entityId    swapped with the ids (locks, the SKU pin, provenance)
//   Colorway.sameProduct   repointed
//   tombstone SKU suffixes `--merged-into-<id8>` / `--merged-<id8>` rewritten
// Left as is: MediaAsset url/blobPathname and ChannelPublication.baseline carry
// the old id only inside blob paths, which are storage keys and not joined on.
//
// Symmetric: running it again on the result swaps back. A JSON snapshot of both
// records is written to snapshots/ before any write.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const LOOM = "https://loom.livid.no/api/origio/v1";

async function main() {
  if (!ONLY) throw new Error("Pass --only=<business colorway SKU>; this runs one twin at a time.");
  const { prisma } = await import("../../src/lib/db.ts");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  if (!token) throw new Error("Missing LOOM_LOCAL_TOKEN / LOOM_TOKEN");

  const select = {
    id: true, colorwaySku: true, archived: true, status: true, threadflowId: true,
    variants: { select: { id: true, variantSku: true, sizeLabel: true, barcode: true,
      channelRefs: { select: { channel: true, externalId: true, externalSku: true } } } },
    publications: { select: { channel: true, published: true, externalId: true } },
  } as const;
  const live = await prisma.colorway.findUnique({ where: { colorwaySku: ONLY }, select });
  if (!live) throw new Error(`${ONLY}: no live colorway`);
  const tomb = await prisma.colorway.findFirst({
    where: { colorwaySku: { startsWith: `${ONLY}--merged-into-` } }, select,
  });
  if (!tomb) throw new Error(`${ONLY}: no merge tombstone`);
  const tombTag = tomb.colorwaySku.split("--merged-into-")[1];
  if (!live.id.startsWith(tombTag)) throw new Error(`${tomb.colorwaySku} does not point at ${live.id}`);

  // Loom's archived record: which tombstone size ids it actually holds.
  const problems: string[] = [];
  const loomGet = async (sku: string) =>
    ((await (await fetch(`${LOOM}/products?sku=${encodeURIComponent(sku)}`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as any).rows ?? [];
  const loomRows = [...(await loomGet(tomb.colorwaySku))];
  const loomTomb = loomRows.find((r: any) => r.colorway_id === tomb.id);
  if (!loomTomb) problems.push(`Loom holds no record with the tombstone's id ${tomb.id}`);
  const loomTombVids = new Set<string>((loomTomb?.variants ?? []).map((v: any) => v.variant_id));

  // Pair sizes: live `${ONLY}-<size>` with tombstone `${ONLY}-<size>--merged-<tag>`.
  // A pair SWAPS only when Loom holds the tombstone size, since that is the
  // identity carrying the stock. Otherwise the live size keeps its id and
  // RIDES ALONG: it is in Loom under the shell and will MOVE in the push,
  // which loom-push.ts allows only for named, zero-stock sizes. A live size
  // with no twin passes only if it was never made (no barcode, no link).
  const pairs: Array<{ lv: (typeof live.variants)[number]; tv: (typeof tomb.variants)[number] }> = [];
  const ridesAlong: string[] = [];
  const neverMade: string[] = [];
  const parkedTomb: Array<{ id: string; sku: string }> = []; // tombstone sizes that stay put
  for (const lv of live.variants) {
    const tv = tomb.variants.find((t) => t.variantSku === `${lv.variantSku}--merged-${tombTag}`);
    if (tv && loomTombVids.has(tv.id)) { pairs.push({ lv, tv }); continue; }
    if (tv) { ridesAlong.push(`${lv.variantSku} ${lv.id}`); parkedTomb.push({ id: tv.id, sku: tv.variantSku }); continue; }
    if (!lv.barcode && !lv.channelRefs.length) { neverMade.push(lv.variantSku); continue; }
    problems.push(`${lv.variantSku}: no tombstone twin, and it has a barcode or a channel link`);
  }
  for (const t of tomb.variants) {
    const paired = pairs.some((p) => p.tv.id === t.id) || parkedTomb.some((x) => x.id === t.id);
    if (!paired) problems.push(`${t.variantSku}: tombstone size with no live twin`);
  }
  for (const vid of loomTombVids)
    if (!pairs.some((p) => p.tv.id === vid)) problems.push(`Loom's archived record holds size ${vid}, which would not be swapped`);
  if (!pairs.length) problems.push("no size pairs to swap");
  const onHand = (r: any) => (r?.variants ?? []).reduce((a: number, v: any) =>
    a + (v.stock ?? []).reduce((b: number, s: any) => b + (s.on_hand ?? 0), 0), 0);

  const id8 = (s: string) => s.slice(0, 8);
  console.log(`${ONLY}`);
  console.log(`  live      ${live.id}  ${live.colorwaySku}  ${live.variants.length} sizes`);
  console.log(`  tombstone ${tomb.id}  ${tomb.colorwaySku}  ${tomb.variants.length} sizes`);
  console.log(`  Loom: archived record ${loomTomb ? `found, archived=${loomTomb.archived}, ${onHand(loomTomb)} units` : "MISSING"}`);
  console.log(`  after: live content takes id ${id8(tomb.id)}…, the tombstone takes ${id8(live.id)}…`);
  console.log(`  ${pairs.length} size pair(s) swap ids, ${ridesAlong.length} ride along (MOVE in Loom), ${neverMade.length} never made`);
  for (const r of ridesAlong) console.log(`    rides along: ${r}`);
  for (const n of neverMade) console.log(`    never made:  ${n}`);
  for (const p of problems) console.log(`  ! ${p}`);
  if (problems.length) { await prisma.$disconnect(); process.exit(1); }

  if (!APPLY) { console.log("\n  DRY RUN — nothing written. Add --apply."); await prisma.$disconnect(); return; }

  mkdirSync("snapshots", { recursive: true });
  const snap = `snapshots/twin-swap-${ONLY}-${Date.now()}.json`;
  const owners = await prisma.fieldOwner.findMany({
    where: { entityId: { in: [live.id, tomb.id, ...pairs.flatMap((p) => [p.lv.id, p.tv!.id])] } },
  });
  writeFileSync(snap, JSON.stringify({ live, tomb, owners }, null, 2));
  console.log(`  snapshot ${snap}`);

  const A = live.id, B = tomb.id;
  const swaps: Array<[string, string, "Colorway" | "Variant"]> = [
    [A, B, "Colorway"],
    ...pairs.map((p) => [p.lv.id, p.tv.id, "Variant"] as [string, string, "Variant"]),
  ];
  const newTombTag = id8(B); // the tombstone will carry id A, pointing at the live B
  await prisma.$transaction(async (tx) => {
    for (const [x, y, table] of swaps) {
      const tmp = `swap-${x}`;
      // Ids first; every FK cascades.
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET id = $1 WHERE id = $2`, tmp, x);
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET id = $1 WHERE id = $2`, x, y);
      await tx.$executeRawUnsafe(`UPDATE "${table}" SET id = $1 WHERE id = $2`, y, tmp);
      // FieldOwner follows the content, so it swaps too.
      await tx.$executeRawUnsafe(`UPDATE "FieldOwner" SET "entityId" = $1 WHERE "entityId" = $2`, tmp, x);
      await tx.$executeRawUnsafe(`UPDATE "FieldOwner" SET "entityId" = $1 WHERE "entityId" = $2`, x, y);
      await tx.$executeRawUnsafe(`UPDATE "FieldOwner" SET "entityId" = $1 WHERE "entityId" = $2`, y, tmp);
    }
    // Siblings that link to the live record by id.
    await tx.$executeRawUnsafe(
      `UPDATE "Colorway" SET "sameProduct" = array_replace("sameProduct", $1, $2) WHERE $1 = ANY("sameProduct")`, A, B);
    // The tombstone (now id A) points at the live record (now id B).
    await tx.colorway.update({ where: { id: A }, data: { colorwaySku: `${ONLY}--merged-into-${newTombTag}` } });
    for (const p of pairs) {
      // p.lv.id now holds the tombstone size's content.
      await tx.variant.update({ where: { id: p.lv.id }, data: { variantSku: `${p.lv.variantSku}--merged-${newTombTag}` } });
    }
    // Tombstone sizes that were not swapped keep their ids; only the tag follows.
    for (const t of parkedTomb) {
      await tx.variant.update({ where: { id: t.id }, data: { variantSku: t.sku.replace(`--merged-${tombTag}`, `--merged-${newTombTag}`) } });
    }
  }, { timeout: 120_000 });

  // Read back.
  const after = await prisma.colorway.findUnique({ where: { colorwaySku: ONLY }, select });
  const afterTomb = await prisma.colorway.findFirst({ where: { colorwaySku: { startsWith: `${ONLY}--merged-into-` } }, select });
  const liveIds = new Set(after?.variants.map((v) => v.id));
  const count = (vs: { barcode: string | null; channelRefs: unknown[] }[] | undefined) =>
    `${vs?.length}/${vs?.filter((v) => v.barcode).length}/${vs?.reduce((a, v) => a + v.channelRefs.length, 0)}`;
  // Content did not move, so sizes/barcodes/refs per record must be unchanged.
  const ok = after?.id === B && afterTomb?.id === A &&
    pairs.every((p) => liveIds.has(p.tv.id)) &&
    ridesAlong.every((r) => liveIds.has(r.split(" ")[1])) &&
    count(after.variants) === count(live.variants) &&
    count(afterTomb.variants) === count(tomb.variants);
  console.log(`  read back: ${ok ? "ok" : "MISMATCH"}`);
  console.log(`    live      ${after?.id} ${after?.colorwaySku} ${after?.variants.length} sizes, ${after?.variants.filter((v) => v.barcode).length} barcodes, refs ${after?.variants.reduce((a, v) => a + v.channelRefs.length, 0)}, pubs ${after?.publications.map((p) => p.channel).join(",")}`);
  console.log(`    tombstone ${afterTomb?.id} ${afterTomb?.colorwaySku} ${afterTomb?.variants.length} sizes, archived=${afterTomb?.archived}`);
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
