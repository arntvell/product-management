"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { Model } from "@/types";

interface ModelFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: Model | null;
  onSave: (data: {
    name: string;
    height: string;
    size_worn: string;
    notes: string;
  }) => void;
  isSaving: boolean;
}

export function ModelForm({
  open,
  onOpenChange,
  model,
  onSave,
  isSaving,
}: ModelFormProps) {
  const [name, setName] = useState("");
  const [height, setHeight] = useState("");
  const [sizeWorn, setSizeWorn] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (model) {
      setName(model.fields.name);
      setHeight(model.fields.height);
      setSizeWorn(model.fields.size_worn);
      setNotes(model.fields.notes);
    } else {
      setName("");
      setHeight("");
      setSizeWorn("");
      setNotes("");
    }
  }, [model, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, height, size_worn: sizeWorn, notes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{model ? "Edit Model" : "Create Model"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label htmlFor="model-name">Name</Label>
            <Input
              id="model-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Model name"
              required
            />
          </div>
          <div>
            <Label htmlFor="model-height">Height</Label>
            <Input
              id="model-height"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              placeholder="e.g. 182cm"
            />
          </div>
          <div>
            <Label htmlFor="model-size">Size Worn</Label>
            <Input
              id="model-size"
              value={sizeWorn}
              onChange={(e) => setSizeWorn(e.target.value)}
              placeholder="e.g. M / 32"
            />
          </div>
          <div>
            <Label htmlFor="model-notes">Notes</Label>
            <Textarea
              id="model-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes..."
              className="min-h-[80px]"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name || isSaving}>
              {isSaving ? "Saving..." : model ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
