"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useProducts } from "@/hooks/use-products";
import { useProductGroups } from "@/hooks/use-product-groups";
import { useMetafieldMutation } from "@/hooks/use-metafield-mutation";
import { GroupList } from "@/components/groups/group-list";
import { Button } from "@/components/ui/button";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { serializeGidList } from "@/lib/utils";
import { detectLividAutoLinks } from "@/lib/grouping";
import type { BulkMetafieldUpdate, ProductGroup } from "@/types";

export default function GroupsPage() {
  const { data: products, isLoading, error } = useProducts();
  const { groups } = useProductGroups(products);
  const mutation = useMetafieldMutation();
  const [autoLinkCount, setAutoLinkCount] = useState<number | null>(null);

  const handleAutoLink = useCallback(
    async (group: ProductGroup, memberIds: string[]) => {
      const updates: BulkMetafieldUpdate[] = memberIds.map((id) => ({
        productId: id,
        metafields: [
          {
            namespace: METAFIELD_NAMESPACE,
            key: "same_product",
            value: serializeGidList(memberIds.filter((mid) => mid !== id)),
            type: "list.product_reference",
          },
        ],
      }));

      try {
        const result = await mutation.mutateAsync(updates);
        if (result.success) {
          toast.success(
            `Linked ${memberIds.length} products in "${group.baseName}"`
          );
        } else {
          toast.error(`Some links failed: ${result.errors.join(", ")}`);
        }
      } catch (err) {
        toast.error(
          `Failed to link: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    },
    [mutation]
  );

  const handleAutoPopulateLivid = useCallback(async () => {
    if (!products) return;

    const suggestions = detectLividAutoLinks(products);
    if (suggestions.size === 0) {
      toast.info("No new Livid auto-links to apply.");
      return;
    }

    // Show confirmation
    setAutoLinkCount(suggestions.size);
  }, [products]);

  const confirmAutoPopulateLivid = useCallback(async () => {
    if (!products) return;
    setAutoLinkCount(null);

    const suggestions = detectLividAutoLinks(products);
    const updates: BulkMetafieldUpdate[] = [...suggestions.entries()].map(
      ([productId, linkedIds]) => ({
        productId,
        metafields: [
          {
            namespace: METAFIELD_NAMESPACE,
            key: "same_product",
            value: serializeGidList(linkedIds),
            type: "list.product_reference",
          },
        ],
      })
    );

    try {
      const result = await mutation.mutateAsync(updates);
      if (result.success) {
        toast.success(
          `Auto-linked ${updates.length} Livid products`
        );
      } else {
        toast.error(`Some links failed: ${result.errors.join(", ")}`);
      }
    } catch (err) {
      toast.error(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }, [products, mutation]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">
            Loading product groups...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">Failed to load products</p>
          <p className="text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">Product Groups</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Auto-detected groups of the same product in different colors/variants.
            Link them to populate the &ldquo;Same Product&rdquo; metafield.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleAutoPopulateLivid}
            disabled={mutation.isPending}
          >
            Auto-populate Livid
          </Button>
        </div>
      </div>

      {autoLinkCount !== null && (
        <div className="mb-6 rounded-md border border-yellow-300 bg-yellow-50 p-4 space-y-2">
          <p className="text-sm font-medium">
            Auto-populate {autoLinkCount} Livid products?
          </p>
          <p className="text-xs text-muted-foreground">
            This will update the &ldquo;Same Product&rdquo; metafield for{" "}
            {autoLinkCount} Livid products based on detected name groups.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={confirmAutoPopulateLivid}>
              Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAutoLinkCount(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <GroupList
        groups={groups}
        onAutoLink={handleAutoLink}
        isLinking={mutation.isPending}
      />
    </div>
  );
}
