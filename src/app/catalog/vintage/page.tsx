import Link from "next/link";
import { prisma } from "@/lib/db";
import { VintageDropSheet } from "@/components/catalog/vintage-drop-sheet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The brand list, taken from what vintage has actually been tagged with.
 *
 * Not a table to maintain: every vintage garment's Origio brand is "Vintage",
 * and the maker — Carhartt, Levi's, "Other / Unbranded" — travels as a Shopify
 * tag. Reading the distinct tags back makes the list self-maintaining and, more
 * usefully, makes it a spelling authority: the catalogue currently holds both
 * "Looney Tunes" and "Loony Toons" because nothing ever offered the first one
 * back.
 */
async function brandList(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tag: string; n: bigint }[]>(
    `select t as tag, count(*) as n
       from "Colorway" c, unnest(c.tags) as t
      where c."colorwaySku" like 'VN-ONLN-%'
        and t !~ '^DROP' and t not in ('rocket-hide','hide','Vintage')
      group by 1 having count(*) > 1
      order by count(*) desc`
  );
  return rows.map((r) => r.tag);
}

/**
 * The store products an online garment can be written up against.
 *
 * This is the economics: the shop sells categories, online sells unique
 * pieces, and a piece inherits what its category retails and costs.
 */
async function sourceProductList() {
  const rows = await prisma.vintageSourceProduct.findMany({
    where: { archived: false },
    orderBy: { name: "asc" },
    select: { name: true, sku: true, category: true, webCategory: true, retailNok: true, costNok: true },
  });
  return rows.map((r) => ({
    name: r.name,
    sku: r.sku,
    category: r.category,
    webCategory: r.webCategory,
    retail: r.retailNok?.toString() ?? null,
    // An average across a category's buying — 210.2492 implies a precision a
    // single second-hand garment's cost does not have.
    cost: r.costNok == null ? null : String(Math.round(Number(r.costNok))),
  }));
}

/** The categories the master already models, which is where vintage's live. */
async function categoryList() {
  const rows = await prisma.category.findMany({
    where: { active: true, archived: false, mergedIntoId: null },
    orderBy: { name: "asc" },
    select: { name: true, shopifyProductType: true },
  });
  return rows.map((c) => ({ name: c.name, webCategory: c.shopifyProductType }));
}

export default async function VintageDropPage() {
  const [brands, categories, sourceProducts] = await Promise.all([
    brandList(),
    categoryList(),
    sourceProductList(),
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <Link
          href="/catalog"
          className="text-xs text-muted-foreground underline underline-offset-4"
        >
          ← Catalog
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Vintage drop</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pick the drop and how many garments are in it. Item numbers, SKUs, handles and
          barcodes follow from that — none is typed, and the barcodes are the ones already
          assigned to those numbers, so they match the printed labels. Write the garments up,
          load the photographs whenever the shoot has uploaded them, then send the stock to
          Loom, push to Shopify and move the drop to the top of the collection. Choosing the
          store product a garment came out of fills its price and cost from what that
          category sells at — both as defaults, since about a third get priced up.
        </p>
      </div>

      <VintageDropSheet
        brands={brands}
        categories={categories}
        sourceProducts={sourceProducts}
      />
    </main>
  );
}
