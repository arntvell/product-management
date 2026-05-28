"use client";

import React, { useState, useCallback, useEffect, useRef, type SetStateAction } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { InlineCellEditor } from "./inline-cell-editor";
import { ReferenceCell } from "./reference-cell";
import { FileCell } from "./file-cell";
import { SidePanel } from "./side-panel";
import { ProductSelector } from "./product-selector";
import { BulkToolbar } from "@/components/bulk/bulk-toolbar";
import { BulkApplyDialog } from "@/components/bulk/bulk-apply-dialog";
import { TagsCell } from "./tags-cell";
import { COLUMN_DEFINITIONS } from "@/lib/columns";
import type { ColumnDef } from "@/lib/columns";
import type { SortKey } from "@/hooks/use-product-search";
import { parseGidList, serializeGidList, cn } from "@/lib/utils";
import type {
  DirtyCell,
  DirtyProductProp,
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
  dirtyProductProps: Map<string, DirtyProductProp>;
  onCellChange: (productId: string, field: MetafieldKey, value: string) => void;
  onProductPropChange: (
    productId: string,
    field: "tags" | "status" | "vendor",
    value: string | string[]
  ) => void;
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
  sortKey?: SortKey | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: SortKey) => void;
  allTags?: string[];
  allVendors?: string[];
}

// --- Status Dropdown ---
const STATUS_OPTIONS = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;

function StatusCell({
  status,
  isDirty,
  onChange,
}: {
  status: Product["status"];
  isDirty: boolean;
  onChange: (s: Product["status"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const colorClass = {
    ACTIVE: "bg-green-100 text-green-800",
    DRAFT: "bg-yellow-100 text-yellow-800",
    ARCHIVED: "bg-gray-100 text-gray-800",
  }[status];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "h-full w-full px-2 flex items-center cursor-pointer",
            isDirty && "bg-yellow-50"
          )}
        >
          <span className={cn("text-xs px-1.5 py-0.5 rounded", colorClass)}>
            {status}
          </span>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-36 p-1" align="start">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={cn(
              "w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted",
              s === status && "font-medium"
            )}
            onClick={() => {
              onChange(s);
              setOpen(false);
            }}
          >
            {s}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

