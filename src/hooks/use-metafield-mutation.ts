"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { BulkMetafieldUpdate, DirtyCell, Product } from "@/types";

interface MutationResult {
  success: boolean;
  batchesProcessed: number;
  errors: string[];
}

async function saveMetafields(
  updates: BulkMetafieldUpdate[]
): Promise<MutationResult> {
  const res = await fetch("/api/metafields", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ updates }),
  });

  if (!res.ok) {
    throw new Error(`Failed to save metafields: ${res.statusText}`);
  }

  return res.json();
}

export function useMetafieldMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveMetafields,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });
}

/** Convert dirty cells to bulk update format */
export function dirtyCellsToUpdates(
  dirtyCells: Map<string, DirtyCell>
): BulkMetafieldUpdate[] {
  const byProduct = new Map<
    string,
    Array<{ namespace: string; key: string; value: string; type: string }>
  >();

  for (const cell of dirtyCells.values()) {
    const def = METAFIELD_DEFINITIONS.find((d) => d.key === cell.field);
    if (!def) continue;

    const existing = byProduct.get(cell.productId) || [];
    existing.push({
      namespace: def.namespace,
      key: def.key,
      value: cell.value,
      type: def.type,
    });
    byProduct.set(cell.productId, existing);
  }

  return [...byProduct.entries()].map(([productId, metafields]) => ({
    productId,
    metafields,
  }));
}

/** Optimistically update cached products with dirty cell values */
export function applyDirtyCellsToProducts(
  products: Product[],
  dirtyCells: Map<string, DirtyCell>
): Product[] {
  if (dirtyCells.size === 0) return products;

  return products.map((product) => {
    let changed = false;
    const newMetafields = { ...product.metafields };

    for (const cell of dirtyCells.values()) {
      if (cell.productId === product.id) {
        newMetafields[cell.field] = cell.value;
        changed = true;
      }
    }

    return changed ? { ...product, metafields: newMetafields } : product;
  });
}
