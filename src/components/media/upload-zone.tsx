"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFilesAccepted: (files: File[]) => void;
  isUploading: boolean;
  progress?: { completed: number; total: number } | null;
}

export function UploadZone({
  onFilesAccepted,
  isUploading,
  progress,
}: UploadZoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length > 0) {
        onFilesAccepted(accepted);
      }
    },
    [onFilesAccepted]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"],
    },
    disabled: isUploading,
  });

  return (
    <div
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
        isDragActive
          ? "border-blue-500 bg-blue-50/50"
          : "border-muted-foreground/25 hover:border-muted-foreground/50",
        isUploading && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      {isUploading ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Uploading{progress ? ` ${progress.completed}/${progress.total}` : "..."}
          </p>
          {progress && (
            <div className="max-w-xs mx-auto h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-200"
                style={{
                  width: `${(progress.completed / progress.total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      ) : isDragActive ? (
        <p className="text-sm text-blue-600">Drop files here</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Drag & drop images here, or click to browse
        </p>
      )}
    </div>
  );
}
