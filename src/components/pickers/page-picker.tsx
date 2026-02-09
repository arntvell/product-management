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
import type { ShopifyPage } from "@/types";

interface PagePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pages: ShopifyPage[];
  selectedId: string | null;
  onSelect: (pageId: string) => void;
  onClear: () => void;
  title?: string;
  suggestedId?: string | null;
}

export function PagePicker({
  open,
  onOpenChange,
  pages,
  selectedId,
  onSelect,
  onClear,
  title = "Select a page",
  suggestedId,
}: PagePickerProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return pages.slice(0, 50);
    const q = search.toLowerCase();
    return pages
      .filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.handle.toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [pages, search]);

  const suggestedPage = suggestedId
    ? pages.find((p) => p.id === suggestedId)
    : null;

  const selectedPage = selectedId
    ? pages.find((p) => p.id === selectedId)
    : null;

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={title}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No pages found.</CommandEmpty>
        {selectedPage && (
          <CommandGroup heading="Selected">
            <CommandItem
              value={`selected-${selectedPage.title}`}
              onSelect={onClear}
            >
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{selectedPage.title}</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  Selected
                </Badge>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
        {suggestedPage && suggestedPage.id !== selectedId && (
          <CommandGroup heading="Suggested">
            <CommandItem
              value={`suggested-${suggestedPage.title}`}
              onSelect={() => onSelect(suggestedPage.id)}
            >
              <div className="flex items-center gap-2 w-full">
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{suggestedPage.title}</p>
                </div>
                <Badge className="text-xs bg-blue-100 text-blue-800">
                  Suggested
                </Badge>
              </div>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Pages">
          {filtered
            .filter((p) => p.id !== selectedId && p.id !== suggestedId)
            .map((page) => (
              <CommandItem
                key={page.id}
                value={page.title}
                onSelect={() => onSelect(page.id)}
              >
                <div className="flex items-center gap-2 w-full">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{page.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      /{page.handle}
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
