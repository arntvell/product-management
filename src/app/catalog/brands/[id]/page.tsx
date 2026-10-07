import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrandSettings } from "@/lib/master/brands";
import { listManufacturers } from "@/lib/master/queries";
import { listSizeSystems } from "@/lib/master/size-systems";
import { BrandSettingsForm } from "@/components/catalog/brand-settings-form";
import { BrandSitooLink } from "@/components/catalog/brand-sitoo-link";
import { getBrandSitooState } from "@/lib/master/brand-create";

export const dynamic = "force-dynamic";

export default async function BrandSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [settings, manufacturers, sizeSystems, sitoo] = await Promise.all([
    getBrandSettings(id),
    listManufacturers(),
    listSizeSystems(),
    getBrandSitooState(id),
  ]);
  if (!settings) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-page">{settings.name}</h1>
          <p className="mt-1 text-body text-muted-foreground">
            Brand settings. Everything here is a default a new product starts from — each
            one can still be changed per product.
          </p>
        </div>
        <Link
          href="/catalog/brands"
          className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          All brands
        </Link>
      </div>
      <div className="space-y-8">
        <BrandSettingsForm
          initial={settings}
          manufacturers={manufacturers}
          sizeSystems={sizeSystems.map((s) => ({ id: s.id, name: s.name }))}
        />
        {!settings.isLivid ? (
          <BrandSitooLink brandId={settings.id} brandName={settings.name} initial={sitoo} />
        ) : null}
      </div>
    </main>
  );
}
