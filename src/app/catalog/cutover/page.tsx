import Link from "next/link";
import { getCutoverStatus } from "@/lib/master/cutover-status";
import { CutoverPanel } from "@/components/catalog/cutover-panel";

export const dynamic = "force-dynamic";

export default async function CutoverPage() {
  const status = await getCutoverStatus();

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Cutover</h1>
          <span className="rounded-full border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            Origio as master
          </span>
        </div>
        <Link
          href="/catalog"
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          Catalog
        </Link>
      </div>

      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Making Sitoo, Shopify and Loom receive identity from Origio instead of
        holding their own. Full sequence in{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">docs/cutover-runbook.md</code>.
      </p>

      {status.migrationError ? (
        <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <div className="font-medium text-destructive">Migrations not applied</div>
          <p className="mt-1 text-sm text-muted-foreground">
            The Prisma client is generated against a schema the database does not
            have yet, so this page cannot read its own state. Run migrations 1–4
            first — step 0 of the runbook.
          </p>
          <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">
            {status.migrationError}
          </pre>
        </div>
      ) : (
        <>
          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              State
            </h2>
            <div className="mt-3 space-y-2">
              {status.steps.map((s) => (
                <div key={s.key} className="rounded-lg border p-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`mt-1 size-2 shrink-0 rounded-full ${
                        s.done ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{s.label}</div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{s.detail}</p>
                      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                        {s.stats.map((st) => (
                          <div key={st.label} className="flex items-baseline gap-1.5">
                            <dd className="text-sm font-medium tabular-nums">{st.value}</dd>
                            <dt className="text-xs text-muted-foreground">{st.label}</dt>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Actions
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Apply stays disabled until a preview has run. Every one of these
              writes to a live system.
            </p>
            <div className="mt-3">
              <CutoverPanel />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
