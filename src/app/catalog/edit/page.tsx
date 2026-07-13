import { listColorwaysForEdit, listSeasons } from "@/lib/master/queries";
import { CatalogGrid } from "@/components/catalog/catalog-grid";

export const dynamic = "force-dynamic";

export default async function CatalogEditPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const [rows, seasons] = await Promise.all([
    listColorwaysForEdit(season),
    listSeasons(),
  ]);
  return <CatalogGrid initialRows={rows} seasons={seasons} season={season} />;
}
