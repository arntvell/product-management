"use client";

import { useState, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { UploadZone } from "./upload-zone";
import { MediaGrid } from "./media-grid";
import {
  useProductMedia,
  useUploadMedia,
  useDeleteMedia,
  useReorderMedia,
} from "@/hooks/use-product-media";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useFileNodes } from "@/hooks/use-file-nodes";
import { parseGidList, serializeGidList } from "@/lib/utils";
import type { MediaColumnKey } from "@/lib/media-columns";
import type { Product, MediaItem } from "@/types";

interface MediaDetailPanelProps {
  product: Product | null;
  columnKey: MediaColumnKey | null;
  isOpen: boolean;
  onClose: () => void;
  onMetafieldSave: (
    productId: string,
    field: "men_images" | "women_images",
    value: string
  ) => void;
}

export function MediaDetailPanel({
  product,
  columnKey,
  isOpen,
  onClose,
  onMetafieldSave,
}: MediaDetailPanelProps) {
  if (!product || !columnKey) {
    return (
      <Sheet open={false} onOpenChange={() => {}}>
        <SheetContent side="right" className="w-[600px] sm:max-w-[600px]" />
      </Sheet>
    );
  }

  if (columnKey === "product_media") {
    return (
      <ProductMediaPanel
        product={product}
        isOpen={isOpen}
        onClose={onClose}
      />
    );
  }

  return (
    <FileRefPanel
      product={product}
      columnKey={columnKey}
      isOpen={isOpen}
      onClose={onClose}
      onMetafieldSave={onMetafieldSave}
    />
  );
}

// --- Product Media panel ---

