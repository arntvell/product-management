import {
  listColorwaysForEdit,
  listSeasons,
  listColorwayOptions,
} from "@/lib/master/queries";
import { CatalogGrid } from "@/components/catalog/catalog-grid";

export const dynamic = "force-dynamic";

export default async function CatalogEditPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const [rows, seasons, colorwayOptions] = await Promise.all([
    listColorwaysForEdit(season),
    listSeasons(),
    listColorwayOptions(),
  ]);
  const seasonId = season ? seasons.find((s) => s.code === season)?.id : undefined;
  return (
    <CatalogGrid
      initialRows={rows}
      seasons={seasons}
      season={season}
      seasonId={seasonId}
      colorwayOptions={colorwayOptions}
    />
  );
}
