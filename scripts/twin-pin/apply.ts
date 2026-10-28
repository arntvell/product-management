// Put the eleven 2026-09-15 twins back on the SKU the business uses, and pin
// them there so the Threadflow sync stops renaming them.
//
//   npx tsx scripts/twin-pin/apply.ts                       dry run, all eleven
//   npx tsx scripts/twin-pin/apply.ts --only=LIV-SRN-JPN-BLCK-DSK
//   npx tsx scripts/twin-pin/apply.ts --apply [--only=…]    writes Origio
//
// ORIGIO ONLY. Reads Loom and Shopify to check, writes neither.
//
// The history: the merges kept Threadflow's spelling, the same day's reversal
// put the business spelling back (docs/twin-merge-reversal.md), and a later
// sync renamed all eleven to Threadflow's spelling again. Pio joins on SKU
// text and still holds the business spelling, and so do Sitoo and (mostly)
// Shopify. The business spelling is read off each merge tombstone,
// `<business>--merged-into-<survivor id prefix>`.
//
// Per twin, in one transaction:
//   - colorway and each size renamed to the business spelling
//   - each Shopify ref's alias set to what Shopify actually holds (null when it
//     now agrees with the master)
//   - a MANUAL FieldOwner on colorwaySku with evidence `threadflow:<its SKU>`,
//     the pin `applySkuPins` in src/lib/threadflow/sync.ts honours
//
// Refuses a twin if a target SKU is taken, if the sizes do not match what Loom's
// tombstone (= Pio's spelling) holds, or if the survivor has a size whose SKU
// does not start with its colorway's.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const TWINS = [
  "LIV-SRN-JPN-BLCK-DSK",
  "LIV-INTL-CLST-OX",
  "LIV-INTL-GRY-OX",
  "LIV-INTL-CLST-PNSTRP-OX",
  "LIV-INTL-WHT-OX",
  "LIV-COT-WHT",
  "LIV-V-WHT",
  "LIV-ABY-WH",
  "LIV-NAR-WHT",
  "LIV-ID-BLCK",
  "LIV-ML-WHT",
];

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const LOOM = "https://loom.livid.no/api/origio/v1";

