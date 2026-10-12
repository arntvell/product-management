import { PageHeader } from "@/components/ui/page-header";
import { CollectionsEditor } from "@/components/collections/collections-editor";

export const dynamic = "force-dynamic";

export default function LiveCollectionsPage() {
  return (
    <>
      <PageHeader eyebrow="Shopify · live store" title="Collections">
        <p className="max-w-3xl text-body text-muted-foreground">
          Every collection on the store, with its fields and metafields as columns. Changes wait
          until you review and save them, then go straight to the live store. Metafield columns are
          the store&rsquo;s own collection metafield definitions, so one added in Shopify appears
          here. Rules and publishing are shown, and edited in Shopify.
        </p>
      </PageHeader>
      <div className="mt-4">
        <CollectionsEditor />
      </div>
    </>
  );
}
