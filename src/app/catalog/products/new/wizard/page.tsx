import { redirect } from "next/navigation";
import { createDraft } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// Starting a product by hand means starting a draft. There is no unsaved state
// to lose because there is no unsaved state — the row exists before the first
// keystroke. This used to be /catalog/products/new itself; that path is now the
// choice between typing one product and importing a file.
export default async function NewProductWizardPage() {
  const id = await createDraft();
  redirect(`/catalog/products/drafts/${id}`);
}