async function main() {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../../src/generated/prisma/client.ts");
  const { shopifyGraphQL } = await import("../../src/lib/shopify/client.ts");
  const { THREADFLOW_SKU_EVIDENCE } = await import("../../src/lib/threadflow/sync.ts");
  const p = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
  });
  const loomToken = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  if (!loomToken) throw new Error("Missing LOOM_LOCAL_TOKEN / LOOM_TOKEN");

  const targets = ONLY ? TWINS.filter((t) => t === ONLY) : TWINS;
  if (!targets.length) throw new Error(`--only=${ONLY} is not one of the eleven`);

  let refused = 0;
  for (const business of targets) {
    const tomb = await p.colorway.findFirst({
      where: { colorwaySku: { startsWith: `${business}--merged-into-` } },
      select: { colorwaySku: true },
    });
    if (!tomb) { console.log(`REFUSE ${business}: no merge tombstone`); refused++; continue; }
    const prefix = tomb.colorwaySku.split("--merged-into-")[1];
    const cw = await p.colorway.findFirst({
      where: { id: { startsWith: prefix }, NOT: { colorwaySku: { contains: "--merged" } } },
      select: {
        id: true, colorwaySku: true,
        variants: {
          select: {
            id: true, variantSku: true, sizeLabel: true, barcode: true,
            channelRefs: { select: { id: true, channel: true, externalId: true, externalSku: true } },
          },
        },
      },
    });
    if (!cw) { console.log(`REFUSE ${business}: survivor ${prefix}… not found`); refused++; continue; }
    const from = cw.colorwaySku;
    if (from === business) { console.log(`ok     ${business}: already on the business SKU`); }

    const problems: string[] = [];
    const renames = cw.variants.map((v) => {
      if (!v.variantSku.startsWith(`${from}-`)) problems.push(`${v.variantSku} does not start with ${from}-`);
      return { v, to: `${business}${v.variantSku.slice(from.length)}` };
    });

    if (from !== business) {
      const taken = await p.colorway.findUnique({ where: { colorwaySku: business }, select: { id: true } });
      if (taken) problems.push(`colorway SKU ${business} is held by ${taken.id}`);
      const takenV = await p.variant.findMany({
        where: { variantSku: { in: renames.map((r) => r.to) } }, select: { variantSku: true },
      });
      for (const t of takenV) problems.push(`variant SKU ${t.variantSku} is taken`);
    }

    // Loom's tombstone carries the spelling Pio and Sitoo hold.
    const loomRow = (
      (await (await fetch(`${LOOM}/products?sku=${encodeURIComponent(tomb.colorwaySku)}`, {
        headers: { authorization: `Bearer ${loomToken}` },
      })).json()) as any
    ).rows?.find((r: any) => r.colorway_sku === tomb.colorwaySku);
    const pioSkus = new Set<string>((loomRow?.variants ?? []).map((v: any) => v.variant_sku));
    const sitooBySku = new Map<string, string>((loomRow?.variants ?? []).map((v: any) => [v.variant_sku, v.sitoo_sku]));
    // Every target size SKU must be vouched for by a system that holds the
    // business spelling: Loom's tombstone (= Pio's spelling), or the Sitoo
    // product the size is linked to. A size never made (no barcode, no channel
    // link) has nothing to disagree with and takes the colorway's spelling.
    const { getProduct } = await import("../../src/lib/sitoo/client.ts");
    const vouched: string[] = [];
    const notVouched: string[] = [];
    for (const r of renames) {
      if (pioSkus.has(r.to)) continue;
      if (!r.v.barcode && !r.v.channelRefs.length) { vouched.push(`${r.to} (never made)`); continue; }
      const sitooRef = r.v.channelRefs.find((c) => c.channel === "SITOO");
      // One request at a time: Sitoo refuses a second connection.
      const sitooSku = sitooRef ? (await getProduct(Number(sitooRef.externalId))).sku : null;
      if (sitooSku === r.to) vouched.push(`${r.to} (Sitoo ${sitooRef!.externalId})`);
      else notVouched.push(`${r.to}${sitooSku ? ` (Sitoo has ${sitooSku})` : ""}`);
    }
    const onlyInLoom = [...pioSkus].filter((s) => !renames.some((r) => r.to === s));
    if (!loomRow) problems.push("Loom has no tombstone row to check against");
    if (notVouched.length) problems.push(`not held by Loom's tombstone or the linked Sitoo product: ${notVouched.join(", ")}`);
    if (onlyInLoom.length) problems.push(`Loom's tombstone has sizes the live record lacks: ${onlyInLoom.join(", ")}`);
    const sitooDiffer = renames.filter((r) => sitooBySku.has(r.to) && sitooBySku.get(r.to) !== r.to);

    // What Shopify actually holds, per linked variant.
    const shopRefs = renames.flatMap((r) => r.v.channelRefs.filter((c) => c.channel === "SHOPIFY").map((c) => ({ r, c })));
    const shopSku = new Map<string, string | null>();
    for (let i = 0; i < shopRefs.length; i += 100) {
      const ids = shopRefs.slice(i, i + 100).map((x) => x.c.externalId);
      const d: any = await shopifyGraphQL(`query($ids:[ID!]!){ nodes(ids:$ids){ ... on ProductVariant { id sku } } }`, { ids });
      for (const n of d.nodes) if (n?.id) shopSku.set(n.id, n.sku ?? null);
    }
    const aliasChanges = shopRefs.map(({ r, c }) => {
      const actual = shopSku.get(c.externalId);
      const next = actual === undefined ? c.externalSku : actual === r.to ? null : actual;
      return { id: c.id, from: c.externalSku, to: next, gone: actual === undefined };
    }).filter((a) => a.from !== a.to);
    const shopGone = shopRefs.filter(({ c }) => !shopSku.has(c.externalId)).length;

    const head = problems.length ? "REFUSE" : APPLY ? "APPLY " : "plan  ";
    console.log(`${head} ${from} -> ${business}  sizes ${renames.length}, Loom tombstone sizes ${pioSkus.size}` +
      (vouched.length ? `, vouched outside Loom: ${vouched.join(", ")}` : "") +
      `, Shopify aliases to change ${aliasChanges.length}` + (shopGone ? `, ${shopGone} Shopify refs not found` : "") +
      (sitooDiffer.length ? `, Sitoo spells ${sitooDiffer.length} differently: ${sitooDiffer.map((r) => sitooBySku.get(r.to)).join(",")}` : ""));
    for (const pr of problems) console.log(`         ! ${pr}`);
    if (problems.length) { refused++; continue; }
    if (!APPLY) continue;

    await p.$transaction(async (tx) => {
      if (from !== business) {
        await tx.colorway.update({ where: { id: cw.id }, data: { colorwaySku: business } });
        for (const r of renames) await tx.variant.update({ where: { id: r.v.id }, data: { variantSku: r.to } });
      }
      for (const a of aliasChanges) await tx.variantChannelRef.update({ where: { id: a.id }, data: { externalSku: a.to } });
      const now = new Date();
      await tx.fieldOwner.upsert({
        where: { entityType_entityId_field: { entityType: "colorway", entityId: cw.id, field: "colorwaySku" } },
        create: {
          entityType: "colorway", entityId: cw.id, field: "colorwaySku", owner: "MANUAL",
          authority: "business-sku:pio", evidence: `${THREADFLOW_SKU_EVIDENCE}${from === business ? "" : from}`, decidedAt: now,
        },
        update: {
          owner: "MANUAL", authority: "business-sku:pio",
          ...(from === business ? {} : { evidence: `${THREADFLOW_SKU_EVIDENCE}${from}` }), decidedAt: now,
        },
      });
    }, { timeout: 60_000 });

    // Read back.
    const back = await p.colorway.findUnique({ where: { id: cw.id }, select: { colorwaySku: true, variants: { select: { variantSku: true } } } });
    const ok = back?.colorwaySku === business && back.variants.every((v) => v.variantSku.startsWith(`${business}-`));
    console.log(`         read back: ${ok ? "ok" : "MISMATCH"} ${back?.colorwaySku}, ${back?.variants.length} sizes`);
  }
  await p.$disconnect();
  console.log(`\n${APPLY ? "applied" : "dry run"}; ${refused} refused`);
  process.exit(refused ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
