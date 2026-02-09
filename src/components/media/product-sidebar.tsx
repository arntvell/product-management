"use client";

import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Product } from "@/types";

interface ProductSidebarProps {
  products: Product[];
  selectedId: string | null;
  onSelect: (productId: string) => void;
}

export function ProductSidebar({
  products,
  selectedId,
  onSelect,
}: ProductSidebarProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b">
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {filtered.map((product) => (
          <button
            key={product.id}
            onClick={() => onSelect(product.id)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors",
              selectedId === product.id && "bg-muted"
            )}
          >
            {product.featuredImage ? (
              <img
                src={product.featuredImage}
                alt=""
                className="w-8 h-8 object-cover rounded shrink-0"
              />
            ) : (
              <div className="w-8 h-8 bg-muted rounded shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm truncate">{product.title}</p>
              <p className="text-xs text-muted-foreground truncate">
                {product.vendor}
              </p>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-6">
            No products found.
          </p>
        )}
      </div>
    </div>
  );
}
