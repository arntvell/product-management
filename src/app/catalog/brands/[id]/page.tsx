import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandSettings } from "@/lib/master/brands";
import { listManufacturers } from "@/lib/master/queries";
import { listSizeSystems } from "@/lib/master/size-systems";
import { BrandSettingsForm } from "@/components/catalog/brand-settings-form";

export const dynamic = "force-dynamic";

export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [settings, manufacturers, sizeSystems] = await Promise.all([
    getBrandSettings(id),
    listManufacturers(),
    listSizeSystems(),
  ]);
  if (!settings) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{settings.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Brand settings. Everything here is a default a new product starts from — each
            one can still be changed per product.
          </p>
        </div>
        <Link
          href="/catalog/brands"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          All brands
        </Link>
      </div>
      <BrandSettingsForm
        initial={settings}
        manufacturers={manufacturers}
        sizeSystems={sizeSystems.map((s) => ({ id: s.id, name: s.name }))}
      />
    </main>
  );
}
