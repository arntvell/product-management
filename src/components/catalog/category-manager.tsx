"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOOM_CATEGORIES } from "@/lib/master/loom-category";
import type { CategoryNode, UnmappedValue } from "@/lib/master/categories";

export function CategoryManager({
  categories,
  unmapped,
}: {
  categories: CategoryNode[];
  unmapped: UnmappedValue[];
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [q, setQ] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<CategoryNode | null>(null);

  const live = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return categories
      .filter((c) => (showArchived ? true : !c.archived))
      .filter((c) => !needle || c.name.toLowerCase().includes(needle));
  }, [categories, q, showArchived]);

  const active = categories.filter((c) => !c.archived);
  const unused = active.filter((c) => c.styles === 0 && c.colorways === 0);

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

  async function put(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Failed");
    return json;
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Categories" value={active.length} />
        <Stat label="Unmapped values" value={unmapped.length} hint="from Sitoo, Shopify, Loom" />
        <Stat label="Used by nothing" value={unused.length} hint="archive candidates" />
        <Stat label="Archived" value={categories.filter((c) => c.archived).length} />
      </div>

      {unmapped.length ? (
        <section>
          <h2 className="text-sm font-semibold">
            Waiting to be mapped ({unmapped.length})
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Values seen in a channel that do not yet resolve to a category. Most-used first
            — mapping the top of this list covers most of the catalogue.
          </p>
          <div className="mt-3 overflow-hidden rounded-md border">
            {unmapped.slice(0, 40).map((u) => (
              <div
                key={u.id}
                className="grid grid-cols-[5rem_1fr_4rem_minmax(12rem,1fr)] items-center gap-3 border-b px-3 py-2 text-sm last:border-0"
              >
                <span className="rounded-full border px-2 py-0.5 text-center text-[10px] text-muted-foreground">
                  {u.system}
                </span>
                <div className="min-w-0">
                  <div className="truncate">{u.externalName}</div>
                  {u.externalPath ? (
                    <div className="truncate text-xs text-muted-foreground">{u.externalPath}</div>
                  ) : null}
                </div>
                <div className="text-right text-xs tabular-nums text-muted-foreground">
                  {u.productCount || "—"}
                </div>
                <select
                  className="h-8 rounded-md border bg-transparent px-2 text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const categoryId = e.target.value;
                    if (!categoryId) return;
                    start(async () => {
                      try {
                        await post("/api/catalog/categories/map", { mapId: u.id, categoryId });
                        toast.success(`${u.externalName} → mapped`);
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      }
                    });
                  }}
                >
                  <option value="">map to…</option>
                  {active.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            {unmapped.length > 40 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                …and {unmapped.length - 40} more.
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">The vocabulary</h2>
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="h-8 max-w-xs"
          />
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            show archived
          </label>
          {mergeFrom ? (
            <span className="ml-auto text-xs">
              Merging <b>{mergeFrom.name}</b> into… pick a row.{" "}
              <button
                className="underline underline-offset-2"
                onClick={() => setMergeFrom(null)}
              >
                cancel
              </button>
            </span>
          ) : null}
        </div>

        <div className="mt-3 overflow-x-auto rounded-md border">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-[minmax(10rem,2fr)_7rem_7rem_7rem_5rem_5rem_9rem] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
              <div>Category</div>
              <div>Shopify type</div>
              <div>Loom</div>
              <div>Sitoo id</div>
              <div className="text-right">Styles</div>
              <div className="text-right">Colorways</div>
              <div />
            </div>
            {live.map((c) => (
              <div
                key={c.id}
                className={
                  "grid grid-cols-[minmax(10rem,2fr)_7rem_7rem_7rem_5rem_5rem_9rem] items-center gap-3 border-b px-3 py-1.5 text-sm last:border-0 " +
                  (c.archived ? "opacity-50" : "")
                }
              >
                <div className="min-w-0">
                  <div className="truncate">{c.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {Object.entries(c.mapped)
                      .map(([s, n]) => `${s}×${n}`)
                      .join(" ") || "no channel values"}
                  </div>
                </div>
                <Input
                  className="h-7 text-xs"
                  defaultValue={c.shopifyProductType ?? ""}
                  onBlur={(e) => {
                    if (e.target.value === (c.shopifyProductType ?? "")) return;
                    start(async () => {
                      try {
                        await put(`/api/catalog/categories/${c.id}`, {
                          shopifyProductType: e.target.value,
                        });
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      }
                    });
                  }}
                />
                <select
                  className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
                  defaultValue={c.loomCategory ?? ""}
                  onChange={(e) =>
                    start(async () => {
                      try {
                        await put(`/api/catalog/categories/${c.id}`, {
                          loomCategory: e.target.value,
                        });
                        router.refresh();
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Failed");
                      }
                    })
                  }
                >
                  <option value="">—</option>
                  {LOOM_CATEGORIES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <div className="font-mono text-xs text-muted-foreground">
                  {c.sitooCategoryId ?? "—"}
                </div>
                <div className="text-right tabular-nums text-muted-foreground">{c.styles}</div>
                <div className="text-right tabular-nums text-muted-foreground">
                  {c.colorways}
                </div>
                <div className="flex justify-end gap-1.5">
                  {mergeFrom && mergeFrom.id !== c.id ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        start(async () => {
                          try {
                            const r = await post("/api/catalog/categories/merge", {
                              loserId: mergeFrom.id,
                              winnerId: c.id,
                            });
                            toast.success(
                              `Merged into ${c.name}: ${r.result.styles} styles, ${r.result.colorways} colorways moved.`
                            );
                            setMergeFrom(null);
                            router.refresh();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Failed");
                          }
                        })
                      }
                    >
                      merge here
                    </Button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="text-xs underline underline-offset-2"
                        onClick={() => setMergeFrom(c)}
                      >
                        merge
                      </button>
                      <button
                        type="button"
                        className="text-xs underline underline-offset-2 text-muted-foreground"
                        onClick={() =>
                          start(async () => {
                            try {
                              await put(`/api/catalog/categories/${c.id}`, {
                                archived: !c.archived,
                                active: c.archived,
                              });
                              router.refresh();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Failed");
                            }
                          })
                        }
                      >
                        {c.archived ? "restore" : "archive"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
