"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Product, ShopifyPage, MetafieldKey } from "@/types";

interface FitguideAutoLinkProps {
  products: Product[];
  selectedIds: Set<string>;
  fitguidePages: ShopifyPage[];
  onApply: (
    updates: Array<{ productId: string; field: MetafieldKey; value: string }>
  ) => void;
}

interface Match {
  product: Product;
  page: ShopifyPage;
  /** True when overriding an existing fitguide with a seasonal one */
  isOverride: boolean;
}

/** Season tags to check, in priority order (newest first) */
const SEASON_TAGS = ["SS26"];

export function FitguideAutoLink({
  products,
  selectedIds,
  fitguidePages,
  onApply,
}: FitguideAutoLinkProps) {
  const [open, setOpen] = useState(false);

  const targetProducts = useMemo(() => {
    if (selectedIds.size === 0) return products;
    return products.filter((p) => selectedIds.has(p.id));
  }, [products, selectedIds]);

  const pageByHandle = useMemo(() => {
    const map = new Map<string, ShopifyPage>();
    for (const page of fitguidePages) {
      map.set(page.handle.toLowerCase(), page);
    }
    return map;
  }, [fitguidePages]);

  const matches = useMemo(() => {
    if (!open) return [];
    const result: Match[] = [];
    for (const product of targetProducts) {
      const parts = product.handle.toLowerCase().split("-");

      // Check if product has a season tag — if so, try seasonal fitguide first
      const seasonTag = SEASON_TAGS.find((tag) =>
        product.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
      );

      if (seasonTag) {
        // Try seasonal fitguide: e.g. "abby-black" + "SS26" → "abby-ss26-fitguide"
        const seasonSuffix = seasonTag.toLowerCase();
        let matchedSeasonal = false;
        for (let len = parts.length; len >= 1 && !matchedSeasonal; len--) {
          const prefix = parts.slice(0, len).join("-");
          const page = pageByHandle.get(`${prefix}-${seasonSuffix}-fitguide`);
          if (page) {
            // Only add if it's different from the current fitguide
            if (product.metafields.fitguide !== page.id) {
              result.push({ product, page, isOverride: !!product.metafields.fitguide });
            }
            matchedSeasonal = true;
          }
        }
        if (matchedSeasonal) continue;
      }

      // Standard matching: skip products that already have a fitguide
      if (product.metafields.fitguide) continue;

      // Try progressively shorter prefixes of the handle
      // e.g. "nelson-slim-black" → try "nelson-slim-black-fitguide",
      //   then "nelson-slim-fitguide", then "nelson-fitguide"
      let matched = false;
      for (let len = parts.length; len >= 1 && !matched; len--) {
        const prefix = parts.slice(0, len).join("-");
        const page = pageByHandle.get(`${prefix}-fitguide`);
        if (page) {
          result.push({ product, page, isOverride: false });
          matched = true;
        }
      }
    }
    return result;
  }, [open, targetProducts, pageByHandle]);

  const handleApply = () => {
    const updates = matches.map((m) => ({
      productId: m.product.id,
      field: "fitguide" as MetafieldKey,
      value: m.page.id,
    }));
    onApply(updates);
    setOpen(false);
  };

  const actionableCount = useMemo(() => {
    let count = 0;
    for (const p of targetProducts) {
      if (!p.metafields.fitguide) {
        count++;
      } else if (
        SEASON_TAGS.some((tag) =>
          p.tags.some((t) => t.toLowerCase() === tag.toLowerCase())
        )
      ) {
        // SS26 products may need re-linking to seasonal fitguide
        count++;
      }
    }
    return count;
  }, [targetProducts]);

  const hasSelection = selectedIds.size > 0;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={actionableCount === 0}
      >
        Auto-link Fitguides
        {hasSelection && ` (${selectedIds.size})`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Auto-link Fitguides</DialogTitle>
            <DialogDescription>
              {hasSelection
                ? `Matching ${selectedIds.size} selected product${selectedIds.size !== 1 ? "s" : ""} to fitguide pages by handle`
                : "Matching all products to fitguide pages by handle"}
              {" "}({actionableCount} actionable)
            </DialogDescription>
          </DialogHeader>
          {matches.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              No matches found. Ensure fitguide page handles follow the pattern{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                {"{product-name}"}-fitguide
              </code>
              {" "}(e.g. product &quot;nelson-slim-black&quot; matches &quot;nelson-fitguide&quot;)
            </p>
          ) : (
            <>
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-1">
                  {matches.map((m) => (
                    <div
                      key={m.product.id}
                      className="flex items-center gap-2 text-sm py-1 px-1"
                    >
                      <span className="truncate flex-1 min-w-0">
                        {m.product.title}
                        {m.isOverride && (
                          <span className="ml-1 text-xs text-yellow-600">(update)</span>
                        )}
                      </span>
                      <span className="text-muted-foreground shrink-0">&rarr;</span>
                      <span className="truncate flex-1 min-w-0 text-muted-foreground">
                        {m.page.title}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                {matches.length} match{matches.length !== 1 ? "es" : ""} found
              </p>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              disabled={matches.length === 0}
            >
              Apply {matches.length} link{matches.length !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
