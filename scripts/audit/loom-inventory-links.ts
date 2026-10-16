// Which active Loom products cannot sync Shopify stock, and why.
//
//   npx dotenv -e .env.local -- npx tsx scripts/audit/loom-inventory-links.ts
//   …--csv=snapshots/loom-inventory-links.csv   to write the actionable rows
//
// READ-ONLY.
//
// Loom's stock registry joins Shopify movements on the **InventoryItem** id, not
// the ProductVariant: the variant is the listing, the inventory item is what a
// movement references (`payload.ts`, `shopify_inventory_item_id`). A variant
// Loom holds with that field null has no Shopify line in its stock rows, so
// Shopify stock cannot reach it. Null is not automatically a fault — plenty of
// products are not meant to be on Shopify at all — so this classifies rather
// than counts.
//
// The buckets, in the order a person would act on them:
//
//   LINKABLE          the master has no Shopify ref, but a LIVE Shopify variant
//                     matches on SKU or barcode. Running the linker fixes it.
//                     This is the Pantherella Tabitha Winter White case.
//   BARCODE_GAP       the master has the inventory id, Loom does not, and a push
//                     will never carry it: `buildRegistryColorway` drops a
//                     barcode-less variant of a LIVID colourway from the registry
//                     payload, because the registry falls back to barcode where
//                     there is no inventory link and a blank would have every
//                     such variant sharing one key. So the id cannot travel until
//                     the size has a barcode. Found the hard way — 15 Livid sizes
//                     survived a push that reported `variantsUpdated` for all of
//                     them and still read null in Loom afterwards.
//   STALE_IN_LOOM     the master HAS the inventory id and Loom does not, and the
//                     variant IS in the payload. A Loom push carries it.
//   NEEDS_BACKFILL    the master has a Shopify variant ref but no inventory id
//                     on it. The linker backfills these.
//   SHOPIFY_ARCHIVED  the only Shopify variant matching is on an archived
//                     product. The linker refuses these ON PURPOSE — linking to
//                     one points the master at a record that cannot receive
//                     stock. Whether the product should be live in Shopify is a
//                     per-product decision, not a sweep.
//   NOT_IN_SHOPIFY    no Shopify variant at all, live or archived. It was never
//                     created there.
//   BY_POLICY         not supposed to be on Shopify. `product-kind.ts` is
//                     explicit: store vintage is Sitoo-only, VN-ONLN is
//                     Shopify-only. Non-merchandise kinds are out of channel
//                     pushes altogether.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

type Bucket =
  | "LINKABLE"
  | "BARCODE_GAP"
  | "STALE_IN_LOOM"
  | "NEEDS_BACKFILL"
  | "SHOPIFY_ARCHIVED"
  | "NOT_IN_SHOPIFY"
  | "BY_POLICY";

/** Store vintage: one SKU rings up any garment of that kind. Sitoo-only. */
const STORE_VINTAGE = /^EXT-VN-NW-|^EXT-VN-[A-Z0-9]+$|^VIN-/;

