// Livid sizes the master holds that Shopify does not sell.
//
//   npx dotenv -e .env.local -- npx tsx scripts/audit/livid-shopify-size-gap.ts
//   …--csv=snapshots/livid-shopify-size-gap.csv
//
// READ-ONLY.
//
// Only colourways Shopify already has a product for are asked about: a colourway
// not published there is not "missing sizes", it is unpublished, which is a
// different decision. Within those, a master size with no live Shopify variant
// of the same SKU is a size a customer cannot buy, however much stock sits
// behind it.
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

  const all = await fetchShopifyVariants();
  const live = all.filter((r) => !r.archived);
  const liveSku = new Set(live.map((r) => (r.sku ? normalizeSku(r.sku) : "")).filter(Boolean));
  const archivedSku = new Set(
    all.filter((r) => r.archived).map((r) => (r.sku ? normalizeSku(r.sku) : "")).filter(Boolean)
  );

  const cws = await prisma.colorway.findMany({
    where: {
      brand: { isLivid: true },
      kind: "MERCHANDISE",
      publications: { some: { channel: "SHOPIFY", externalId: { not: null } } },
    },
    select: {
      colorwaySku: true,
      name: true,
      status: true,
      entries: { select: { season: { select: { code: true } } } },
      variants: {
        select: { variantSku: true, sizeLabel: true, barcode: true },
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
    missing: { sku: string; size: string; barcode: string | null; archivedInShopify: boolean }[];
  }

  const rows: Row[] = [];
  let complete = 0;
  for (const c of cws) {
    const missing = c.variants
      .filter((v) => !liveSku.has(normalizeSku(v.variantSku)))
      .map((v) => ({
        sku: v.variantSku,
        size: v.sizeLabel,
        barcode: v.barcode,
        archivedInShopify: archivedSku.has(normalizeSku(v.variantSku)),
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
      "colorway_sku,name,status,seasons,variant_sku,size,barcode,archived_in_shopify",
      ...rows.flatMap((r) =>
        r.missing.map((m) =>
          [r.colorwaySku, r.name, r.status, r.seasons, m.sku, m.size, m.barcode, m.archivedInShopify]
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
