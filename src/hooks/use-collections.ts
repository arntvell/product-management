"use client";

import { useQuery } from "@tanstack/react-query";
import type { ShopifyCollection } from "@/types";

async function fetchCollections(): Promise<ShopifyCollection[]> {
  const res = await fetch("/api/collections");
  if (!res.ok) {
    throw new Error(`Failed to fetch collections: ${res.statusText}`);
  }
  const data = await res.json();
  return data.collections;
}

export function useCollections() {
  const query = useQuery({
    queryKey: ["collections"],
    queryFn: fetchCollections,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    ...query,
    collections: query.data || [],
  };
}
