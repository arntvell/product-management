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
    // Livid only. The resold brands and vintage live on /catalog/external, where
    // the seasonal machinery here — tabs, drops, carry-over, a price column that
    // waits for a season — is all answers to questions nobody asks about a
    // product that is bought in and sells until it runs out.
    listColorwaysForEdit(season, "livid"),
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
      title="Livid products"
    />
  );
}
