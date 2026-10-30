// Which live Shopify products show a Men or Women image in their gallery too.
//
//   npx dotenv -e .env.local -- npx tsx scripts/audit/gendered-images-in-gallery.ts
//   …--csv=snapshots/gendered-images-in-gallery.csv   to write every affected product
//
// READ-ONLY.
//
// An image tagged Men or Women belongs in custom.men_images / custom.women_images
// and nowhere else. Until 2026-10-30 a unisex product with no Flat image had its
// gendered shots pushed into the product gallery as well, so the product page
// showed every model shot twice. The push no longer does that, but a push never
// removes an image from a live product, so the ones already there stay until
// someone takes them out.
//
// A Shopify MediaImage is the same object in the gallery and in a file-reference
// metafield, so an image in both has the same GID in both lists. That
// intersection is what this reports: per product, which gallery images are also
// in men_images or women_images. Nothing else is judged — a gallery image in no
// metafield is left alone.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const QUERY = `
  query GalleryVsGender($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        handle
        status
        media(first: 100) { nodes { id } }
        men: metafield(namespace: "custom", key: "men_images") { value }
        women: metafield(namespace: "custom", key: "women_images") { value }
      }
    }
  }
`;

interface Node {
  id: string;
  handle: string;
  status: string;
  media: { nodes: { id: string }[] };
  men: { value: string } | null;
  women: { value: string } | null;
}

function gids(m: { value: string } | null): string[] {
  if (!m) return [];
  try {
    const v = JSON.parse(m.value);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function main() {
  const csvPath = process.argv.find((a) => a.startsWith("--csv="))?.slice("--csv=".length);

  const { shopifyGraphQL } = await import("../../src/lib/shopify/client.ts");
  const { isVintageBrand } = await import("../../src/lib/master/vintage.ts");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("../../src/generated/prisma/client.ts");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
  });

  // Every product Origo has on Shopify, vintage aside: a vintage garment has
  // no gendered images.
  const pubs = await prisma.channelPublication.findMany({
    where: { channel: "SHOPIFY", externalId: { not: null } },
    select: {
      externalId: true,
      colorway: {
        select: {
          colorwaySku: true,
          name: true,
          brand: { select: { name: true } },
          style: { select: { styleName: true, unisex: true } },
        },
      },
    },
  });
  await prisma.$disconnect();
  const targets = pubs.filter((p) => !isVintageBrand(p.colorway.brand?.name));
  const byGid = new Map(targets.map((p) => [p.externalId!, p.colorway]));
  const ids = [...byGid.keys()];

  const rows: Array<{
    sku: string;
    name: string;
    brand: string;
    unisex: boolean;
    status: string;
    handle: string;
    gallery: number;
    inMen: number;
    inWomen: number;
    adminId: string;
  }> = [];
  let read = 0;
  let withGender = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const d = await shopifyGraphQL<{ nodes: (Node | null)[] }>(QUERY, { ids: batch });
    for (const n of d.nodes) {
      if (!n?.id) continue;
      read++;
      const men = new Set(gids(n.men));
      const women = new Set(gids(n.women));
      if (men.size || women.size) withGender++;
      const gallery = n.media.nodes.map((m) => m.id);
      const inMen = gallery.filter((g) => men.has(g)).length;
      const inWomen = gallery.filter((g) => women.has(g)).length;
      if (!inMen && !inWomen) continue;
      const cw = byGid.get(n.id)!;
      rows.push({
        sku: cw.colorwaySku,
        // Most colourway names already lead with the style's.
        name: cw.name.startsWith(cw.style.styleName) ? cw.name : `${cw.style.styleName} ${cw.name}`,
        brand: cw.brand?.name ?? "",
        unisex: cw.style.unisex,
        status: n.status,
        handle: n.handle,
        gallery: gallery.length,
        inMen,
        inWomen,
        adminId: n.id.split("/").pop()!,
      });
    }
    process.stdout.write(`\r  read ${Math.min(i + 50, ids.length)} of ${ids.length}`);
  }
  process.stdout.write("\n");

  rows.sort((a, b) => a.status.localeCompare(b.status) || a.sku.localeCompare(b.sku));
  const images = rows.reduce((n, r) => n + r.inMen + r.inWomen, 0);
  console.log(`\nShopify products read: ${read} (non-vintage, linked in Origo)`);
  console.log(`  with Men or Women images:            ${withGender}`);
  console.log(`  showing some of them in the gallery: ${rows.length} (${images} images)`);
  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  console.log(`  by status: ${[...byStatus].map(([s, n]) => `${s} ${n}`).join(", ") || "—"}`);
  console.log(`  unisex styles: ${rows.filter((r) => r.unisex).length} of ${rows.length}`);

  console.log(`\nFirst 15:`);
  for (const r of rows.slice(0, 15))
    console.log(
      `  ${r.sku.padEnd(26)} ${r.status.padEnd(8)} gallery ${String(r.gallery).padStart(2)} · men ${r.inMen} · women ${r.inWomen}  ${r.name}`
    );

  if (csvPath) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(csvPath), { recursive: true });
    const esc = (s: string | number | boolean) => `"${String(s).replace(/"/g, '""')}"`;
    const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const out = [
      "colorway_sku,name,brand,unisex,shopify_status,gallery_images,men_in_gallery,women_in_gallery,shopify_admin",
      ...rows.map((r) =>
        [r.sku, r.name, r.brand, r.unisex, r.status, r.gallery, r.inMen, r.inWomen, `https://${store}/admin/products/${r.adminId}`]
          .map(esc)
          .join(",")
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
