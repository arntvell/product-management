"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { ShopifyPage } from "@/types";

async function fetchPages(): Promise<ShopifyPage[]> {
  const res = await fetch("/api/pages");
  if (!res.ok) {
    throw new Error(`Failed to fetch pages: ${res.statusText}`);
  }
  const data = await res.json();
  return data.pages;
}

export function usePages() {
  const query = useQuery({
    queryKey: ["pages"],
    queryFn: fetchPages,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const carePages = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter((p) =>
      p.title.toLowerCase().startsWith("care")
    );
  }, [query.data]);

  const fitguidePages = useMemo(() => {
    if (!query.data) return [];
    return query.data.filter((p) =>
      p.title.toLowerCase().includes("fitguide")
    );
  }, [query.data]);

  return {
    ...query,
    pages: query.data || [],
    carePages,
    fitguidePages,
  };
}
