"use client";

import { useMemo } from "react";
import { detectProductGroups } from "@/lib/grouping";
import type { Product, ProductGroup } from "@/types";

export function useProductGroups(products: Product[] | undefined): {
  groups: ProductGroup[];
  isReady: boolean;
} {
  const groups = useMemo(() => {
    if (!products) return [];
    return detectProductGroups(products);
  }, [products]);

  return {
    groups,
    isReady: !!products,
  };
}
