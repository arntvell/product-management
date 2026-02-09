"use client";

import React, { useState, useCallback, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { MediaCell } from "./media-cell";
import { useFileNodes } from "@/hooks/use-file-nodes";
import { useUploadMedia } from "@/hooks/use-product-media";
import { useFileUpload } from "@/hooks/use-file-upload";
import { parseGidList, serializeGidList, cn } from "@/lib/utils";
import { UNISEX_VENDOR } from "@/lib/constants";
import type { MediaColumnDef, MediaColumnKey } from "@/lib/media-columns";
import type { Product } from "@/types";

const ROW_HEIGHT = 40;

interface MediaTableProps {
  products: Product[];
  columns: MediaColumnDef[];
  onOpenDetail: (product: Product, columnKey: MediaColumnKey) => void;
  onMetafieldSave: (
    productId: string,
    field: "men_images" | "women_images",
    value: string
  ) => void;
}

// --- Row component ---
interface MediaRowProps {
  product: Product;
  columns: MediaColumnDef[];
  isSelected: boolean;
  onToggleSelection: (productId: string) => void;
  onCellClick: (product: Product, columnKey: MediaColumnKey) => void;
  onCellDrop: (product: Product, columnKey: MediaColumnKey, files: File[]) => void;
  uploadingCells: Set<string>;
  thumbnailMap: Map<string, string>;
  style: React.CSSProperties;
}

const MediaRow = React.memo(function MediaRow({
  product,
  columns,
  isSelected,
  onToggleSelection,
  onCellClick,
  onCellDrop,
  uploadingCells,
  thumbnailMap,
  style,
}: MediaRowProps) {
  return (
    <tr
      style={style}
      className={cn(
        "border-b hover:bg-muted/30 transition-colors flex",
        isSelected && "bg-blue-50/50"
      )}
    >
      <td className="p-2 w-10 shrink-0 flex items-center">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelection(product.id)}
        />
      </td>
      <td className="p-2 w-12 shrink-0 flex items-center">
        {product.featuredImage ? (
          <img
            src={product.featuredImage}
            alt=""
            className="w-8 h-8 object-cover rounded"
          />
        ) : (
          <div className="w-8 h-8 bg-muted rounded" />
        )}
      </td>
      <td className="p-2 min-w-[200px] flex-1 flex items-center">
        <span className="text-sm font-medium truncate">{product.title}</span>
      </td>
      <td className="p-2 w-[100px] shrink-0 text-sm text-muted-foreground flex items-center">
        {product.vendor}
      </td>
      <td className="p-2 w-[80px] shrink-0 text-sm text-muted-foreground flex items-center">
        {product.productType}
      </td>
      <td className="p-2 w-[90px] shrink-0 text-sm text-muted-foreground flex items-center">
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
      </td>
      {columns.map((col) => {
        const disabled =
          !!col.visibilityPredicate && !col.visibilityPredicate(product);
        const cellKey = `${product.id}:${col.key}`;

        let thumbnailUrl: string | null = null;
        let count = 0;

        if (!disabled) {
          if (col.key === "product_media") {
            thumbnailUrl = product.featuredImage;
            count = product.mediaCount;
          } else {
            const gids = parseGidList(
              product.metafields[col.key as "men_images" | "women_images"]
            );
            count = gids.length;
            if (gids.length > 0) {
              thumbnailUrl = thumbnailMap.get(gids[0]) || null;
            }
          }
        }

        return (
          <td
            key={col.key}
            className="border-l"
            style={{ minWidth: col.minWidth, flex: 1 }}
          >
            <MediaCell
              product={product}
              columnKey={col.key}
              disabled={disabled}
              thumbnailUrl={thumbnailUrl}
              count={count}
              onDrop={(files) => onCellDrop(product, col.key, files)}
              onClick={() => onCellClick(product, col.key)}
              isUploading={uploadingCells.has(cellKey)}
            />
          </td>
        );
      })}
    </tr>
  );
});

export function MediaTable({
  products,
  columns,
  onOpenDetail,
  onMetafieldSave,
}: MediaTableProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploadingCells, setUploadingCells] = useState<Set<string>>(
    new Set()
  );

  const uploadMediaMutation = useUploadMedia();
  const fileUploadMutation = useFileUpload();

  // Fixed columns width: checkbox(40) + image(48) + title(200) + vendor(100) + type(80) + status(90) = 558
  const dynamicMinWidth =
    558 + columns.reduce((sum, c) => sum + c.minWidth, 0);

  const virtualizer = useVirtualizer({
    count: products.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  // Collect all first-GIDs from unisex products' men/women metafields for batch resolution
  const allFirstGids = useMemo(() => {
    const gidSet = new Set<string>();
    for (const p of products) {
      if (p.vendor !== UNISEX_VENDOR) continue;
      for (const key of ["men_images", "women_images"] as const) {
        const gids = parseGidList(p.metafields[key]);
        if (gids.length > 0) {
          gidSet.add(gids[0]);
        }
      }
    }
    return [...gidSet];
  }, [products]);

  const { data: firstFileNodes } = useFileNodes(allFirstGids);

  const thumbnailMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!firstFileNodes) return map;
    for (const node of firstFileNodes) {
      const url = node.image?.url || node.preview?.image?.url;
      if (url) {
        map.set(node.id, url);
      }
    }
    return map;
  }, [firstFileNodes]);

  const toggleSelection = useCallback((productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === products.length) return new Set();
      return new Set(products.map((p) => p.id));
    });
  }, [products]);

  const handleCellDrop = useCallback(
    async (product: Product, columnKey: MediaColumnKey, files: File[]) => {
      const cellKey = `${product.id}:${columnKey}`;
      setUploadingCells((prev) => new Set(prev).add(cellKey));

      try {
        if (columnKey === "product_media") {
          const uploadFiles = files.map((f) => ({
            filename: f.name,
            mimeType: f.type,
            fileSize: f.size,
            file: f,
          }));
          await uploadMediaMutation.mutateAsync({
            productId: product.id,
            files: uploadFiles,
          });
          toast.success(
            `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""} to ${product.title}`
          );
        } else {
          const newGids = await fileUploadMutation.mutateAsync({ files });
          const field = columnKey as "men_images" | "women_images";
          const currentGids = parseGidList(product.metafields[field]);
          const updatedGids = [...currentGids, ...newGids];
          onMetafieldSave(product.id, field, serializeGidList(updatedGids));
          toast.success(
            `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""} to ${product.title}`
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Upload failed"
        );
      } finally {
        setUploadingCells((prev) => {
          const next = new Set(prev);
          next.delete(cellKey);
          return next;
        });
      }
    },
    [uploadMediaMutation, fileUploadMutation, onMetafieldSave]
  );

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex-1 min-h-0 overflow-x-auto">
      <div
        style={{ minWidth: `${dynamicMinWidth}px` }}
        className="h-full flex flex-col"
      >
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
              className="p-2 text-left text-sm font-medium border-l"
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
                <MediaRow
                  key={product.id}
                  product={product}
                  columns={columns}
                  isSelected={selectedIds.has(product.id)}
                  onToggleSelection={toggleSelection}
                  onCellClick={onOpenDetail}
                  onCellDrop={handleCellDrop}
                  uploadingCells={uploadingCells}
                  thumbnailMap={thumbnailMap}
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
  );
}
