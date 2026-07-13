import Link from "next/link";
import { listColorwaysForPublishing, listSeasons } from "@/lib/master/queries";
import { PublishingTable } from "@/components/catalog/publishing-table";

export const dynamic = "force-dynamic";

export default async function PublishingPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const { season } = await searchParams;
  const [rows, seasons] = await Promise.all([
    listColorwaysForPublishing(season),
    listSeasons(),
  ]);

  const filters = [
    { code: undefined as string | undefined, label: "All seasons" },
    ...seasons.map((s) => ({ code: s.code as string | undefined, label: s.code })),
  ];

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/catalog" className="text-xs text-muted-foreground underline underline-offset-4">
        ← Catalog
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">Publishing</h1>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {filters.map((f) => {
          const active = season === f.code || (!season && f.code === undefined);
          return (
            <Link
              key={f.label}
              href={f.code ? `/catalog/publishing?season=${f.code}` : "/catalog/publishing"}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <PublishingTable rows={rows} />
    </div>
  );
}
