"use client";

import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface MultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((s) => s !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between min-w-[180px]", className)}
        >
          <span className="flex items-center gap-1 truncate">
            {selected.length === 0 ? (
              <span className="text-muted-foreground">{placeholder}</span>
            ) : selected.length <= 2 ? (
              selected.map((s) => (
                <Badge key={s} variant="secondary" className="text-xs px-1">
                  {s}
                </Badge>
              ))
            ) : (
              <Badge variant="secondary" className="text-xs">
                {selected.length} selected
              </Badge>
            )}
          </span>
          <span className="flex items-center gap-0.5 ml-1 shrink-0">
            {selected.length > 0 && (
              <X
                className="h-3 w-3 opacity-50 hover:opacity-100"
                onClick={clear}
              />
            )}
            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={`Search...`}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No options found.</CommandEmpty>
            <CommandGroup>
              {filtered.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => toggle(option)}
                >
                  <div
                    className={cn(
                      "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                      selected.includes(option)
                        ? "bg-primary text-primary-foreground"
                        : "opacity-50"
                    )}
                  >
                    {selected.includes(option) && (
                      <Check className="h-3 w-3" />
                    )}
                  </div>
                  <span className="truncate">{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
