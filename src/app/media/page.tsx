"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-products";
import { useProductSearch } from "@/hooks/use-product-search";
import { useMediaColumnVisibility } from "@/hooks/use-media-column-visibility";
import { useMetafieldMutation } from "@/hooks/use-metafield-mutation";
import { ProductFilters } from "@/components/products/product-filters";
import { MediaColumnPicker } from "@/components/media/media-column-picker";
import { MediaTable } from "@/components/media/media-table";
import { MediaDetailPanel } from "@/components/media/media-detail-panel";
import { Button } from "@/components/ui/button";
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { MediaColumnKey } from "@/lib/media-columns";
import type { Product } from "@/types";

interface DetailTarget {
  product: Product;
  columnKey: MediaColumnKey;
}

export default function MediaPage() {
  const { data: products, isLoading, error, refetch } = useProducts();
  const {
    filters,
    setFilters,
    filteredProducts,
    vendors,
    productTypes,
    tags,
    statuses,
  } = useProductSearch(products);
  const {
    visibleKeys,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    showAll,
  } = useMediaColumnVisibility();
  const mutation = useMetafieldMutation();
  const queryClient = useQueryClient();

  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const handleOpenDetail = useCallback(
    (product: Product, columnKey: MediaColumnKey) => {
      setDetailTarget({ product, columnKey });
    },
    []
  );

  const handleCloseDetail = useCallback(() => {
    setDetailTarget(null);
  }, []);

  const handleMetafieldSave = useCallback(
    async (
      productId: string,
      field: "men_images" | "women_images",
      value: string
    ) => {
      const def = METAFIELD_DEFINITIONS.find((d) => d.key === field);
      if (!def) return;

      try {
        await mutation.mutateAsync([
          {
            productId,
            metafields: [
              {
                namespace: def.namespace,
                key: def.key,
                value,
                type: def.type,
              },
            ],
          },
        ]);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        queryClient.invalidateQueries({ queryKey: ["file-nodes"] });
      } catch {
        // Error toast handled by the calling component
      }
    },
    [mutation, queryClient]
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading products...</p>
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
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      <ProductFilters
        filters={filters}
        onFiltersChange={setFilters}
        vendors={vendors}
        productTypes={productTypes}
        tags={tags}
        statuses={statuses}
        totalCount={products?.length || 0}
        filteredCount={filteredProducts.length}
        actions={
          <MediaColumnPicker
            visibleKeys={visibleKeys}
            onToggle={toggleColumn}
            onReset={resetToDefaults}
            onShowAll={showAll}
          />
        }
      />

      <MediaTable
        products={filteredProducts}
        columns={visibleColumns}
        onOpenDetail={handleOpenDetail}
        onMetafieldSave={handleMetafieldSave}
      />

      <MediaDetailPanel
        product={detailTarget?.product ?? null}
        columnKey={detailTarget?.columnKey ?? null}
        isOpen={!!detailTarget}
        onClose={handleCloseDetail}
        onMetafieldSave={handleMetafieldSave}
      />
    </div>
  );
}