// --- Vendor Cell ---
function VendorCell({
  vendor,
  isDirty,
  onChange,
  allVendors,
}: {
  vendor: string;
  isDirty: boolean;
  onChange: (v: string) => void;
  allVendors: string[];
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState(vendor);

  const suggestions = allVendors.filter(
    (v) => v.toLowerCase().includes(input.toLowerCase()) && v !== vendor
  );

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setInput(vendor);
      }}
    >
      <PopoverTrigger asChild>
        <div
          className={cn(
            "h-full w-full px-2 flex items-center cursor-pointer text-sm text-muted-foreground truncate",
            isDirty && "bg-yellow-50"
          )}
        >
          {vendor}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2 space-y-2" align="start">
        <input
          className="w-full border rounded px-2 py-1 text-sm outline-none"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) {
              onChange(input.trim());
              setOpen(false);
            }
          }}
          autoFocus
        />
        {suggestions.length > 0 && (
          <div className="border rounded text-xs divide-y max-h-40 overflow-auto">
            {suggestions.map((v) => (
              <button
                key={v}
                type="button"
                className="w-full text-left px-2 py-1 hover:bg-muted"
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
              >
                {v}
              </button>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            size="sm"
            className="h-6 text-xs"
            disabled={!input.trim() || input.trim() === vendor}
            onClick={() => {
              onChange(input.trim());
              setOpen(false);
            }}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// --- Memoized row component ---
interface ProductRowProps {
  product: Product;
  columns: ColumnDef[];
  isSelected: boolean;
  dirtyProp: DirtyProductProp | undefined;
  onToggleSelection: (productId: string) => void;
  onTextCellClick: (product: Product, field: MetafieldKey) => void;
  onRefFieldClick: (product: Product, field: MetafieldKey, col: ColumnDef) => void;
  onProductPropChange: (
    productId: string,
    field: "tags" | "status" | "vendor",
    value: string | string[]
  ) => void;
  getCellValue: (product: Product, field: MetafieldKey) => string;
  isCellDirty: (productId: string, field: MetafieldKey) => boolean;
  pages?: ShopifyPage[];
  collections?: ShopifyCollection[];
  models?: Model[];
  allTags: string[];
  allVendors: string[];
  style: React.CSSProperties;
}

const ProductRow = React.memo(function ProductRow({
  product,
  columns,
  isSelected,
  dirtyProp,
  onToggleSelection,
  onTextCellClick,
  onRefFieldClick,
  onProductPropChange,
  getCellValue,
  isCellDirty,
  pages,
  collections,
  models,
  allTags,
  allVendors,
  style,
}: ProductRowProps) {
  const displayStatus = dirtyProp?.status ?? product.status;
  const displayVendor = dirtyProp?.vendor ?? product.vendor;
  const displayTags = dirtyProp?.tags ?? product.tags;

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
      {/* Vendor — editable */}
      <div role="cell" className="w-[120px] shrink-0 flex items-center overflow-hidden">
        <VendorCell
          vendor={displayVendor}
          isDirty={!!dirtyProp?.vendor}
          onChange={(v) => onProductPropChange(product.id, "vendor", v)}
          allVendors={allVendors}
        />
      </div>
      <div role="cell" className="p-2 w-[80px] shrink-0 text-sm text-muted-foreground flex items-center">
        {product.productType}
      </div>
      {/* Status — editable */}
      <div role="cell" className="w-[100px] shrink-0 flex items-center overflow-hidden">
        <StatusCell
          status={displayStatus}
          isDirty={!!dirtyProp?.status}
          onChange={(s) => onProductPropChange(product.id, "status", s)}
        />
      </div>
      {/* Tags column */}
      <div role="cell" className="w-[160px] shrink-0 border-l flex items-center overflow-hidden">
        <TagsCell
          tags={displayTags}
          isDirty={!!dirtyProp?.tags}
          onChange={(t) => onProductPropChange(product.id, "tags", t)}
          allTags={allTags}
        />
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

// --- Sort indicator ---
function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey?: SortKey | null; sortDir?: "asc" | "desc" }) {
  if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30 ml-1 inline" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 inline" />
    : <ArrowDown className="h-3 w-3 ml-1 inline" />;
}

export function ProductTable({
  products,
  allProducts,
  dirtyCells,
  dirtyProductProps,
  onCellChange,
  onProductPropChange,
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
  sortKey,
  sortDir,
  onSort,
  allTags = [],
  allVendors = [],
}: ProductTableProps) {
  const columns = visibleColumns || COLUMN_DEFINITIONS;
  // Fixed: checkbox(40) + image(48) + title(200+flex) + vendor(120) + type(80) + status(100) + tags(160) = 748
  const dynamicMinWidth = 748 + columns.reduce((sum, c) => sum + c.minWidth, 0);
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
      if (col.visibilityPredicate && !col.visibilityPredicate(product)) return;

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
                  selectedIds.size === products.length && products.length > 0
                }
                onCheckedChange={toggleSelectAll}
              />
            </div>
            <div className="w-12 p-2 shrink-0" />
            <button
              className="p-2 text-left text-sm font-medium min-w-[200px] flex-1 hover:bg-muted/50 flex items-center"
              onClick={() => onSort?.("title")}
            >
              Title <SortIcon col="title" sortKey={sortKey} sortDir={sortDir} />
            </button>
            <button
              className="p-2 text-left text-sm font-medium w-[120px] shrink-0 hover:bg-muted/50 flex items-center"
              onClick={() => onSort?.("vendor")}
            >
              Vendor <SortIcon col="vendor" sortKey={sortKey} sortDir={sortDir} />
            </button>
            <button
              className="p-2 text-left text-sm font-medium w-[80px] shrink-0 hover:bg-muted/50 flex items-center"
              onClick={() => onSort?.("productType")}
            >
              Type <SortIcon col="productType" sortKey={sortKey} sortDir={sortDir} />
            </button>
            <button
              className="p-2 text-left text-sm font-medium w-[100px] shrink-0 hover:bg-muted/50 flex items-center"
              onClick={() => onSort?.("status")}
            >
              Status <SortIcon col="status" sortKey={sortKey} sortDir={sortDir} />
            </button>
            <div className="p-2 text-left text-sm font-medium w-[160px] shrink-0 border-l">
              Tags
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
          <div ref={scrollContainerRef} className="flex-1 overflow-auto">
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
                    dirtyProp={dirtyProductProps.get(product.id)}
                    onToggleSelection={toggleSelection}
                    onTextCellClick={handleTextCellClick}
                    onRefFieldClick={handleRefFieldClick}
                    onProductPropChange={onProductPropChange}
                    getCellValue={getCellValue}
                    isCellDirty={isCellDirty}
                    pages={pages}
                    collections={collections}
                    models={models}
                    allTags={allTags}
                    allVendors={allVendors}
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
        onSave={(productId, field, value) => onCellChange(productId, field, value)}
        currentValue={
          sidePanel ? getCellValue(sidePanel.product, sidePanel.field) : ""
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
