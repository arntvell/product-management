import Link from "next/link";
import { listStyles } from "@/lib/master/queries";

export const dynamic = "force-dynamic";

function tfImage(ref: string | null): string | null {
  return ref ? `/api/catalog/tf-image?ref=${encodeURIComponent(ref)}` : null;
}

export default async function StylesPage() {
  const styles = await listStyles();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/catalog"
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            ← Catalog
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Styles</h1>
        </div>
        <span className="text-sm text-muted-foreground tabular-nums">
          {styles.length} styles
        </span>
      </div>

      {styles.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No styles yet — run a Threadflow sync from the{" "}
          <Link href="/catalog" className="underline underline-offset-4">
            Catalog
          </Link>{" "}
          page.
        </p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-14 p-3"></th>
                <th className="p-3">Style</th>
                <th className="p-3">SKU</th>
                <th className="p-3">Gender</th>
                <th className="p-3">Category</th>
                <th className="p-3 text-right">Colorways</th>
              </tr>
            </thead>
            <tbody>
              {styles.map((s) => {
                const src = tfImage(s.thumbnailRef);
                return (
                  <tr
                    key={s.id}
                    className="border-b last:border-0 hover:bg-muted/30"
                  >
                    <td className="p-2">
                      <div className="h-11 w-11 overflow-hidden rounded bg-muted">
                        {src && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={src}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-medium">
                      <Link
                        href={`/catalog/styles/${s.id}`}
                        className="hover:underline"
                      >
                        {s.styleName}
                      </Link>
                    </td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">
                      {s.styleSku}
                    </td>
                    <td className="p-3 capitalize text-muted-foreground">
                      {s.gender ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">{s.category}</td>
                    <td className="p-3 text-right tabular-nums">
                      {s.colorwayCount}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
