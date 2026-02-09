"use client";

import { Button } from "@/components/ui/button";
import type { Model } from "@/types";

interface ModelListProps {
  models: Model[];
  onEdit: (model: Model) => void;
  onDelete: (model: Model) => void;
  isDeleting: boolean;
}

export function ModelList({
  models,
  onEdit,
  onDelete,
  isDeleting,
}: ModelListProps) {
  if (models.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground py-12">
        No models found. Create one to get started.
      </p>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {models.map((model) => (
        <div key={model.id} className="border rounded-lg p-4 space-y-2">
          <div className="flex items-start justify-between">
            <h3 className="font-medium">{model.fields.name}</h3>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            {model.fields.height && <p>Height: {model.fields.height}</p>}
            {model.fields.size_worn && (
              <p>Size worn: {model.fields.size_worn}</p>
            )}
            {model.fields.notes && (
              <p className="text-xs truncate">{model.fields.notes}</p>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onEdit(model)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onDelete(model)}
              disabled={isDeleting}
            >
              Delete
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
