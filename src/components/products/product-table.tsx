"use client";

import React, { useState, useCallback, useEffect, useRef, type SetStateAction } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { InlineCellEditor } from "./inline-cell-editor";
import { ReferenceCell } from "./reference-cell";
import { FileCell } from "./file-cell";
import { SidePanel } from "./side-panel";
import { ProductSelector } from "./product-selector";
import { BulkToolbar } from "@/components/bulk/bulk-toolbar";
import { BulkApplyDialog } from "@/components/bulk/bulk-apply-dialog";
import { COLUMN_DEFINITIONS } from "@/lib/columns";
import type { ColumnDef } from "@/lib/columns";
import { parseGidList, serializeGidList, cn } from "@/lib/utils";
import type {
  DirtyCell,
  MetafieldKey,
  Product,
  ShopifyPage,
  ShopifyCollection,
  Model,
} from "@/types";

const ROW_HEIGHT = 40;

type PickerType =
  | "product"
  | "page_care"
  | "page_fitguide"
  | "collection"
  | "metaobject"
  | "file";

interface ActivePicker {
  product: Product;
  field: MetafieldKey;
  pickerType: PickerType;
}

interface ProductTableProps {
  products: Product[];
  allProducts: Product[];
  dirtyCells: Map<string, DirtyCell>;
  onCellChange: (productId: string, field: MetafieldKey, value: string) => void;
  onSaveAll: () => void;
  isSaving: boolean;
  dirtyCount: number;
  saveProgress?: { completed: number; total: number } | null;
  pages?: ShopifyPage[];
  carePages?: ShopifyPage[];
  fitguidePages?: ShopifyPage[];
  collections?: ShopifyCollection[];
  models?: Model[];
  onOpenPicker?: (picker: ActivePicker) => void;
  visibleColumns?: ColumnDef[];
  selectedIds: Set<string>;
  onSelectedIdsChange: (ids: SetStateAction<Set<string>>) => void;
}

// --- Memoized row component ---
interface ProductRowProps {
  product: Product;
  columns: ColumnDef[];
  isSelected: boolean;
  onToggleSelection: (productId: string) => void;
  onTextCellClick: (product: Product, field: MetafieldKey) => void;
  onRefFieldClick: (product: Product, field: MetafieldKey, col: ColumnDef) => void;
  getCellValue: (product: Product, field: MetafieldKey) => string;
  isCellDirty: (productId: string, field: MetafieldKey) => boolean;
  pages?: ShopifyPage[];
  collections?: ShopifyCollection[];
  models?: Model[];
  style: React.CSSProperties;
}

const ProductRow = React.memo(function ProductRow({
  product,
  columns,
  isSelected,
  onToggleSelection,
  onTextCellClick,
  onRefFieldClick,
  getCellValue,
  isCellDirty,
  pages,
  collections,
  models,
  style,
}: ProductRowProps) {
  return (
    <div
      role="row"
      style={style}
      className={cn(
        "border-b hover:bg-muted/30 transition-colors flex",
        isSelected && "bg-blue-50/50"
      )}
    >
      <div role="cell" className="p-2 w-10 shrink-0 flex items-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelection(product.id)}
        />
      </div>
      <div role="cell" className="p-2 w-12 shrink-0 flex items-center">
        {product.featuredImage ? (
          <img
            src={product.featuredImage}
            alt=""
            className="w-8 h-8 object-cover rounded"
          />
        ) : (
          <div className="w-8 h-8 bg-muted rounded" />
        )}
      </div>
      <div role="cell" className="p-2 min-w-[200px] flex-1 flex items-center">
        <span className="text-sm font-medium truncate">{product.title}</span>
      </div>
      <div role="cell" className="p-2 w-[100px] shrink-0 text-sm text-muted-foreground flex items-center">
        {product.vendor}
      </div>
      <div role="cell" className="p-2 w-[80px] shrink-0 text-sm text-muted-foreground flex items-center">
        {product.productType}
      </div>
      <div role="cell" className="p-2 w-[90px] shrink-0 text-sm text-muted-foreground flex items-center">
        <span
          className={cn(
            "text-xs px-1.5 py-0.5 rounded",
            product.status === "ACTIVE" && "bg-green-100 text-green-800",
            product.status === "DRAFT" && "bg-yellow-100 text-yellow-800",
            product.status === "ARCHIVED" && "bg-gray-100 text-gray-800"
          )}
        >
          {product.status}
        </span>
      </div>
      {columns.map((col) => {
        const isVisible = !col.visibilityPredicate || col.visibilityPredicate(product);

        if (col.renderType === "text") {
          return (
            <div
              role="cell"
              key={col.key}
              className="border-l"
              style={{ minWidth: col.minWidth, flex: 1 }}
            >
              <InlineCellEditor
                value={getCellValue(product, col.key)}
                isDirty={isCellDirty(product.id, col.key)}
                onClick={() => onTextCellClick(product, col.key)}
              />
            </div>
          );
        }

        if (col.renderType === "ref_file") {
          return (
            <div
              role="cell"
              key={col.key}
              className="border-l"
              style={{ minWidth: col.minWidth, flex: 1 }}
            >
              <FileCell
                value={getCellValue(product, col.key)}
                isDirty={isCellDirty(product.id, col.key)}
                onClick={() => onRefFieldClick(product, col.key, col)}
              />
            </div>
          );
        }

        return (
          <div
            role="cell"
            key={col.key}
            className="border-l"
            style={{ minWidth: col.minWidth, flex: 1 }}
          >
            <ReferenceCell
              value={getCellValue(product, col.key)}
              renderType={col.renderType}
              isDirty={isCellDirty(product.id, col.key)}
              disabled={!isVisible}
              onClick={() => onRefFieldClick(product, col.key, col)}
              pages={pages}
              collections={collections}
              models={models}
            />
          </div>
        );
      })}
    </div>
  );
});

