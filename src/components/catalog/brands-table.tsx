"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import type { BrandListItem } from "@/lib/master/brands";

export function BrandsTable({ brands: initial }: { brands: BrandListItem[] }) {
  const router = useRouter();
  const [brands, setBrands] = useState(initial);
  const [q, setQ] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // Archived brands are out of every picker, so they are out of the warnings
  // too — a duplicate nobody can choose is not a problem to fix.
  const live = useMemo(() => brands.filter((b) => !b.archived), [brands]);
  const archivedCount = brands.length - live.length;

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return brands.filter((b) => {
      if (b.archived !== showArchived) return false;
      if (needle && !b.name.toLowerCase().includes(needle)) return false;
      if (onlyIssues && !issue(b)) return false;
      return true;
    });
  }, [brands, q, onlyIssues, showArchived]);

  async function setArchived(b: BrandListItem, archived: boolean) {
    if (
      archived &&
      b.activeColorways > 0 &&
      !confirm(
        `${b.name} still has ${b.activeColorways} product(s) that are not archived. Archive the brand anyway?\n\n` +
          "It disappears from the brand pickers; its products and their channels are not touched."
      )
    )
      return;
    setBusy(b.id);
    try {
      const res = await fetch(`/api/catalog/brands/${b.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setBrands((bs) => bs.map((x) => (x.id === b.id ? { ...x, archived } : x)));
      toast.success(archived ? `${b.name} archived.` : `${b.name} restored.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const dupes = live.filter((b) => b.possibleDuplicateOf.length).length;
  const noToken = live.filter((b) => !b.isLivid && !b.skuToken).length;
  const noSitoo = live.filter((b) => b.sitooManufacturerIds.length === 0).length;
  const manySitoo = live.filter((b) => b.sitooManufacturerIds.length > 1).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search brands"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={onlyIssues}
            onChange={(e) => setOnlyIssues(e.target.checked)}
          />
          Needs attention
        </label>
        <label className="flex items-center gap-2 text-body">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Archived ({archivedCount})
        </label>
        <span className="ml-auto text-fine text-muted-foreground">
          {rows.length} of {showArchived ? archivedCount : live.length}
        </span>
      </div>

      {(dupes || noToken || noSitoo || manySitoo) && !onlyIssues && !showArchived ? (
        <div className="border border-ink bg-paper px-3 py-2 text-meta normal-case tracking-normal text-ink">
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
          {noSitoo ? (
            <div>
              {noSitoo} brand{noSitoo === 1 ? " has" : "s have"} no Sitoo manufacturer —
              a product created in Sitoo for {noSitoo === 1 ? "it" : "them"} carries no
              manufacturer at all.{" "}
              <Link href="/catalog/brands/identity" className="underline">
                Link them
              </Link>
              .
            </div>
          ) : null}
          {manySitoo ? (
            <div>
              {manySitoo} brand{manySitoo === 1 ? " is" : "s are"} linked to more than one
              Sitoo manufacturer. A Sitoo create refuses these rather than guess which one
              the till should show.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-x-auto border">
        <div className="min-w-[64rem]">
          <div className="grid grid-cols-[minmax(12rem,2fr)_5rem_5rem_minmax(8rem,1fr)_5rem_7rem_4rem_5rem_5.5rem] items-center gap-3 border-b bg-muted/40 px-3 py-2 text-fine text-muted-foreground">
            <div>Brand</div>
            <div>Token</div>
            <div>Rule</div>
            <div>Default sizes</div>
            <div title="Sitoo manufacturerid — the id the till groups by">Sitoo</div>
            <div title="Shopify vendor. A free string with no id, so only the spelling joins.">
              Shopify
            </div>
            <div className="text-right">Styles</div>
            <div className="text-right" title="Not archived / all">
              Colorways
            </div>
            <div />
          </div>
          {rows.map((b) => (
            <Link
              key={b.id}
              href={`/catalog/brands/${b.id}`}
              className="grid grid-cols-[minmax(12rem,2fr)_5rem_5rem_minmax(8rem,1fr)_5rem_7rem_4rem_5rem_5.5rem] items-center gap-3 border-b px-3 py-2 text-body transition-colors last:border-0 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <div className="truncate">
                  {b.name}
                  {b.isLivid ? (
                    <span className="ml-2 rounded-full border px-1.5 py-0.5 text-fine text-muted-foreground">
                      Livid
                    </span>
                  ) : null}
                </div>
                {b.possibleDuplicateOf.length ? (
                  <div className="truncate text-fine text-ink">
                    looks like {b.possibleDuplicateOf.join(", ")}
                  </div>
                ) : null}
              </div>
              <div className="font-mono text-fine">
                {b.skuToken ?? <span className="text-muted-foreground">—</span>}
              </div>
              <div className="font-mono text-fine text-muted-foreground">
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
                    className={b.skuToken ? "" : "text-ink"}
                  >
                    {b.derivedToken}
                  </span>
                )}
              </div>
              <div className="truncate text-fine text-muted-foreground">
                {b.defaultSizeSystem?.name ?? (b.hasTemplate ? "—" : "no template")}
              </div>
              <div className="font-mono text-fine">
                {b.sitooManufacturerIds.length ? (
                  <span
                    className={b.sitooManufacturerIds.length > 1 ? "text-ink" : ""}
                    title={
                      b.sitooManufacturerIds.length > 1
                        ? "Linked to more than one Sitoo manufacturer — a Sitoo create will refuse rather than guess"
                        : "Sitoo manufacturerid"
                    }
                  >
                    {b.sitooManufacturerIds.join(", ")}
                  </span>
                ) : (
                  <span className="text-muted-foreground" title="Not linked to a Sitoo manufacturer">
                    —
                  </span>
                )}
              </div>
              <div className="truncate text-fine text-muted-foreground" title={b.shopifyVendors.join(", ")}>
                {b.shopifyVendors.join(", ") || "—"}
              </div>
              <div className="text-right tabular-nums text-muted-foreground">{b.styles}</div>
              <div
                className="text-right tabular-nums text-muted-foreground"
                title={`${b.activeColorways} not archived, ${b.colorways} in all`}
              >
                <span className={b.activeColorways === 0 ? "" : "text-ink"}>{b.activeColorways}</span>
                {" / "}
                {b.colorways}
              </div>
              <div className="text-right">
                {b.merged ? (
                  <span className="text-fine text-muted-foreground" title="Merged into another brand">
                    merged
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={(e) => {
                      // The row is a link to the brand; the button is not.
                      e.preventDefault();
                      e.stopPropagation();
                      setArchived(b, !b.archived);
                    }}
                    className="border px-2 py-0.5 text-fine transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    {busy === b.id ? "…" : b.archived ? "Restore" : "Archive"}
                  </button>
                )}
              </div>
            </Link>
          ))}
          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-body text-muted-foreground">
              {showArchived ? "No archived brands." : "No brands match."}
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
    !b.defaultSizeSystem ||
    // Ambiguous is worse than absent: a Sitoo create refuses on several, and
    // sends no manufacturer at all on none.
    b.sitooManufacturerIds.length !== 1
  );
}
