"use client";

import { useQuery } from "@tanstack/react-query";
import type { FileNode } from "@/types";

async function fetchFileNodes(gids: string[]): Promise<FileNode[]> {
  if (gids.length === 0) return [];

  const res = await fetch("/api/files/nodes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: gids }),
  });

  if (!res.ok) {
    throw new Error(`Failed to resolve file nodes: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.nodes || []).filter(Boolean) as FileNode[];
}

export function useFileNodes(gids: string[]) {
  const sortedKey = [...gids].sort().join(",");

  return useQuery({
    queryKey: ["file-nodes", sortedKey],
    queryFn: () => fetchFileNodes(gids),
    enabled: gids.length > 0,
    staleTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
  });
}
