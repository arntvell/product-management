"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { upload } from "@vercel/blob/client";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { catalogImageSrc } from "@/lib/catalog-image";
import { cn } from "@/lib/utils";

export interface MediaItem {
  id: string;
  url: string;
  source: "BLOB" | "SHOPIFY" | "THREADFLOW" | "EXTERNAL";
  alt: string | null;
  position: number;
}

const SOURCE_LABEL: Record<MediaItem["source"], string> = {
  BLOB: "Owned",
  SHOPIFY: "Shopify",
  THREADFLOW: "Threadflow",
  EXTERNAL: "External",
};

export function MediaManager({
  colorwayId,
  colorwayName,
  styleId,
  initialMedia,
}: {
  colorwayId: string;
  colorwayName: string;
  styleId: string;
  initialMedia: MediaItem[];
}) {
  const [items, setItems] = useState<MediaItem[]>(initialMedia);
  const [uploading, setUploading] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setUploading(true);
      try {
        for (const file of files) {
          const blob = await upload(
            `colorways/${colorwayId}/${crypto.randomUUID()}-${file.name}`,
            file,
            {
              access: "public",
              handleUploadUrl: "/api/catalog/media/token",
              clientPayload: JSON.stringify({ colorwayId }),
            }
          );
          const res = await fetch("/api/catalog/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              colorwayId,
              url: blob.url,
              blobPathname: blob.pathname,
            }),
          });
          const asset = await res.json();
          if (!res.ok) throw new Error(asset.error ?? "Upload failed");
          setItems((prev) => [...prev, asset]);
        }
        toast.success("Uploaded");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploading(false);
      }
    },
    [colorwayId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "image/*": [] },
    disabled: uploading,
  });

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    try {
      await fetch("/api/catalog/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ colorwayId, orderedIds: next.map((i) => i.id) }),
      });
    } catch {
      toast.error("Couldn't save order");
    }
  }

  async function remove(id: string) {
    const prev = items;
    setItems((p) => p.filter((i) => i.id !== id));
    const res = await fetch(`/api/catalog/media/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setItems(prev);
      toast.error("Delete failed");
    }
  }

  async function adopt(id: string) {
    try {
      const res = await fetch(`/api/catalog/media/${id}/adopt`, { method: "POST" });
      const asset = await res.json();
      if (!res.ok) throw new Error(asset.error ?? "Adopt failed");
      setItems((prev) => prev.map((i) => (i.id === id ? asset : i)));
      toast.success("Adopted into Blob");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Adopt failed");
    }
  }

  const externalCount = items.filter((i) => i.source !== "BLOB").length;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <a
        href={`/catalog/colorways/${colorwayId}`}
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        ← {colorwayName}
      </a>
      <h1 className="mt-1 text-2xl font-semibold">Media</h1>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          "mt-6 cursor-pointer rounded-lg border-2 border-dashed p-8 text-center text-sm transition-colors",
          isDragActive ? "border-foreground bg-muted/50" : "border-muted-foreground/30",
          uploading && "pointer-events-none opacity-60"
        )}
      >
        <input {...getInputProps()} />
        {uploading
          ? "Uploading…"
          : isDragActive
            ? "Drop images to upload"
            : "Drag images here, or click to select. Uploads go to Blob (owned by the master)."}
      </div>

      {externalCount > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {externalCount} image{externalCount !== 1 ? "s" : ""} referenced from
          an external source. Adopt them into Blob so the master owns them
          (required before a Loom push).
        </p>
      )}

      {/* Sortable gallery */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((item) => (
              <SortableTile
                key={item.id}
                item={item}
                onRemove={() => remove(item.id)}
                onAdopt={() => adopt(item.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {items.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">No media yet.</p>
      )}

      <a
        href={`/catalog/styles/${styleId}`}
        className="mt-8 inline-block text-sm text-muted-foreground underline underline-offset-4"
      >
        Back to style
      </a>
    </div>
  );
}

function SortableTile({
  item,
  onRemove,
  onAdopt,
}: {
  item: MediaItem;
  onRemove: () => void;
  onAdopt: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const src = catalogImageSrc(item.url);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-muted",
        isDragging && "z-10 opacity-80 shadow-lg"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="aspect-square cursor-grab active:cursor-grabbing"
      >
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={item.alt ?? ""} className="h-full w-full object-cover" />
        )}
      </div>

      <span
        className={cn(
          "absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium",
          item.source === "BLOB"
            ? "bg-green-600/90 text-white"
            : "bg-background/90 text-muted-foreground"
        )}
      >
        {SOURCE_LABEL[item.source]}
      </span>

      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        {item.source !== "BLOB" && (
          <button
            onClick={onAdopt}
            title="Adopt into Blob"
            className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium hover:bg-background"
          >
            Adopt
          </button>
        )}
        <button
          onClick={onRemove}
          title="Remove"
          className="rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-background"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
