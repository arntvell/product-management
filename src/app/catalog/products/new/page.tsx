import { listBrands, listManufacturers } from "@/lib/master/queries";
import { BrandProductBuilder } from "@/components/catalog/brand-product-builder";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
  const [brands, manufacturers] = await Promise.all([
    listBrands(),
    listManufacturers(),
  ]);
  return <BrandProductBuilder brands={brands} manufacturers={manufacturers} />;
}
