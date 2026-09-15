"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import type { BrandListItem } from "@/lib/master/brands";

export function BrandsTable({ brands }: { brands: BrandListItem[] }) {
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands.filter((b) => {
      if (needle && !b.name.toLowerCase().includes(needle)) return false;
      if (onlyIssues && !issue(b)) return false;
      return true;
    });
  }, [brands, q, onlyIssues]);

  const dupes = brands.filter((b) => b.possibleDuplicateOf.length).length;
  const noToken = brands.filter((b) => !b.isLivid && !b.skuToken).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brands"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
          />
          Needs attention
        </label>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {brands.length}
        </span>
      </div>

      {(dupes || noToken) && !onlyIssues ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {noToken ? (
            <div>
              {noToken} brand{noToken === 1 ? " has" : "s have"} no SKU token — a new style
              there will be named by the abbreviation rule, which may not match what the
              brand already uses.
            </div>
          ) : null}
          {dupes ? (
            <div>
              {dupes} brand{dupes === 1 ? "" : "s"} look like duplicates of another. Two
              brands for one label means two sets of products and two vendor strings
              downstream.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-[46rem]">
          <div className="grid grid-cols-[minmax(12rem,2fr)_5rem_5rem_minmax(8rem,1fr)_4rem_5rem] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <div>Brand</div>
            <div>Token</div>
            <div>Rule</div>
            <div>Default sizes</div>
            <div className="text-right">Styles</div>
            <div className="text-right">Colorways</div>
          </div>
          {rows.map((b) => (
            <Link
              key={b.id}
              href={`/catalog/brands/${b.id}`}
              className="grid grid-cols-[minmax(12rem,2fr)_5rem_5rem_minmax(8rem,1fr)_4rem_5rem] items-center gap-3 border-b px-3 py-2 text-sm transition-colors last:border-0 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {b.name}
                  {b.isLivid ? (
                    <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      Livid
                    </span>
                  ) : null}
                </div>
                {b.possibleDuplicateOf.length ? (
                  <div className="truncate text-[11px] text-amber-700 dark:text-amber-400">
                    looks like {b.possibleDuplicateOf.join(", ")}
                  </div>
                ) : null}
              </div>
              <div className="font-mono text-xs">
                {b.skuToken ?? <span className="text-muted-foreground">—</span>}
              </div>
              <div className="font-mono text-xs text-muted-foreground">
                {b.isLivid ? (
                  "—"
                ) : b.derivedToken === b.skuToken ? (
                  <span title="The rule agrees with the token">same</span>
                ) : (
                  <span
                    title={
                      b.skuToken
                        ? "What the rule would give if the token were cleared"
                        : "No token set — this is what a new style would use"
                    }
                    className={b.skuToken ? "" : "text-amber-700 dark:text-amber-400"}
                  >
                    {b.derivedToken}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {b.defaultSizeSystem?.name ?? (b.hasTemplate ? "—" : "no template")}
              </div>
              <div className="text-right tabular-nums text-muted-foreground">{b.styles}</div>
              <div className="text-right tabular-nums text-muted-foreground">
                {b.colorways}
              </div>
            </Link>
          ))}
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No brands match.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function issue(b: BrandListItem): boolean {
  return (
    b.possibleDuplicateOf.length > 0 ||
    (!b.isLivid && !b.skuToken) ||
    !b.defaultSizeSystem
  );
}