function ProductMediaPanel({
  product,
  isOpen,
  onClose,
}: {
  product: Product;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data: media, isLoading } = useProductMedia(
    isOpen ? product.id : null
  );
  const uploadMutation = useUploadMedia();
  const deleteMutation = useDeleteMedia();
  const reorderMutation = useReorderMedia();
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  const handleFilesAccepted = useCallback(
    async (files: File[]) => {
      const uploadFiles = files.map((f) => ({
        filename: f.name,
        mimeType: f.type,
        fileSize: f.size,
        file: f,
      }));

      setUploadProgress({ completed: 0, total: files.length });

      try {
        await uploadMutation.mutateAsync({
          productId: product.id,
          files: uploadFiles,
          onProgress: (completed, total) => {
            setUploadProgress({ completed, total });
          },
        });
        toast.success(
          `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Upload failed"
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [product.id, uploadMutation]
  );

  const handleDelete = useCallback(
    async (mediaIds: string[]) => {
      try {
        await deleteMutation.mutateAsync({
          productId: product.id,
          mediaIds,
        });
        toast.success(
          `Deleted ${mediaIds.length} item${mediaIds.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Delete failed"
        );
      }
    },
    [product.id, deleteMutation]
  );

  const handleReorder = useCallback(
    async (moves: Array<{ id: string; newPosition: string }>) => {
      try {
        await reorderMutation.mutateAsync({
          productId: product.id,
          moves,
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Reorder failed"
        );
      }
    },
    [product.id, reorderMutation]
  );

  const handleRemoveAll = useCallback(async () => {
    if (!media || media.length === 0) return;
    const ids = media.map((m) => m.id);
    try {
      await deleteMutation.mutateAsync({
        productId: product.id,
        mediaIds: ids,
      });
      toast.success("Removed all media");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Remove all failed"
      );
    }
  }, [product.id, media, deleteMutation]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[600px] sm:max-w-[600px] flex flex-col overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>{product.title}</SheetTitle>
          <SheetDescription>
            Product Media — {media?.length ?? 0} items
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto space-y-4 px-4 pb-4">
          <UploadZone
            onFilesAccepted={handleFilesAccepted}
            isUploading={uploadMutation.isPending}
            progress={uploadProgress}
          />

          {media && media.length > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRemoveAll}
                disabled={deleteMutation.isPending}
              >
                Remove All
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            </div>
          ) : (
            <MediaGrid
              items={media || []}
              onReorder={handleReorder}
              onDelete={handleDelete}
              isDeleting={deleteMutation.isPending}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// --- File Reference panel (Men/Women Images) ---

function FileRefPanel({
  product,
  columnKey,
  isOpen,
  onClose,
  onMetafieldSave,
}: {
  product: Product;
  columnKey: "men_images" | "women_images";
  isOpen: boolean;
  onClose: () => void;
  onMetafieldSave: (
    productId: string,
    field: "men_images" | "women_images",
    value: string
  ) => void;
}) {
  const gids = useMemo(
    () => parseGidList(product.metafields[columnKey]),
    [product.metafields[columnKey]]
  );
  const { data: fileNodes } = useFileNodes(isOpen ? gids : []);
  const fileUpload = useFileUpload();
  const [uploadProgress, setUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);

  // Map file nodes to MediaItem shape for reusing MediaGrid
  const mediaItems: MediaItem[] = useMemo(() => {
    if (!fileNodes) return [];
    // Keep the order from gids
    return gids
      .map((gid) => {
        const node = fileNodes.find((n) => n.id === gid);
        if (!node) return null;
        return {
          id: node.id,
          alt: node.alt || "",
          mediaContentType: "IMAGE",
          image: node.image
            ? { url: node.image.url, width: 0, height: 0 }
            : undefined,
          preview: node.preview,
        } satisfies MediaItem;
      })
      .filter(Boolean) as MediaItem[];
  }, [gids, fileNodes]);

  const label = columnKey === "men_images" ? "Men Images" : "Women Images";

  const handleFilesAccepted = useCallback(
    async (files: File[]) => {
      setUploadProgress({ completed: 0, total: files.length });
      try {
        const newGids = await fileUpload.mutateAsync({
          files,
          onProgress: (completed, total) => {
            setUploadProgress({ completed, total });
          },
        });
        const updatedGids = [...gids, ...newGids];
        onMetafieldSave(product.id, columnKey, serializeGidList(updatedGids));
        toast.success(
          `Uploaded ${files.length} file${files.length !== 1 ? "s" : ""}`
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Upload failed"
        );
      } finally {
        setUploadProgress(null);
      }
    },
    [product.id, columnKey, gids, fileUpload, onMetafieldSave]
  );

  const handleDelete = useCallback(
    (mediaIds: string[]) => {
      const updated = gids.filter((g) => !mediaIds.includes(g));
      onMetafieldSave(product.id, columnKey, serializeGidList(updated));
      toast.success(
        `Deleted ${mediaIds.length} item${mediaIds.length !== 1 ? "s" : ""}`
      );
    },
    [product.id, columnKey, gids, onMetafieldSave]
  );

  const handleReorder = useCallback(
    (moves: Array<{ id: string; newPosition: string }>) => {
      if (moves.length === 0) return;
      const move = moves[0];
      const newPos = parseInt(move.newPosition, 10);
      const reordered = [...gids];
      const oldIdx = reordered.indexOf(move.id);
      if (oldIdx === -1) return;
      reordered.splice(oldIdx, 1);
      reordered.splice(newPos, 0, move.id);
      onMetafieldSave(product.id, columnKey, serializeGidList(reordered));
    },
    [product.id, columnKey, gids, onMetafieldSave]
  );

  const handleRemoveAll = useCallback(() => {
    onMetafieldSave(product.id, columnKey, serializeGidList([]));
    toast.success("Removed all images");
  }, [product.id, columnKey, onMetafieldSave]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[600px] sm:max-w-[600px] flex flex-col overflow-hidden"
      >
        <SheetHeader>
          <SheetTitle>{product.title}</SheetTitle>
          <SheetDescription>
            {label} — {gids.length} items
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto space-y-4 px-4 pb-4">
          <UploadZone
            onFilesAccepted={handleFilesAccepted}
            isUploading={fileUpload.isPending}
            progress={uploadProgress}
          />

          {gids.length > 0 && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRemoveAll}
              >
                Remove All
              </Button>
            </div>
          )}

          <MediaGrid
            items={mediaItems}
            onReorder={handleReorder}
            onDelete={handleDelete}
            isDeleting={false}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
