"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModels, useCreateModel, useUpdateModel, useDeleteModel } from "@/hooks/use-models";
import { ModelList } from "@/components/models/model-list";
import { ModelForm } from "@/components/models/model-form";
import type { Model } from "@/types";

export default function ModelsPage() {
  const { models, isLoading, error } = useModels();
  const createModel = useCreateModel();
  const updateModel = useUpdateModel();
  const deleteModel = useDeleteModel();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);

  const filtered = models.filter((m) => {
    if (!search) return true;
    return m.fields.name.toLowerCase().includes(search.toLowerCase());
  });

  const handleCreate = () => {
    setEditingModel(null);
    setFormOpen(true);
  };

  const handleEdit = (model: Model) => {
    setEditingModel(model);
    setFormOpen(true);
  };

  const handleSave = async (data: {
    name: string;
    height: string;
    size_worn: string;
    notes: string;
  }) => {
    try {
      if (editingModel) {
        await updateModel.mutateAsync({ id: editingModel.id, ...data });
        toast.success("Model updated");
      } else {
        await createModel.mutateAsync(data);
        toast.success("Model created");
      }
      setFormOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save model"
      );
    }
  };

  const handleDelete = async (model: Model) => {
    try {
      await deleteModel.mutateAsync(model.id);
      toast.success("Model deleted");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete model"
      );
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading models...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <div className="text-center space-y-3">
          <p className="text-sm text-destructive">Failed to load models</p>
          <p className="text-xs text-muted-foreground">
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Models</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage model metaobjects for product model info references.
        </p>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button onClick={handleCreate}>Create Model</Button>
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} model{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <ModelList
        models={filtered}
        onEdit={handleEdit}
        onDelete={handleDelete}
        isDeleting={deleteModel.isPending}
      />

      <ModelForm
        open={formOpen}
        onOpenChange={setFormOpen}
        model={editingModel}
        onSave={handleSave}
        isSaving={createModel.isPending || updateModel.isPending}
      />
    </div>
  );
}
