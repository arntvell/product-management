"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { MediaItem as MediaItemType } from "@/types";

interface MediaItemProps {
  item: MediaItemType;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
}

export function MediaItemCard({
  item,
  isSelected,
  onToggleSelect,
}: MediaItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const imageUrl =
    item.image?.url || item.preview?.image?.url || null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative group border rounded-lg overflow-hidden bg-muted/30",
        isDragging && "opacity-50 z-50",
        isSelected && "ring-2 ring-blue-500"
      )}
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing"
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={item.alt}
            className="w-full aspect-square object-cover"
          />
        ) : (
          <div className="w-full aspect-square flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
      </div>
      <div className="absolute top-2 left-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(item.id)}
          className="bg-white/80 backdrop-blur-sm"
        />
      </div>
      {item.image?.width && item.image?.height && (
        <div className="absolute bottom-1 right-1 text-[10px] bg-black/60 text-white px-1 rounded">
          {item.image.width}x{item.image.height}
        </div>
      )}
    </div>
  );
}
