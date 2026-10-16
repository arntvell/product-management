// Why do Livid variants lack barcodes, when Threadflow is supposed to hold them?
//
//   npx dotenv -e .env.local -- npx tsx scripts/audit/livid-barcode-gap.ts
//
// READ-ONLY. Reads the master and Threadflow; writes nothing.
//
// Threadflow builds Livid's products and owns their barcodes — the sync carries
// them and deliberately never clobbers one a person corrected. So a barcode-less
// Livid variant is not something Origio should mint its own code for; it is a
// question about what Threadflow holds. This asks that question per variant.
//
// The master splits the gap in two, and they are different problems:
//
//   WHOLE-RUN    no size of the colourway has a barcode. Overwhelmingly SS27
//                drafts: a season Threadflow has not barcoded yet. They arrive
//                on their own.
//   PARTIAL-RUN  every size barcoded except one or two, consistently at the
//                extremes of the run — W27/L32, W38/L32, 3XL, 2XL. These are the
//                ones that do live damage: the colourway is ACTIVE and selling,
//                and `buildRegistryColorway` drops a barcode-less variant of a
//                Livid colourway from the Loom registry payload, so that one
//                size silently cannot sync stock however many times it is pushed.
//
// For each gap it then asks Threadflow which of three things is true:
//
//   TF_HAS_IT    Threadflow holds a barcode we have not synced. Ours to fix —
//                re-run the Threadflow sync.
//   TF_NULL      Threadflow knows the size and has assigned no barcode. Theirs
//                to fill; nothing to do here.
//   TF_UNKNOWN   Threadflow does not have the size at all — but that only means
//                something where Threadflow was ever expected to. It is new
//                software and only carries the seasons it was built for, so a
//                colourway outside them is NOT a defect. Split three ways:
//
//                  PRE_TF      the colourway is in no Threadflow season.
//                              Expected; Threadflow never knew it.
//                  TF_NO_CW    the colourway is in a Threadflow season and
//                              Threadflow does not have the colourway either.
//                  TF_NO_SIZE  Threadflow HAS the colourway and not this size.
//                              The sharp one: a size that exists here and
//                              nowhere upstream, so no barcode is ever coming.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/** Seasons to ask Threadflow about. Everything current plus the one in build. */
const SEASONS = ["SS27", "FW26"];

async function main() {
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../../src/generated/prisma/client.ts");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
  });

  const cws = await prisma.colorway.findMany({
    where: { brand: { isLivid: true }, variants: { some: { barcode: null } } },
    select: {
      colorwaySku: true,
      status: true,
      entries: { select: { season: { select: { code: true } } } },
      variants: {
        select: {
          variantSku: true,
          sizeLabel: true,
          barcode: true,
          channelRefs: { where: { channel: "SHOPIFY" }, select: { externalInventoryId: true } },
        },
      },
    },
  });
  await prisma.$disconnect();

  type Gap = { sku: string; size: string; cw: string; status: string; shopifyInv: boolean; shape: "WHOLE" | "PARTIAL"; seasons: string[] };
  const gaps: Gap[] = [];
  for (const c of cws) {
    const shape = c.variants.some((v) => v.barcode) ? "PARTIAL" : "WHOLE";
    for (const v of c.variants) {
      if (v.barcode) continue;
      gaps.push({
        sku: v.variantSku,
        size: v.sizeLabel,
        cw: c.colorwaySku,
        status: c.status,
        shopifyInv: !!v.channelRefs[0]?.externalInventoryId,
        shape,
        seasons: c.entries.map((e) => e.season.code),
      });
    }
  }

  // --- what Threadflow holds --------------------------------------------------
  const { getSeasonProducts } = await import("../../src/lib/threadflow/client.ts");
  const tf = new Map<string, string | null>();
  const tfColorways = new Set<string>();
  for (const season of SEASONS) {
    try {
      const { styles } = await getSeasonProducts(season, {
        includeUnapproved: true,
        includeDropped: true,
      } as never);
      let n = 0;
      for (const st of styles as any[])
        for (const c of st.colorways ?? []) {
          tfColorways.add(c.colorway_sku);
          for (const v of c.variants ?? []) {
            tf.set(v.sku, v.barcode);
            n++;
          }
        }
      console.log(`Threadflow ${season}: ${styles.length} styles, ${n} variants`);
    } catch (e) {
      console.log(`Threadflow ${season}: COULD NOT READ — ${(e as Error).message}`);
    }
  }

  const verdict = (g: Gap) => {
    if (tf.has(g.sku)) {
      const bc = tf.get(g.sku);
      return bc && String(bc).trim() ? ("TF_HAS_IT" as const) : ("TF_NULL" as const);
    }
    // Threadflow only carries the seasons it was built for. Absence outside them
    // says nothing.
    if (!g.seasons.some((s) => SEASONS.includes(s))) return "PRE_TF" as const;
    return tfColorways.has(g.cw) ? ("TF_NO_SIZE" as const) : ("TF_NO_CW" as const);
  };

  const table = new Map<string, number>();
  const syncable: string[] = [];
  const orphanLive: Gap[] = [];
  for (const g of gaps) {
    const v = verdict(g);
    const key = `${g.shape}/${v}`;
    table.set(key, (table.get(key) ?? 0) + 1);
    if (v === "TF_HAS_IT") syncable.push(g.sku);
    if (v === "TF_NO_SIZE" && (g.status === "ACTIVE" || g.shopifyInv)) orphanLive.push(g);
  }

  console.log(`\nLivid variants with no barcode: ${gaps.length}`);
  console.log(`  whole-run gaps  : ${gaps.filter((g) => g.shape === "WHOLE").length}`);
  console.log(`  partial-run gaps: ${gaps.filter((g) => g.shape === "PARTIAL").length}\n`);

  for (const shape of ["WHOLE", "PARTIAL"] as const) {
    console.log(`${shape}-run:`);
    for (const v of ["TF_HAS_IT", "TF_NULL", "TF_NO_SIZE", "TF_NO_CW", "PRE_TF"] as const) {
      const n = table.get(`${shape}/${v}`) ?? 0;
      if (!n) continue;
      const gloss = {
        TF_HAS_IT: "Threadflow has it — OUR sync gap, re-run the sync",
        TF_NULL: "Threadflow knows the size, no barcode yet — upstream, nothing to do",
        TF_NO_SIZE: "Threadflow has the colourway, NOT this size — no barcode is coming",
        TF_NO_CW: "Threadflow lacks the whole colourway, in a season it covers",
        PRE_TF: "colourway predates Threadflow's seasons — expected, not a defect",
      }[v];
      console.log(`   ${v.padEnd(11)} ${String(n).padStart(5)}   ${gloss}`);
    }
  }

  if (syncable.length) {
    console.log(`\n${syncable.length} barcode(s) sitting in Threadflow unsynced. Examples:`);
    for (const s of syncable.slice(0, 8)) console.log(`   ${s.padEnd(32)} TF holds ${tf.get(s)}`);
  }

  if (orphanLive.length) {
    console.log(
      `\n${orphanLive.length} size(s) are LIVE or Shopify-linked, in a Threadflow season, with the colourway present upstream but NOT the size —`
    );
    console.log(`these cannot sync stock and no upstream fix is coming:`);
    for (const g of orphanLive.slice(0, 15))
      console.log(`   ${g.sku.padEnd(34)} ${g.status.padEnd(8)} size ${String(g.size).padEnd(10)} shopifyInv=${g.shopifyInv ? "YES" : "no"}`);
    if (orphanLive.length > 15) console.log(`   …${orphanLive.length - 15} more`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
