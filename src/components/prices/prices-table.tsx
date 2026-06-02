"use client";

import { useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Product, DirtyPrice } from "@/types";

const ROW_HEIGHT = 40;
const COL_TITLE = 300;
const COL_VENDOR = 160;
const COL_TYPE = 130;
const COL_PRICE = 130;
const COL_COMPARE = 150;

interface PriceCellProps {
  value: string;
  isDirty: boolean;
  onChange: (v: string) => void;
}

function PriceCell({ value, isDirty, onChange }: PriceCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = useCallback(
    (val: string) => {
      onChange(val);
      setEditing(false);
    },
    [onChange]
  );

  if (editing) {
    return (
      <input
        autoFocus
        className="w-full h-full px-2 text-sm bg-white border border-blue-400 focus:outline-none font-mono"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit(draft);
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className={cn(
        "px-2 h-full flex items-center text-sm cursor-pointer select-none hover:bg-muted/40 transition-colors font-mono",
        isDirty && "bg-yellow-50"
      )}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
    >
      {value || <span className="text-muted-foreground font-sans">—</span>}
    </div>
  );
}

interface PricesTableProps {
  products: Product[];
  dirtyPrices: Map<string, DirtyPrice>;
  onPriceChange: (productId: string, price: string, compareAtPrice: string) => void;
  onSave: () => Promise<void>;
  isSaving: boolean;
}

export function PricesTable({
  products,
  dirtyPrices,
  onPriceChange,
  onSave,
  isSaving,
}: PricesTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const dirtyCount = dirtyPrices.size;

  const getDisplayPrice = (product: Product) => {
    const dirty = dirtyPrices.get(product.id);
    if (dirty) return { price: dirty.price, compareAtPrice: dirty.compareAtPrice, mixed: false };
    if (product.variants.length === 0) return { price: "", compareAtPrice: "", mixed: false };
    const prices = product.variants.map((v) => v.price);
    const mixed = new Set(prices).size > 1;
    return {
      price: product.variants[0].price,
      compareAtPrice: product.variants[0].compareAtPrice ?? "",
      mixed,
    };
  };

  const handleEdit = (product: Product, field: "price" | "compareAtPrice", value: string) => {
    const dirty = dirtyPrices.get(product.id);
    const currentPrice = dirty?.price ?? product.variants[0]?.price ?? "";
    const currentCompare = dirty?.compareAtPrice ?? product.variants[0]?.compareAtPrice ?? "";
    if (field === "price") {
      onPriceChange(product.id, value, currentCompare);
    } else {
      onPriceChange(product.id, currentPrice, value);
    }
  };

  const items = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {dirtyCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-yellow-50 border-b border-yellow-200 text-sm shrink-0">
          <span className="text-yellow-800 font-medium">
            {dirtyCount} unsaved price {dirtyCount === 1 ? "change" : "changes"}
          </span>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}

      <div
        className="flex border-b bg-muted/30 text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0"
        style={{ height: ROW_HEIGHT }}
      >
        <div
          className="flex items-center px-3 border-r"
          style={{ width: COL_TITLE, minWidth: COL_TITLE }}
        >
          Product
        </div>
        <div
          className="flex items-center px-3 border-r"
          style={{ width: COL_VENDOR, minWidth: COL_VENDOR }}
        >
          Vendor
        </div>
        <div
          className="flex items-center px-3 border-r"
          style={{ width: COL_TYPE, minWidth: COL_TYPE }}
        >
          Type
        </div>
        <div
          className="flex items-center px-3 border-r"
          style={{ width: COL_PRICE, minWidth: COL_PRICE }}
        >
          Price
        </div>
        <div
          className="flex items-center px-3"
          style={{ width: COL_COMPARE, minWidth: COL_COMPARE }}
        >
          Compare at
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {items.map((vRow) => {
            const product = products[vRow.index];
            const { price, compareAtPrice, mixed } = getDisplayPrice(product);
            const isDirty = dirtyPrices.has(product.id);

            return (
              <div
                key={product.id}
                style={{
                  position: "absolute",
                  top: vRow.start,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
                className={cn(
                  "flex border-b hover:bg-muted/10",
                  isDirty && "bg-yellow-50/50"
                )}
              >
                <div
                  className="flex items-center px-3 border-r text-sm gap-2"
                  style={{ width: COL_TITLE, minWidth: COL_TITLE }}
                >
                  <span className="truncate" title={product.title}>
                    {product.title}
                  </span>
                  {mixed && (
                    <span className="text-xs text-muted-foreground bg-muted rounded px-1 shrink-0">
                      mixed
                    </span>
                  )}
                </div>

                <div
                  className="flex items-center px-3 border-r text-sm text-muted-foreground truncate"
                  style={{ width: COL_VENDOR, minWidth: COL_VENDOR }}
                >
                  {product.vendor}
                </div>

                <div
                  className="flex items-center px-3 border-r text-sm text-muted-foreground truncate"
                  style={{ width: COL_TYPE, minWidth: COL_TYPE }}
                >
                  {product.productType || "—"}
                </div>

                <div
                  className="border-r overflow-hidden"
                  style={{ width: COL_PRICE, minWidth: COL_PRICE, height: ROW_HEIGHT }}
                >
                  <PriceCell
                    value={price}
                    isDirty={isDirty}
                    onChange={(v) => handleEdit(product, "price", v)}
                  />
                </div>

                <div
                  className="overflow-hidden"
                  style={{ width: COL_COMPARE, minWidth: COL_COMPARE, height: ROW_HEIGHT }}
                >
                  <PriceCell
                    value={compareAtPrice}
                    isDirty={isDirty}
                    onChange={(v) => handleEdit(product, "compareAtPrice", v)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
