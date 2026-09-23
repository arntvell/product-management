import Link from "next/link";
import { prisma } from "@/lib/db";
import { AddSizeFlow } from "@/components/catalog/add-size-flow";

export const dynamic = "force-dynamic";

export default async function AddSizePage({
  searchParams,
}: {
  searchParams: Promise<{ colorwayId?: string }>;
}) {
  const { colorwayId } = await searchParams;
  const [brands, categories] = await Promise.all([
    prisma.brand.findMany({
      where: { isLivid: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.category.findMany({
      where: { archived: false },
      orderBy: [{ path: "asc" }],
      select: { id: true, name: true, depth: true },
    }),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/catalog/products/new"
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        ← New product
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Add a size</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A new size on a product that already exists — from its size system, with a SKU that
        follows its siblings, pushed to Shopify, Sitoo and Loom wherever the product already is.
      </p>
      <AddSizeFlow brands={brands} categories={categories} initialColorwayId={colorwayId ?? null} />
    </main>
  );
}
