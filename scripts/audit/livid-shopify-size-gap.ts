// Livid sizes the master holds that Shopify does not sell.
//
//   npx dotenv -e .env.local -- npx tsx scripts/audit/livid-shopify-size-gap.ts
//   …--csv=snapshots/livid-shopify-size-gap.csv
//
// READ-ONLY.
//
// Only colourways Shopify already has a product for are asked about: a colourway
// not published there is not "missing sizes", it is unpublished, which is a
// different decision.
//
// WHETHER A SIZE IS ON SHOPIFY IS NOT A SKU COMPARISON. The first version of
// this asked "is there a live Shopify variant with this SKU?" and reported 132
// gaps, of which 67 were wrong: those sizes ARE on Shopify, under a different
// spelling, with the alias recorded in `VariantChannelRef.externalSku` exactly
// as that column exists to do — LIV-M-NTL-CLST-X-L is LIV-INTL-CLST-OX-L in the
// shop. One garment, two names, which is a rename and not a gap.
//
// So the evidence is taken in order of authority:
//
//   1. a SHOPIFY link row pointing at a variant Shopify still has — decisive,
//      whatever either side calls it
//   2. the same SKU on a live variant
//   3. the recorded alias spelling
//   4. the same barcode on the SAME Shopify product
//
// Only a size with none of those is a size a customer cannot buy.
//
// This is NOT the barcode gap, though the same sizes keep appearing in both.
// Measured 2026-10-16 across the Livid merchandise on Shopify: 124 sizes missing
// from Shopify alone, 34 from Threadflow alone, and only 14 from both. Two
// independent gaps that happen to bite the same end of the size run — the
// extremes, W27/L32, W29/L34, W40/L34, 2XL, XS. Whatever adds a size to a run
// after the Shopify product exists is not carrying it to Shopify, and that is
// what `add-size.ts` is for.
//
// Archived Shopify variants do not count as present. A size whose only Shopify
// record is archived cannot be bought, which is the question being asked.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

