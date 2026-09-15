"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  BrandIdentityRow,
  UnlinkedBrandRef,
  BrandDuplicate,
} from "@/lib/master/brands";

export function BrandIdentityManager({
  brands,
  unlinked,
  duplicates,
}: {
  brands: BrandIdentityRow[];
  unlinked: UnlinkedBrandRef[];
  duplicates: BrandDuplicate[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);

  /**
   * Confirm every row whose name matches exactly one brand.
   *
   * The queue was 137 rows, 108 of them the same name spelled the same way. A
   * one-click-per-row review of a 79% clerical queue is a review nobody does —
   * and until it is done, no brand knows its Sitoo manufacturer id, so a create
   * would make a second one. Anything ambiguous is left alone.
   */
  async function linkExact() {
    setBusy(true);
    try {
      const { result } = await post("/api/catalog/brands/refs", { action: "link-exact" });
      toast.success(
        `Linked ${result.linked}. ${result.unmatched.length} need a decision` +
          (result.ambiguous.length ? `, ${result.ambiguous.length} ambiguous` : "")
      );
      start(() => router.refresh());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk link failed");
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed");
    return json;
  }

  const certain = duplicates.filter((d) => d.confidence === "certain");
  const likely = duplicates.filter((d) => d.confidence === "likely");

  return (
    <div className="space-y-8">
      {duplicates.length ? (
        <section>
          <h2 className="text-sm font-semibold">
            Possible duplicates ({certain.length} certain, {likely.length} likely)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Merging is a tombstone, not a delete — the loser keeps its row and points at the
            survivor, so the decision stays explainable. Pick which one survives.
          </p>
          <div className="mt-3 space-y-2">
            {duplicates.map((d, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm"
              >
                <span
                  className={
                    "rounded-full border px-2 py-0.5 text-[10px] " +
                    (d.confidence === "certain"
                      ? "border-destructive text-destructive"
                      : "text-muted-foreground")
                  }
                >
                  {d.confidence}
                </span>
                <span className="text-muted-foreground">{d.reason}</span>
                <div className="ml-auto flex items-center gap-2">
                  {[d.a, d.b].map((side, idx) => {
                    const other = idx === 0 ? d.b : d.a;
                    return (
                      <Button
                        key={side.id}
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() =>
                          start(async () => {
                            if (
                              !confirm(
                                `Merge "${other.name}" (${other.colorways} colorways) into "${side.name}"? The loser is archived, not deleted.`
                              )
                            )
                              return;
                            try {
                              const r = await post("/api/catalog/brands/merge", {
                                loserId: other.id,
                                winnerId: side.id,
                              });
                              toast.success(
                                `Merged: ${r.result.styles} styles and ${r.result.colorways} colorways moved to ${side.name}.`
                              );
                              router.refresh();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed");
                            }
                          })
                        }
                      >
                        keep “{side.name}” ({side.colorways})
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">
            Channel spellings waiting to be linked ({unlinked.length})
          </h2>
          {unlinked.some((r) => r.suggestions.some((x) => x.confidence === "certain")) ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void linkExact()}>
              {busy ? "Linking…" : "Link all exact matches"}
            </Button>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Sitoo&apos;s manufacturers carry real ids. Shopify&apos;s vendor is a free string
          with no id at all, so the spelling is the only thing to join on. A Sitoo row may
          be a factory rather than a brand — say so rather than linking it.
        </p>
        <div className="mt-3 overflow-hidden rounded-md border">
          {(showAll ? unlinked : unlinked.slice(0, 30)).map((r) => (
            <div
              key={r.id}
              className="grid grid-cols-[5rem_1fr_4rem_minmax(14rem,1fr)_5rem] items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
            >
              <span className="rounded-full border px-2 py-0.5 text-center text-[10px] text-muted-foreground">
                {r.system}
              </span>
              <div className="min-w-0">
                <div className="truncate">{r.externalName}</div>
                {r.externalId ? (
                  <code className="text-[11px] text-muted-foreground">id {r.externalId}</code>
                ) : (
                  <span className="text-[11px] text-muted-foreground">no id in this system</span>
                )}
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                {r.productCount || "—"}
              </div>
              <select
                className="h-8 rounded-md border bg-transparent px-2 text-xs"
                defaultValue=""
                onChange={(e) => {
                  const brandId = e.target.value;
                  if (!brandId) return;
                  start(async () => {
                    try {
                      await post("/api/catalog/brands/refs", { refId: r.id, brandId });
                      toast.success(`${r.externalName} linked`);
                      router.refresh();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed");
                    }
                  });
                }}
              >
                <option value="">
                  {r.suggestions.length
                    ? `link to… (${r.suggestions[0].name}?)`
                    : "link to…"}
                </option>
                {r.suggestions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — {s.confidence}
                  </option>
                ))}
                <option disabled>──────────</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="text-xs underline underline-offset-2 text-muted-foreground"
                onClick={() =>
                  start(async () => {
                    try {
                      await post("/api/catalog/brands/refs", { refId: r.id, role: "IGNORE" });
                      toast.success("Ignored");
                      router.refresh();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Failed");
                    }
                  })
                }
              >
                not a brand
              </button>
            </div>
          ))}
          {!showAll && unlinked.length > 30 ? (
            <button
              type="button"
              className="w-full px-3 py-2 text-xs underline underline-offset-2"
              onClick={() => setShowAll(true)}
            >
              show all {unlinked.length}
            </button>
          ) : null}
          {unlinked.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Every channel spelling is linked.
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold">Linked identity</h2>
        <div className="mt-3 overflow-hidden rounded-md border">
          {brands
            .filter((b) => b.refs.length)
            .map((b) => (
              <div key={b.id} className="border-b px-3 py-2 text-sm last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{b.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.colorways} colorways
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {b.refs.map((r) => (
                    <span
                      key={r.id}
                      className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {r.system}: {r.externalName}
                      {r.externalId ? ` (${r.externalId})` : ""}
                      {r.role !== "BRAND" ? ` · ${r.role.toLowerCase()}` : ""}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          {brands.every((b) => !b.refs.length) ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing linked yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
