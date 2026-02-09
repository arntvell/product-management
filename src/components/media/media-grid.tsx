"use client";

import { useState, useCallback } from "react";
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
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { MediaItemCard } from "./media-item";
import type { MediaItem } from "@/types";

interface MediaGridProps {
  items: MediaItem[];
  onReorder: (moves: Array<{ id: string; newPosition: string }>) => void;
  onDelete: (mediaIds: string[]) => void;
  isDeleting: boolean;
}

export function MediaGrid({
  items,
  onReorder,
  onDelete,
  isDeleting,
}: MediaGridProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = items.findIndex((i) => i.id === active.id);
      const newIndex = items.findIndex((i) => i.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      onReorder([
        { id: active.id as string, newPosition: String(newIndex) },
      ]);
    },
    [items, onReorder]
  );

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    onDelete([...selectedIds]);
    setSelectedIds(new Set());
  }, [selectedIds, onDelete]);

  if (items.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-12">
        No media for this product.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-lg">
          <span className="text-sm">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={isDeleting}
          >
            {isDeleting ? "Deleting..." : "Delete Selected"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {items.map((item) => (
              <MediaItemCard
                key={item.id}
                item={item}
                isSelected={selectedIds.has(item.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
