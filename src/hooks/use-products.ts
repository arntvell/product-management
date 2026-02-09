"use client";

import { useQuery } from "@tanstack/react-query";
import type { Product } from "@/types";

async function fetchProducts(): Promise<Product[]> {
  const res = await fetch("/api/products");
  if (!res.ok) {
    throw new Error(`Failed to fetch products: ${res.statusText}`);
  }
  const data = await res.json();
  return data.products;
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