async function main() {
  const csvPath = process.argv.find((a) => a.startsWith("--csv="))?.slice("--csv=".length);

  const { fetchShopifyVariants } = await import("../../src/lib/shopify/link.ts");
  const { normalizeSku } = await import("../../src/lib/master/sku.ts");
  const { barcodeKey } = await import("../../src/lib/master/barcode.ts");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../../src/generated/prisma/client.ts");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
  });

  // --- what Loom holds -------------------------------------------------------
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  const H = { authorization: `Bearer ${token}`, accept: "application/json" };
  let cursor: string | null = null;
  const loomRows: any[] = [];
  do {
    const u = new URL("https://loom.livid.no/api/origio/v1/products");
    u.searchParams.set("limit", "200");
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u, { headers: H });
    if (!res.ok) throw new Error(`Loom answered HTTP ${res.status}`);
    const j: any = await res.json();
    loomRows.push(...(j.rows ?? []));
    cursor = j.nextCursor ?? null;
  } while (cursor);

  // Active only. An archived Loom product is not expected to move stock.
  const active = loomRows.filter((r) => !r.archived);

  // --- what Shopify holds ----------------------------------------------------
  const shop = await fetchShopifyVariants();
  const liveSku = new Set<string>();
  const liveBc = new Set<string>();
  const archSku = new Set<string>();
  const archBc = new Set<string>();
  for (const r of shop) {
    const s = r.sku ? normalizeSku(r.sku) : null;
    const b = barcodeKey(r.barcode);
    if (r.archived) {
      if (s) archSku.add(s);
      if (b) archBc.add(b);
    } else {
      if (s) liveSku.add(s);
      if (b) liveBc.add(b);
    }
  }

  // --- what the master holds -------------------------------------------------
  const variants = await prisma.variant.findMany({
    select: {
      variantSku: true,
      barcode: true,
      colorway: {
        select: {
          colorwaySku: true,
          name: true,
          kind: true,
          status: true,
          brand: { select: { name: true, isLivid: true } },
        },
      },
      channelRefs: {
        where: { channel: "SHOPIFY" },
        select: { externalId: true, externalInventoryId: true },
      },
    },
  });
  const master = new Map(variants.map((v) => [v.variantSku, v]));
  await prisma.$disconnect();

  // --- classify ---------------------------------------------------------------
  const counts = new Map<Bucket, number>();
  const byBrand = new Map<string, Map<Bucket, number>>();
  const rows: Array<{ bucket: Bucket; sku: string; parent: string; name: string; brand: string; note: string }> = [];

  let activeVariants = 0;
  let withInventoryId = 0;

  for (const p of active) {
    for (const v of p.variants ?? []) {
      activeVariants++;
      if (v.shopify_inventory_item_id) {
        withInventoryId++;
        continue;
      }
      const m = master.get(v.variant_sku);
      const cwSku = m?.colorway.colorwaySku ?? p.colorway_sku;
      const brand = m?.colorway.brand?.name ?? p.brand ?? "—";
      const ref = m?.channelRefs[0];

      let bucket: Bucket;
      let note = "";

      if (m && (m.colorway.kind !== "MERCHANDISE" || STORE_VINTAGE.test(cwSku))) {
        bucket = "BY_POLICY";
        note = m.colorway.kind !== "MERCHANDISE" ? `kind ${m.colorway.kind}` : "store vintage — Sitoo only";
      } else if (ref?.externalInventoryId) {
        // The registry payload's own filter decides whether a push can carry it.
        const droppedFromPayload =
          !!m &&
          !m.barcode?.trim() &&
          m.colorway.kind !== "CONSUMABLE" &&
          m.colorway.kind !== "MATERIAL" &&
          m.colorway.brand?.isLivid === true;
        if (droppedFromPayload) {
          bucket = "BARCODE_GAP";
          note = "no barcode — the registry payload drops it, so no push can carry the id";
        } else {
          bucket = "STALE_IN_LOOM";
          note = "master holds it; a Loom push carries it";
        }
      } else if (ref?.externalId) {
        bucket = "NEEDS_BACKFILL";
        note = "variant linked, inventory id missing";
      } else {
        const s = m ? normalizeSku(m.variantSku) : normalizeSku(v.variant_sku);
        const b = barcodeKey(m?.barcode ?? v.barcode);
        if (liveSku.has(s) || (b && liveBc.has(b))) {
          bucket = "LINKABLE";
          note = liveSku.has(s) ? "live Shopify variant, same SKU" : "live Shopify variant, same barcode";
        } else if (archSku.has(s) || (b && archBc.has(b))) {
          bucket = "SHOPIFY_ARCHIVED";
          note = "only an archived Shopify variant matches";
        } else {
          bucket = "NOT_IN_SHOPIFY";
          note = "no Shopify variant, live or archived";
        }
      }

      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      const b = byBrand.get(brand) ?? new Map<Bucket, number>();
      b.set(bucket, (b.get(bucket) ?? 0) + 1);
      byBrand.set(brand, b);
      rows.push({ bucket, sku: v.variant_sku, parent: cwSku, name: m?.colorway.name ?? p.name, brand, note });
    }
  }

  // --- report -----------------------------------------------------------------
  const ORDER: Bucket[] = [
    "LINKABLE",
    "STALE_IN_LOOM",
    "BARCODE_GAP",
    "NEEDS_BACKFILL",
    "SHOPIFY_ARCHIVED",
    "NOT_IN_SHOPIFY",
    "BY_POLICY",
  ];
  const missing = activeVariants - withInventoryId;
  console.log(`Active Loom products : ${active.length} (of ${loomRows.length} total)`);
  console.log(`Their variants       : ${activeVariants}`);
  console.log(`  with an inventory id: ${withInventoryId}`);
  console.log(`  WITHOUT one         : ${missing}\n`);

  // BARCODE_GAP is deliberately not "fixable now": it needs a barcode allocated
  // first, which is a decision about Livid's own labelling, not a sweep.
  const ACTIONABLE: Bucket[] = ["LINKABLE", "STALE_IN_LOOM", "NEEDS_BACKFILL"];
  for (const b of ORDER) {
    const n = counts.get(b) ?? 0;
    if (!n) continue;
    console.log(`${b.padEnd(17)} ${String(n).padStart(5)}${ACTIONABLE.includes(b) ? "   <- fixable now" : ""}`);
  }

  const fixable = ACTIONABLE.reduce((a, b) => a + (counts.get(b) ?? 0), 0);
  console.log(`\nFixable without a decision: ${fixable}`);

  // Per brand, only where something is fixable — the rest is noise on a sweep
  // this wide.
  console.log(`\nBy brand (fixable only):`);
  const brandRows = [...byBrand.entries()]
    .map(([brand, m]) => ({ brand, n: ACTIONABLE.reduce((a, b) => a + (m.get(b) ?? 0), 0), m }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  for (const r of brandRows.slice(0, 20)) {
    const detail = ACTIONABLE.filter((b) => r.m.get(b)).map((b) => `${b.toLowerCase()} ${r.m.get(b)}`).join(", ");
    console.log(`  ${r.brand.padEnd(22)} ${String(r.n).padStart(4)}   (${detail})`);
  }

  // The big buckets are not actionable, but "5,672 not in Shopify" means nothing
  // without knowing whether that is vintage (largely expected) or live externals
  // (a real gap).
  console.log(`\nThe large buckets, by brand:`);
  for (const b of ["BARCODE_GAP", "SHOPIFY_ARCHIVED", "NOT_IN_SHOPIFY", "BY_POLICY"] as Bucket[]) {
    const top = [...byBrand.entries()]
      .map(([brand, m]) => ({ brand, n: m.get(b) ?? 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b2) => b2.n - a.n)
      .slice(0, 6);
    if (!top.length) continue;
    console.log(`  ${b}: ${top.map((t) => `${t.brand} ${t.n}`).join(", ")}`);
  }

  console.log(`\nFirst few of each fixable bucket:`);
  for (const b of ACTIONABLE) {
    const sample = rows.filter((r) => r.bucket === b).slice(0, 5);
    if (!sample.length) continue;
    console.log(`  ${b}:`);
    for (const s of sample) console.log(`    ${s.sku.padEnd(28)} ${s.brand.padEnd(16)} ${s.note}`);
  }

  if (csvPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(csvPath), { recursive: true });
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const out = [
      "bucket,variant_sku,colorway_sku,name,brand,note",
      ...rows
        .filter((r) => ACTIONABLE.includes(r.bucket))
        .map((r) => [r.bucket, r.sku, r.parent, r.name, r.brand, r.note].map(esc).join(",")),
    ].join("\n");
    writeFileSync(csvPath, out);
    console.log(`\nActionable rows written to ${csvPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
