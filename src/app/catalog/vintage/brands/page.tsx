import { PageHeader, Page } from "@/components/ui/page-header";
import { VintageBrandsManager } from "@/components/catalog/vintage-brands-manager";

export const dynamic = "force-dynamic";

export default function VintageBrandsPage() {
  return (
    <>
      <PageHeader eyebrow="Catalogue" title="Vintage brands" />
      <Page>
        <p className="max-w-3xl text-body text-muted-foreground">
          The makers the drop sheet offers in its Brand field. Each garment&rsquo;s brand also
          becomes a Shopify tag, which the storefront&rsquo;s brand filter reads, so one spelling
          per brand matters. Archive a misspelling rather than deleting it: garments already
          tagged with it keep their tag.
        </p>
        <VintageBrandsManager />
      </Page>
    </>
  );
}
