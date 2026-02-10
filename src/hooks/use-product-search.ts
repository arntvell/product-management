"use client";

import { useMemo } from "react";
import { usePersistedState } from "./use-persisted-state";
import type { Product } from "@/types";

export interface Filters {
  search: string;
  vendors: string[];
  productTypes: string[];
  tags: string[];
  statuses: string[];
  missingFlat: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  search: "",
  vendors: [],
  productTypes: [],
  tags: [],
  statuses: [],
  missingFlat: false,
};

export function useProductSearch(products: Product[] | undefined) {
  const [filters, setFilters] = usePersistedState<Filters>(
    "metafield-manager:product-filters",
    DEFAULT_FILTERS
  );

  const filteredProducts = useMemo(() => {
    if (!products) return [];

    return products.filter((product) => {
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const matchesSearch =
          product.title.toLowerCase().includes(q) ||
          product.handle.toLowerCase().includes(q) ||
          product.vendor.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      if (
        filters.vendors.length > 0 &&
        !filters.vendors.includes(product.vendor)
      ) {
        return false;
      }

      if (
        filters.productTypes.length > 0 &&
        !filters.productTypes.includes(product.productType)
      ) {
        return false;
      }

      if (
        filters.tags.length > 0 &&
        !filters.tags.some((t) => product.tags.includes(t))
      ) {
        return false;
      }

      if (
        filters.statuses.length > 0 &&
        !filters.statuses.includes(product.status)
      ) {
        return false;
      }

      if (filters.missingFlat && product.metafields.flat) {
        return false;
      }

      return true;
    });
  }, [products, filters]);

  const vendors = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.map((p) => p.vendor))].filter(Boolean).sort();
  }, [products]);

  const productTypes = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.map((p) => p.productType))]
      .filter(Boolean)
      .sort();
  }, [products]);

  const tags = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.flatMap((p) => p.tags))].filter(Boolean).sort();
  }, [products]);

  const statuses = useMemo(() => {
    if (!products) return [];
    return [...new Set(products.map((p) => p.status))].filter(Boolean).sort();
  }, [products]);

  return {
    filters,
    setFilters,
    filteredProducts,
    vendors,
    productTypes,
    tags,
    statuses,
  };
}