export function ProductTable({
  products,
  allProducts,
  dirtyCells,
  onCellChange,
  onSaveAll,
  isSaving,
  dirtyCount,
  saveProgress,
  pages,
  carePages,
  fitguidePages,
  collections,
  models,
  onOpenPicker,
  visibleColumns,
  selectedIds,
  onSelectedIdsChange,
}: ProductTableProps) {
  const columns = visibleColumns || COLUMN_DEFINITIONS;
  // Fixed columns: checkbox(40) + image(48) + title(200) + vendor(100) + type(80) + status(90) = 558
  const dynamicMinWidth = 558 + columns.reduce((sum, c) => sum + c.minWidth, 0);
  const [sidePanel, setSidePanel] = useState<{
    product: Product;
    field: MetafieldKey;
  } | null>(null);
  const [productSelector, setProductSelector] = useState<{
    product: Product;
    field: MetafieldKey;
  } | null>(null);
  const [bulkApplyOpen, setBulkApplyOpen] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirtyCount > 0) onSaveAll();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dirtyCount, onSaveAll]);

  const getCellValue = useCallback(
    (product: Product, field: MetafieldKey): string => {
      const dirtyKey = `${product.id}:${field}`;
      const dirty = dirtyCells.get(dirtyKey);
      return dirty ? dirty.value : product.metafields[field];
    },
    [dirtyCells]
  );

  const isCellDirty = useCallback(
    (productId: string, field: MetafieldKey): boolean => {
      return dirtyCells.has(`${productId}:${field}`);
    },
    [dirtyCells]
  );

  const toggleSelection = useCallback((productId: string) => {
    onSelectedIdsChange((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    onSelectedIdsChange((prev) => {
      if (prev.size === products.length) return new Set();
      return new Set(products.map((p) => p.id));
    });
  }, [products]);

  const handleBulkApply = useCallback(
    (field: MetafieldKey, value: string) => {
      for (const id of selectedIds) {
        onCellChange(id, field, value);
      }
    },
    [selectedIds, onCellChange]
  );

  const handleApplyToSelected = useCallback(
    (field: MetafieldKey, value: string) => {
      for (const id of selectedIds) {
        onCellChange(id, field, value);
      }
    },
    [selectedIds, onCellChange]
  );

  const handleCopyDown = useCallback(
    (fields: MetafieldKey[]) => {
      if (selectedIds.size < 2 || fields.length === 0) return;

      // Find the first selected product in display order
      const sourceProduct = products.find((p) => selectedIds.has(p.id));
      if (!sourceProduct) return;

      const otherIds = [...selectedIds].filter((id) => id !== sourceProduct.id);

      for (const field of fields) {
        const value = getCellValue(sourceProduct, field);
        for (const id of otherIds) {
          onCellChange(id, field, value);
        }
      }

      toast.success(
        `Copied ${fields.length} field${fields.length !== 1 ? "s" : ""} from ${sourceProduct.title} to ${otherIds.length} product${otherIds.length !== 1 ? "s" : ""}`
      );
    },
    [selectedIds, products, getCellValue, onCellChange]
  );

  const handleTextCellClick = useCallback(
    (product: Product, field: MetafieldKey) => {
      setSidePanel({ product, field });
    },
    []
  );

  const handleRefFieldClick = useCallback(
    (product: Product, field: MetafieldKey, col: ColumnDef) => {
      // Check visibility
      if (col.visibilityPredicate && !col.visibilityPredicate(product)) return;

      // Determine picker type
      let pickerType: PickerType;
      switch (col.renderType) {
        case "ref_product":
          pickerType = "product";
          break;
        case "ref_page":
          pickerType = field === "care_page" ? "page_care" : "page_fitguide";
          break;
        case "ref_collection":
          pickerType = "collection";
          break;
        case "ref_metaobject":
          pickerType = "metaobject";
          break;
        case "ref_file":
          pickerType = "file";
          break;
        default:
          return;
      }

      if (pickerType === "product") {
        setProductSelector({ product, field });
      } else if (onOpenPicker) {
        onOpenPicker({ product, field, pickerType });
      }
    },
    [onOpenPicker]
  );

  const handleProductSelectorSelect = useCallback(
    (productId: string) => {
      if (!productSelector) return;
      const current = parseGidList(
        getCellValue(productSelector.product, productSelector.field)
      );
      if (!current.includes(productId)) {
        onCellChange(
          productSelector.product.id,
          productSelector.field,
          serializeGidList([...current, productId])
        );
      }
    },
    [productSelector, getCellValue, onCellChange]
  );

  const handleProductSelectorDeselect = useCallback(
    (productId: string) => {
      if (!productSelector) return;
      const current = parseGidList(
        getCellValue(productSelector.product, productSelector.field)
      );
      onCellChange(
        productSelector.product.id,
        productSelector.field,
        serializeGidList(current.filter((id) => id !== productId))
      );
    },
    [productSelector, getCellValue, onCellChange]
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-col h-full">
      <BulkToolbar
        selectedCount={selectedIds.size}
        onClearSelection={() => onSelectedIdsChange(new Set())}
        onBulkApply={() => setBulkApplyOpen(true)}
        onCopyDown={handleCopyDown}
        columns={columns}
      />

      {dirtyCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-yellow-50 border-b">
          <span className="text-sm">
            {dirtyCount} unsaved change{dirtyCount !== 1 ? "s" : ""}
          </span>
          <Button size="sm" onClick={onSaveAll} disabled={isSaving}>
            {isSaving
              ? saveProgress
                ? `Saving ${saveProgress.completed}/${saveProgress.total}...`
                : "Saving..."
              : "Save All Changes"}
          </Button>
          {saveProgress && (
            <div className="flex-1 max-w-xs h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{
                  width: `${(saveProgress.completed / saveProgress.total) * 100}%`,
                }}
              />
            </div>
          )}
          <span className="text-xs text-muted-foreground">Cmd+S</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-x-auto">
        <div style={{ minWidth: `${dynamicMinWidth}px` }} className="h-full flex flex-col">
          {/* Sticky header */}
          <div className="bg-muted/80 backdrop-blur-sm z-10 flex border-b">
            <div className="w-10 p-2 shrink-0">
              <Checkbox
                checked={
                  selectedIds.size === products.length &&
                  products.length > 0
                }
                onCheckedChange={toggleSelectAll}
              />
            </div>
            <div className="w-12 p-2 shrink-0" />
            <div className="p-2 text-left text-sm font-medium min-w-[200px] flex-1">
              Title
            </div>
            <div className="p-2 text-left text-sm font-medium w-[100px] shrink-0">
              Vendor
            </div>
            <div className="p-2 text-left text-sm font-medium w-[80px] shrink-0">
              Type
            </div>
            <div className="p-2 text-left text-sm font-medium w-[90px] shrink-0">
              Status
            </div>
            {columns.map((col) => (
              <div
                key={col.key}
                className="p-2 text-left text-sm font-medium"
                style={{ minWidth: col.minWidth, flex: 1 }}
              >
                {col.label}
              </div>
            ))}
          </div>

          {/* Virtualized body */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
          >
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualItems.map((virtualRow) => {
                const product = products[virtualRow.index];
                return (
                  <ProductRow
                    key={product.id}
                    product={product}
                    columns={columns}
                    isSelected={selectedIds.has(product.id)}
                    onToggleSelection={toggleSelection}
                    onTextCellClick={handleTextCellClick}
                    onRefFieldClick={handleRefFieldClick}
                    getCellValue={getCellValue}
                    isCellDirty={isCellDirty}
                    pages={pages}
                    collections={collections}
                    models={models}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <SidePanel
        product={sidePanel?.product || null}
        field={sidePanel?.field || null}
        isOpen={!!sidePanel}
        onClose={() => setSidePanel(null)}
        onSave={(productId, field, value) =>
          onCellChange(productId, field, value)
        }
        currentValue={
          sidePanel
            ? getCellValue(sidePanel.product, sidePanel.field)
            : ""
        }
        selectedCount={selectedIds.size}
        onApplyToSelected={handleApplyToSelected}
      />

      <ProductSelector
        open={!!productSelector}
        onOpenChange={(open) => !open && setProductSelector(null)}
        products={allProducts}
        selectedIds={
          productSelector
            ? parseGidList(
                getCellValue(productSelector.product, productSelector.field)
              )
            : []
        }
        onSelect={handleProductSelectorSelect}
        onDeselect={handleProductSelectorDeselect}
        title={
          productSelector
            ? `Select ${(columns.find((d) => d.key === productSelector.field) || COLUMN_DEFINITIONS.find((d) => d.key === productSelector.field))?.label} for ${productSelector.product.title}`
            : undefined
        }
      />

      <BulkApplyDialog
        open={bulkApplyOpen}
        onOpenChange={setBulkApplyOpen}
        selectedCount={selectedIds.size}
        onApply={handleBulkApply}
        carePages={carePages}
        fitguidePages={fitguidePages}
        collections={collections}
        models={models}
      />
    </div>
  );
}
