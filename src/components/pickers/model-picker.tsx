"use client";

import { useState, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import type { Model } from "@/types";

interface ModelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  models: Model[];
  currentValue: string | null;
  onSelect: (modelId: string) => void;
  onClear: () => void;
  title?: string;
}

export function ModelPicker({
  open,
  onOpenChange,
  models,
  currentValue,
  onSelect,
  onClear,
  title = "Select a model",
}: ModelPickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter((m) =>
      m.fields.name.toLowerCase().includes(q)
    );
  }, [models, search]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={title}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No models found.</CommandEmpty>
        {currentValue && (
          <CommandGroup heading="Current">
            <CommandItem
              value="__remove_current__"
              onSelect={onClear}
            >
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{currentValue}</p>
                </div>
                <Badge variant="destructive" className="text-xs">
                  Remove
                </Badge>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Models">
          {filtered.map((model) => (
            <CommandItem
              key={model.id}
              value={model.fields.name}
              onSelect={() => onSelect(model.id)}
            >
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{model.fields.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {model.fields.height}
                    {model.fields.size_worn &&
                      ` · ${model.fields.size_worn}`}
                  </p>
                </div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
