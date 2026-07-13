import { listBrands, listManufacturers } from "@/lib/master/queries";
import { NewProductForm } from "@/components/catalog/new-product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [brands, manufacturers] = await Promise.all([
    listBrands(),
    listManufacturers(),
  ]);
  return <NewProductForm brands={brands} manufacturers={manufacturers} />;
}
