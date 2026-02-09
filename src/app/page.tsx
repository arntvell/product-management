"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useProducts } from "@/hooks/use-products";
import { useProductSearch } from "@/hooks/use-product-search";
import { usePages } from "@/hooks/use-pages";
import { useCollections } from "@/hooks/use-collections";
import { useModels } from "@/hooks/use-models";
import { useColumnVisibility } from "@/hooks/use-column-visibility";
import {
  useMetafieldMutation,
  dirtyCellsToUpdates,
} from "@/hooks/use-metafield-mutation";
import { ProductTable } from "@/components/products/product-table";
import { ProductFilters } from "@/components/products/product-filters";
import { ColumnPicker } from "@/components/products/column-picker";
import { FitguideAutoLink } from "@/components/products/fitguide-auto-link";
import { CarePicker } from "@/components/pickers/care-picker";
import { FitguidePicker } from "@/components/pickers/fitguide-picker";
import { CollectionPicker } from "@/components/pickers/collection-picker";
import { ModelPicker } from "@/components/pickers/model-picker";
import { Button } from "@/components/ui/button";
import type { DirtyCell, MetafieldKey, Product } from "@/types";

interface ActivePicker {
  product: Product;
  field: MetafieldKey;
  pickerType: string;
}

export default function ProductsPage() {
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
  const { pages, carePages, fitguidePages } = usePages();
  const { collections } = useCollections();
  const { models } = useModels();
  const { visibleKeys, visibleColumns, toggleColumn, resetToDefaults, showAll } =
    useColumnVisibility();
  const mutation = useMetafieldMutation();
  const [dirtyCells, setDirtyCells] = useState<Map<string, DirtyCell>>(
    new Map()
  );
  const [saveProgress, setSaveProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const abortRef = useRef(false);
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    if (dirtyCells.size === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCells.size]);

  const handleCellChange = useCallback(
    (productId: string, field: MetafieldKey, value: string) => {
      setDirtyCells((prev) => {
        const next = new Map(prev);
        const key = `${productId}:${field}`;

        // Check if value matches original
        const product = products?.find((p) => p.id === productId);
        if (product && product.metafields[field] === value) {
          next.delete(key);
        } else {
          next.set(key, { productId, field, value });
        }

        return next;
      });
    },
    [products]
  );

  const handleSaveAll = useCallback(async () => {
    if (dirtyCells.size === 0) return;

    const updates = dirtyCellsToUpdates(dirtyCells);
    const total = updates.length;

    if (total <= 1) {
      try {
        const result = await mutation.mutateAsync(updates);
        if (result.success) {
          setDirtyCells(new Map());
          toast.success(
            `Saved ${dirtyCells.size} change${dirtyCells.size !== 1 ? "s" : ""}`
          );
        } else {
          toast.error(`Some updates failed: ${result.errors.join(", ")}`);
        }
      } catch (err) {
        toast.error(
          `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
      return;
    }

    abortRef.current = false;
    setSaveProgress({ completed: 0, total });
    const errors: string[] = [];

    for (let i = 0; i < updates.length; i++) {
      if (abortRef.current) break;
      try {
        const result = await mutation.mutateAsync([updates[i]]);
        if (!result.success) {
          errors.push(...result.errors);
        }
      } catch (err) {
        errors.push(
          err instanceof Error ? err.message : "Unknown error"
        );
      }
      setSaveProgress({ completed: i + 1, total });
    }

    setSaveProgress(null);

    if (errors.length === 0) {
      setDirtyCells(new Map());
      toast.success(
        `Saved ${dirtyCells.size} change${dirtyCells.size !== 1 ? "s" : ""}`
      );
    } else {
      toast.error(`Some updates failed: ${errors.join(", ")}`);
    }
  }, [dirtyCells, mutation]);

  const handlePickerSelect = useCallback(
    (id: string) => {
      if (!activePicker) return;

      if (activePicker.pickerType === "metaobject") {
        // Generate formatted text from model data
        const model = models.find((m) => m.id === id);
        if (model) {
          const text = `Model is ${model.fields.height} tall and wearing a size ${model.fields.size_worn}`;
          handleCellChange(activePicker.product.id, activePicker.field, text);
        }
      } else {
        handleCellChange(activePicker.product.id, activePicker.field, id);
      }

      setActivePicker(null);
    },
    [activePicker, handleCellChange, models]
  );

  const handlePickerClear = useCallback(() => {
    if (!activePicker) return;
    handleCellChange(activePicker.product.id, activePicker.field, "");
    setActivePicker(null);
  }, [activePicker, handleCellChange]);

  const handleAutoLinkFitguides = useCallback(
    (updates: Array<{ productId: string; field: MetafieldKey; value: string }>) => {
      for (const update of updates) {
        handleCellChange(update.productId, update.field, update.value);
      }
      toast.success(
        `Linked ${updates.length} product${updates.length !== 1 ? "s" : ""} to fitguides — save to apply`
      );
    },
    [handleCellChange]
  );

  const getCellValue = useCallback(
    (product: Product, field: MetafieldKey): string => {
      const dirtyKey = `${product.id}:${field}`;
      const dirty = dirtyCells.get(dirtyKey);
      return dirty ? dirty.value : product.metafields[field];
    },
    [dirtyCells]
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
          <>
            <FitguideAutoLink
              products={products || []}
              selectedIds={selectedIds}
              fitguidePages={fitguidePages}
              onApply={handleAutoLinkFitguides}
            />
            <ColumnPicker
              visibleKeys={visibleKeys}
              onToggle={toggleColumn}
              onReset={resetToDefaults}
              onShowAll={showAll}
            />
          </>
        }
      />
      <ProductTable
        products={filteredProducts}
        allProducts={products || []}
        dirtyCells={dirtyCells}
        onCellChange={handleCellChange}
        onSaveAll={handleSaveAll}
        isSaving={mutation.isPending}
        dirtyCount={dirtyCells.size}
        saveProgress={saveProgress}
        pages={pages}
        collections={collections}
        models={models}
        onOpenPicker={setActivePicker}
        visibleColumns={visibleColumns}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
      />

      {/* Care Picker */}
      <CarePicker
        open={activePicker?.pickerType === "page_care"}
        onOpenChange={(open) => !open && setActivePicker(null)}
        carePages={carePages}
        selectedId={
          activePicker?.pickerType === "page_care"
            ? getCellValue(activePicker.product, activePicker.field) || null
            : null
        }
        onSelect={handlePickerSelect}
        onClear={handlePickerClear}
      />

      {/* Fitguide Picker */}
      <FitguidePicker
        open={activePicker?.pickerType === "page_fitguide"}
        onOpenChange={(open) => !open && setActivePicker(null)}
        fitguidePages={fitguidePages}
        selectedId={
          activePicker?.pickerType === "page_fitguide"
            ? getCellValue(activePicker.product, activePicker.field) || null
            : null
        }
        onSelect={handlePickerSelect}
        onClear={handlePickerClear}
        product={activePicker?.product || null}
        allProducts={products || []}
      />

      {/* Collection Picker */}
      <CollectionPicker
        open={activePicker?.pickerType === "collection"}
        onOpenChange={(open) => !open && setActivePicker(null)}
        collections={collections}
        selectedId={
          activePicker?.pickerType === "collection"
            ? getCellValue(activePicker.product, activePicker.field) || null
            : null
        }
        onSelect={handlePickerSelect}
        onClear={handlePickerClear}
      />

      {/* Model Picker */}
      <ModelPicker
        open={activePicker?.pickerType === "metaobject"}
        onOpenChange={(open) => !open && setActivePicker(null)}
        models={models}
        currentValue={
          activePicker?.pickerType === "metaobject"
            ? getCellValue(activePicker.product, activePicker.field) || null
            : null
        }
        onSelect={handlePickerSelect}
        onClear={handlePickerClear}
      />
    </div>
  );
}
