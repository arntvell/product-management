"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";
import type { MediaColumnKey } from "@/lib/media-columns";
import type { Product } from "@/types";

interface MediaCellProps {
  product: Product;
  columnKey: MediaColumnKey;
  disabled: boolean;
  thumbnailUrl: string | null;
  count: number;
  onDrop: (files: File[]) => void;
  onClick: () => void;
  isUploading?: boolean;
}

export function MediaCell({
  product,
  columnKey,
  disabled,
  thumbnailUrl,
  count,
  onDrop,
  onClick,
  isUploading,
}: MediaCellProps) {
  const handleDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0 && !disabled) {
        onDrop(accepted);
      }
    },
    [onDrop, disabled]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleDrop,
    accept: { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"] },
    disabled: disabled || isUploading,
    noClick: true,
    noDrag: disabled,
  });

  if (disabled) {
    return (
      <div className="flex items-center justify-center h-full px-2 text-xs text-muted-foreground">
        N/A
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex items-center gap-2 h-full px-2 cursor-pointer hover:bg-muted/30 transition-colors",
        isDragActive && "bg-blue-50 ring-1 ring-blue-400",
        isUploading && "opacity-50"
      )}
    >
      <input {...getInputProps()} />
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="w-8 h-8 object-cover rounded shrink-0"
        />
      ) : (
        <div className="w-8 h-8 bg-muted rounded shrink-0 flex items-center justify-center text-muted-foreground text-[10px]">
          —
        </div>
      )}
      <span className="text-xs text-muted-foreground truncate">
        {isUploading ? "Uploading..." : `${count} image${count !== 1 ? "s" : ""}`}
      </span>
    </div>
  );
}
