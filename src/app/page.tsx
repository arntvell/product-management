"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  applyDirtyCellsToProducts,
} from "@/hooks/use-metafield-mutation";
import { ProductTable } from "@/components/products/product-table";
import { ProductFilters } from "@/components/products/product-filters";
import { ColumnPicker } from "@/components/products/column-picker";
import { FitguideAutoLink } from "@/components/products/fitguide-auto-link";
import { FindReplaceDialog } from "@/components/products/find-replace-dialog";
import { CarePicker } from "@/components/pickers/care-picker";
import { FitguidePicker } from "@/components/pickers/fitguide-picker";
import { CollectionPicker } from "@/components/pickers/collection-picker";
import { ModelPicker } from "@/components/pickers/model-picker";
import { Button } from "@/components/ui/button";
import type { DirtyCell, DirtyProductProp, MetafieldKey, Product } from "@/types";

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
    setSort,
  } = useProductSearch(products);
  const { pages, carePages, fitguidePages } = usePages();
  const { collections } = useCollections();
  const { models } = useModels();
  const { visibleKeys, visibleColumns, toggleColumn, resetToDefaults, showAll } =
    useColumnVisibility();
  const queryClient = useQueryClient();
  const mutation = useMetafieldMutation();
  const [dirtyCells, setDirtyCells] = useState<Map<string, DirtyCell>>(new Map());
  const [dirtyProductProps, setDirtyProductProps] = useState<Map<string, DirtyProductProp>>(new Map());
  const [saveProgress, setSaveProgress] = useState<{ completed: number; total: number } | null>(null);
  const abortRef = useRef(false);
  const [activePicker, setActivePicker] = useState<ActivePicker | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);

  const totalDirtyCount = dirtyCells.size + dirtyProductProps.size;

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    if (totalDirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [totalDirtyCount]);

  const handleCellChange = useCallback(
    (productId: string, field: MetafieldKey, value: string) => {
      setDirtyCells((prev) => {
        const next = new Map(prev);
        const key = `${productId}:${field}`;
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

  const handleProductPropChange = useCallback(
    (productId: string, field: "tags" | "status" | "vendor", value: string | string[]) => {
      setDirtyProductProps((prev) => {
        const next = new Map(prev);
        const existing = next.get(productId) ?? { productId };
        const updated: DirtyProductProp = { ...existing, [field]: value };

        // Remove if reverted to original
        const product = products?.find((p) => p.id === productId);
        if (product) {
          if (updated.tags !== undefined) {
            const orig = [...product.tags].sort().join(",");
            const curr = [...updated.tags].sort().join(",");
            if (orig === curr) delete updated.tags;
          }
          if (updated.status !== undefined && updated.status === product.status) {
            delete updated.status;
          }
          if (updated.vendor !== undefined && updated.vendor === product.vendor) {
            delete updated.vendor;
          }
        }

        const hasChanges = updated.tags !== undefined || updated.status !== undefined || updated.vendor !== undefined;
        if (hasChanges) {
          next.set(productId, updated);
        } else {
          next.delete(productId);
        }

        return next;
      });
    },
    [products]
  );

  const saveProductProps = useCallback(async (): Promise<string[]> => {
    if (dirtyProductProps.size === 0) return [];

    const updates = [...dirtyProductProps.values()].map((prop) => {
      const u: Record<string, unknown> = { productId: prop.productId };
      if (prop.tags !== undefined) u.tags = prop.tags;
      if (prop.status !== undefined) u.status = prop.status;
      if (prop.vendor !== undefined) u.vendor = prop.vendor;
      return u;
    });

    const res = await fetch("/api/product-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });

    if (!res.ok) throw new Error(`Product update failed: ${res.statusText}`);
    const data = await res.json();
    return data.errors ?? [];
  }, [dirtyProductProps]);

  const handleSaveAll = useCallback(async () => {
    if (totalDirtyCount === 0) return;

    const updates = dirtyCellsToUpdates(dirtyCells);
    const total = updates.length + (dirtyProductProps.size > 0 ? 1 : 0);

    abortRef.current = false;
    if (total > 1) setSaveProgress({ completed: 0, total });

    const errors: string[] = [];

    // Save metafields
    for (let i = 0; i < updates.length; i++) {
      if (abortRef.current) break;
      try {
        const result = await mutation.mutateAsync([updates[i]]);
        if (!result.success) errors.push(...result.errors);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Unknown error");
      }
      if (total > 1) setSaveProgress({ completed: i + 1, total });
    }

    // Save product props (tags, status, vendor)
    if (dirtyProductProps.size > 0 && !abortRef.current) {
      try {
        const propErrors = await saveProductProps();
        errors.push(...propErrors);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : "Unknown error");
      }
      if (total > 1) setSaveProgress({ completed: total, total });
    }

    setSaveProgress(null);

    if (errors.length === 0) {
      // Apply metafield changes optimistically
      queryClient.setQueryData<Product[]>(["products"], (old) =>
        old ? applyDirtyCellsToProducts(old, dirtyCells) : old
      );
      setDirtyCells(new Map());
      setDirtyProductProps(new Map());
      // Refetch after short delay to get server-confirmed values
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["products"] }), 3000);
      toast.success(`Saved ${totalDirtyCount} change${totalDirtyCount !== 1 ? "s" : ""}`);
    } else {
      toast.error(`Some updates failed: ${errors.join(", ")}`);
    }
  }, [dirtyCells, dirtyProductProps, totalDirtyCount, mutation, queryClient, saveProductProps]);

  const handlePickerSelect = useCallback(
    (id: string) => {
      if (!activePicker) return;
      if (activePicker.pickerType === "metaobject") {
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

  const handleFindReplaceApply = useCallback(
    (replacements: Array<{ productId: string; field: MetafieldKey; value: string }>) => {
      for (const r of replacements) {
        handleCellChange(r.productId, r.field, r.value);
      }
      toast.success(
        `Applied ${replacements.length} replacement${replacements.length !== 1 ? "s" : ""} — save to commit`
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
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFindReplaceOpen(true)}
            >
              Find & Replace
            </Button>
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
        dirtyProductProps={dirtyProductProps}
        onCellChange={handleCellChange}
        onProductPropChange={handleProductPropChange}
        onSaveAll={handleSaveAll}
        isSaving={mutation.isPending}
        dirtyCount={totalDirtyCount}
        saveProgress={saveProgress}
        pages={pages}
        carePages={carePages}
        fitguidePages={fitguidePages}
        collections={collections}
        models={models}
        onOpenPicker={setActivePicker}
        visibleColumns={visibleColumns}
        selectedIds={selectedIds}
        onSelectedIdsChange={setSelectedIds}
        sortKey={filters.sortKey}
        sortDir={filters.sortDir}
        onSort={setSort}
        allTags={tags}
        allVendors={vendors}
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

      {/* Find & Replace */}
      <FindReplaceDialog
        open={findReplaceOpen}
        onOpenChange={setFindReplaceOpen}
        products={products || []}
        dirtyCells={dirtyCells}
        onApply={handleFindReplaceApply}
      />
    </div>
  );
}
