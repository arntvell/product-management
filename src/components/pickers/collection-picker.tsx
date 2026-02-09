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
import type { ShopifyCollection } from "@/types";

interface CollectionPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  collections: ShopifyCollection[];
  selectedId: string | null;
  onSelect: (collectionId: string) => void;
  onClear: () => void;
  title?: string;
}

export function CollectionPicker({
  open,
  onOpenChange,
  collections,
  selectedId,
  onSelect,
  onClear,
  title = "Select a collection",
}: CollectionPickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return collections.slice(0, 50);
    const q = search.toLowerCase();
    return collections
      .filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.handle.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [collections, search]);

  const selectedCollection = selectedId
    ? collections.find((c) => c.id === selectedId)
    : null;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={title}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No collections found.</CommandEmpty>
        {selectedCollection && (
          <CommandGroup heading="Selected">
            <CommandItem
              value={`selected-${selectedCollection.title}`}
              onSelect={onClear}
            >
              <div className="flex items-center gap-2 w-full">
                {selectedCollection.image && (
                  <img
                    src={selectedCollection.image.url}
                    alt=""
                    className="w-8 h-8 object-cover rounded"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {selectedCollection.title}
                  </p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Selected
                </Badge>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Collections">
          {filtered
            .filter((c) => c.id !== selectedId)
            .map((collection) => (
              <CommandItem
                key={collection.id}
                value={collection.title}
                onSelect={() => onSelect(collection.id)}
              >
                <div className="flex items-center gap-2 w-full">
                  {collection.image && (
                    <img
                      src={collection.image.url}
                      alt=""
                      className="w-8 h-8 object-cover rounded"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{collection.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      /{collection.handle}
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
