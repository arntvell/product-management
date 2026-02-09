"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { parseGidList } from "@/lib/utils";
import type { Product } from "@/types";

interface ProductLinksEditorProps {
  label: string;
  value: string;
  allProducts: Product[];
  onOpenSelector: () => void;
  onRemove: (productId: string) => void;
}

export function ProductLinksEditor({
  label,
  value,
  allProducts,
  onOpenSelector,
  onRemove,
}: ProductLinksEditorProps) {
  const linkedIds = parseGidList(value);
  const linkedProducts = linkedIds
    .map((id) => allProducts.find((p) => p.id === id))
    .filter(Boolean) as Product[];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <Button size="sm" variant="outline" onClick={onOpenSelector}>
          Add Products
        </Button>
      </div>
      {linkedProducts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No products linked</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {linkedProducts.map((product) => (
            <Badge
              key={product.id}
              variant="secondary"
              className="flex items-center gap-1.5 pr-1"
            >
              {product.featuredImage && (
                <img
                  src={product.featuredImage}
                  alt=""
                  className="w-4 h-4 rounded object-cover"
                />
              )}
              <span className="text-xs max-w-[150px] truncate">
                {product.title}
              </span>
              <button
                className="ml-1 text-muted-foreground hover:text-foreground"
                onClick={() => onRemove(product.id)}
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
