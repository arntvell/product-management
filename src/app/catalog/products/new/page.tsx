import { redirect } from "next/navigation";
import { createDraft } from "@/lib/master/drafts";

export const dynamic = "force-dynamic";

// Starting a product means starting a draft. There is no unsaved state to lose
// because there is no unsaved state — the row exists before the first keystroke.
export default async function NewProductPage() {
  const id = await createDraft();
  redirect(`/catalog/products/drafts/${id}`);
}
