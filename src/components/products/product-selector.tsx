"use client";

import { useState, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/types";

interface ProductSelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  selectedIds: string[];
  onSelect: (productId: string) => void;
  onDeselect: (productId: string) => void;
  title?: string;
}

export function ProductSelector({
  open,
  onOpenChange,
  products,
  selectedIds,
  onSelect,
  onDeselect,
  title = "Select products",
}: ProductSelectorProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return products.slice(0, 50);
    const q = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [products, search]);

  const selectedSet = new Set(selectedIds);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={title}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No products found.</CommandEmpty>
        {selectedIds.length > 0 && (
          <CommandGroup heading="Selected">
            {products
              .filter((p) => selectedSet.has(p.id))
              .map((product) => (
                <CommandItem
                  key={`selected-${product.id}`}
                  value={product.title}
                  onSelect={() => onDeselect(product.id)}
                >
                  <div className="flex items-center gap-2 w-full">
                    {product.featuredImage && (
                      <img
                        src={product.featuredImage}
                        alt=""
                        className="w-8 h-8 object-cover rounded"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{product.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {product.vendor}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      Selected
                    </Badge>
                  </div>
                </CommandItem>
              ))}
          </CommandGroup>
        )}
        <CommandGroup heading="Products">
          {filtered
            .filter((p) => !selectedSet.has(p.id))
            .map((product) => (
              <CommandItem
                key={product.id}
                value={product.title}
                onSelect={() => onSelect(product.id)}
              >
                <div className="flex items-center gap-2 w-full">
                  {product.featuredImage && (
                    <img
                      src={product.featuredImage}
                      alt=""
                      className="w-8 h-8 object-cover rounded"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{product.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.vendor} &middot; {product.productType}
                    </p>
                  </div>
                </div>
              </CommandItem>
            ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