async function main() {
  const csvPath = process.argv.find((a) => a.startsWith("--csv="))?.slice("--csv=".length);

  const { fetchShopifyVariants } = await import("../../src/lib/shopify/link.ts");
  const { normalizeSku } = await import("../../src/lib/master/sku.ts");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../../src/generated/prisma/client.ts");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
  });

  const { barcodeKey } = await import("../../src/lib/master/barcode.ts");
  const all = await fetchShopifyVariants();
  const live = all.filter((r) => !r.archived);
  const liveSku = new Set(live.map((r) => (r.sku ? normalizeSku(r.sku) : "")).filter(Boolean));
  const liveGid = new Set(live.map((r) => r.variantGid));
  const byBarcodeAndProduct = new Set(
    live.map((r) => `${barcodeKey(r.barcode) ?? ""}@${r.productGid ?? ""}`).filter((k) => !k.startsWith("@"))
  );
  const archivedSku = new Set(
    all.filter((r) => r.archived).map((r) => (r.sku ? normalizeSku(r.sku) : "")).filter(Boolean)
  );

  // What Loom actually holds, so "never made" can be asserted rather than
  // inferred from the master alone.
  const loomSkus = new Set<string>();
  const loomStock = new Map<string, number>();
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  if (token) {
    let cursor: string | null = null;
    do {
      const u = new URL("https://loom.livid.no/api/origio/v1/products");
      u.searchParams.set("limit", "200");
      if (cursor) u.searchParams.set("cursor", cursor);
      const res = await fetch(u, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      if (!res.ok) {
        console.log(`Loom read failed (HTTP ${res.status}) — the never-made column will be blank.`);
        break;
      }
      const j: any = await res.json();
      for (const r of j.rows ?? [])
        for (const v of r.variants ?? []) {
          loomSkus.add(v.variant_sku);
          loomStock.set(
            v.variant_sku,
            (v.stock ?? []).reduce((a: number, st: any) => a + (st.on_hand ?? 0), 0)
          );
        }
      cursor = j.nextCursor ?? null;
    } while (cursor);
  } else {
    console.log("No Loom token — the never-made column will be blank.");
  }

  const cws = await prisma.colorway.findMany({
    where: {
      brand: { isLivid: true },
      kind: "MERCHANDISE",
      publications: { some: { channel: "SHOPIFY", externalId: { not: null } } },
      // An archived colourway is not "missing sizes" — it is archived, and
      // adding sizes to it in Shopify is the write add-variant's own guard
      // refuses. And a merge tombstone (`--merged-into-…`) is a redirect, not a
      // product: its variants are the pre-merge spelling of rows that live
      // under the surviving colourway. Both polluted the first list.
      status: { not: "ARCHIVED" },
      NOT: { colorwaySku: { contains: "--merged" } },
    },
    select: {
      colorwaySku: true,
      name: true,
      status: true,
      entries: { select: { season: { select: { code: true } } } },
      publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
      variants: {
        select: {
          variantSku: true,
          sizeLabel: true,
          barcode: true,
          dim1: true,
          dim2: true,
          // Arnt's discriminator: a size in neither Sitoo nor Loom was never
          // made, so there is no stock and nothing to publish. Sitoo presence is
          // read from the link row; Loom is asked directly below.
          channelRefs: { select: { channel: true, externalId: true, externalSku: true } },
        },
        orderBy: { sizeLabel: "asc" },
      },
    },
    orderBy: { colorwaySku: "asc" },
  });
  await prisma.$disconnect();

  interface Row {
    colorwaySku: string;
    name: string;
    status: string;
    seasons: string;
    have: number;
    total: number;
    missing: {
      sku: string;
      size: string;
      dim1: string;
      dim2: string | null;
      barcode: string | null;
      archivedInShopify: boolean;
      sitoo: boolean;
      loom: boolean;
      loomStock: number;
    }[];
  }

  const rows: Row[] = [];
  let complete = 0;
  for (const c of cws) {
    const productGid = c.publications[0]?.externalId ?? null;
    const onShopify = (v: (typeof c.variants)[number]) => {
      const ref = v.channelRefs.find((r) => r.channel === "SHOPIFY");
      if (ref?.externalId && liveGid.has(ref.externalId)) return true;
      if (liveSku.has(normalizeSku(v.variantSku))) return true;
      if (ref?.externalSku && liveSku.has(normalizeSku(ref.externalSku))) return true;
      const bk = barcodeKey(v.barcode);
      if (bk && productGid && byBarcodeAndProduct.has(`${bk}@${productGid}`)) return true;
      return false;
    };
    const missing = c.variants
      .filter((v) => !onShopify(v))
      .map((v) => ({
        sku: v.variantSku,
        size: v.sizeLabel,
        dim1: v.dim1,
        dim2: v.dim2,
        barcode: v.barcode,
        archivedInShopify: archivedSku.has(normalizeSku(v.variantSku)),
        sitoo: v.channelRefs.some((r) => r.channel === "SITOO"),
        loom: loomSkus.has(v.variantSku),
        loomStock: loomStock.get(v.variantSku) ?? 0,
      }));
    if (!missing.length) {
      complete++;
      continue;
    }
    rows.push({
      colorwaySku: c.colorwaySku,
      name: c.name,
      status: c.status,
      seasons: c.entries.map((e) => e.season.code).join(","),
      have: c.variants.length - missing.length,
      total: c.variants.length,
      missing,
    });
  }

  const missingTotal = rows.reduce((a, r) => a + r.missing.length, 0);
  const noneAtAll = rows.filter((r) => r.have === 0);
  const partial = rows.filter((r) => r.have > 0);
  const activePartial = partial.filter((r) => r.status === "ACTIVE");
  const archivedThere = rows.flatMap((r) => r.missing).filter((m) => m.archivedInShopify).length;
  // What stops each one being added today. `shopify/add-variant.ts` refuses a
  // product with more than one option, and a 2-D size needs two (Waist, Length).
  const twoD = rows.flatMap((r) => r.missing).filter((m) => m.dim2).length;
  const oneD = rows.flatMap((r) => r.missing).filter((m) => !m.dim2).length;
  const withBarcode = rows.flatMap((r) => r.missing).filter((m) => m.barcode).length;

  console.log(`Livid merchandise colourways with a Shopify product: ${cws.length}`);
  console.log(`  every master size live in Shopify : ${complete}`);
  console.log(`  some sizes missing               : ${partial.length}`);
  console.log(`  NO master size live in Shopify    : ${noneAtAll.length}`);
  console.log(`\nMaster sizes with no live Shopify variant: ${missingTotal}`);
  console.log(`  of which archived in Shopify rather than absent: ${archivedThere}`);
  console.log(`  of which DO have a barcode here (so ready to add): ${withBarcode}`);
  console.log(
    `\nACTIVE colourways selling an incomplete run: ${activePartial.length}, ` +
      `${activePartial.reduce((a, r) => a + r.missing.length, 0)} size(s) a customer cannot buy`
  );
  const everMade = rows.flatMap((r) => r.missing);
  const neverMade = everMade.filter((m) => !m.sitoo && !m.loom).length;
  const stocked = everMade.filter((m) => m.loomStock > 0);
  console.log(`\nWas the size ever actually made?`);
  console.log(`  in neither Sitoo nor Loom -> never made, no stock: ${neverMade}`);
  console.log(`  carrying Loom stock right now:                    ${stocked.length} (${stocked.reduce((a, m) => a + m.loomStock, 0)} units)`);

  // Both shapes are addable since add-variant learned Waist × Length
  // (2026-10-16). Kept as a split because the two take different Shopify
  // mutations and a regression would show up on one shape and not the other.
  console.log(`\nShape (add-variant handles both):`);
  console.log(`  1-D, one size option : ${oneD}`);
  console.log(`  2-D, Waist x Length  : ${twoD}`);

  // Which sizes go missing, across the whole set. The answer is the extremes,
  // and seeing it as a ranking is what makes that obvious.
  const bySize = new Map<string, number>();
  for (const r of rows) for (const m of r.missing) bySize.set(m.size, (bySize.get(m.size) ?? 0) + 1);
  console.log(`\nMost frequently missing sizes:`);
  for (const [size, n] of [...bySize.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
    console.log(`   ${size.padEnd(12)} ${String(n).padStart(4)}`);

  console.log(`\nWorst incomplete runs:`);
  for (const r of partial.sort((a, b) => b.missing.length - a.missing.length).slice(0, 12))
    console.log(
      `   ${r.colorwaySku.padEnd(30)} ${r.status.padEnd(8)} ${r.have}/${r.total} live, missing: ` +
        r.missing.map((m) => m.size).slice(0, 6).join(", ") +
        (r.missing.length > 6 ? "…" : "")
    );

  if (noneAtAll.length) {
    console.log(
      `\nColourways Shopify has a product for but NOT one of the master's sizes — likely a SKU`
    );
    console.log(`spelling difference rather than a missing size (see VariantChannelRef.externalSku):`);
    for (const r of noneAtAll.slice(0, 10))
      console.log(`   ${r.colorwaySku.padEnd(30)} ${r.status.padEnd(8)} ${r.total} size(s), none matched`);
  }

  if (csvPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(csvPath), { recursive: true });
    const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const out = [
      "colorway_sku,name,status,seasons,sizes_live,sizes_total,variant_sku,size,dim1,dim2,barcode,in_sitoo,in_loom,loom_stock,ever_made,loom_will_carry,blocker",
      ...rows.flatMap((r) =>
        r.missing.map((m) =>
          [
            r.colorwaySku,
            r.name,
            r.status,
            r.seasons,
            r.have,
            r.total,
            m.sku,
            m.size,
            m.dim1,
            m.dim2 ?? "",
            m.barcode ?? "",
            m.sitoo ? "yes" : "no",
            m.loom ? "yes" : "no",
            m.loomStock,
            // Arnt's rule: absent from both means the variant was never
            // produced, so there is nothing to publish.
            !m.sitoo && !m.loom ? "NO — never made" : "yes",
            // Loom's registry drops a barcode-less Livid variant, so Shopify
            // would have the size and Loom would not.
            m.barcode ? "yes" : "no — no barcode",
            r.have === 0
              ? "none of this colourway's sizes matched in Shopify — check for a SKU alias first"
              : !m.sitoo && !m.loom
                ? "never made — nothing to publish"
                : "",
          ]
            .map(esc)
            .join(",")
        )
      ),
    ].join("\n");
    writeFileSync(csvPath, out);
    console.log(`\nWritten to ${csvPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
