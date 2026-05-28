"use client";

import { useState, useRef } from "react";
import { X, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface TagsCellProps {
  tags: string[];
  isDirty?: boolean;
  onChange: (tags: string[]) => void;
  allTags?: string[];
}

export function TagsCell({ tags, isDirty, onChange, allTags = [] }: TagsCellProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = allTags.filter(
    (t) => !tags.includes(t) && t.toLowerCase().includes(input.toLowerCase())
  );

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput("");
    inputRef.current?.focus();
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      addTag(input);
    }
    if (e.key === "Backspace" && !input && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "h-full w-full px-2 flex items-center gap-1 cursor-pointer overflow-hidden",
            isDirty && "bg-yellow-50"
          )}
        >
          {tags.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <div className="flex gap-1 flex-wrap overflow-hidden max-h-[32px]">
              {tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0"
                >
                  {tag}
                </span>
              ))}
              {tags.length > 3 && (
                <span className="text-xs text-muted-foreground shrink-0">
                  +{tags.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-2" align="start">
        <p className="text-sm font-medium">Edit Tags</p>
        <div className="flex flex-wrap gap-1.5 min-h-[24px]">
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 text-xs bg-muted px-1.5 py-0.5 rounded"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add tag..."
            className="h-7 text-xs"
          />
          <button
            type="button"
            disabled={!input.trim()}
            onClick={() => addTag(input)}
            className="p-1 rounded border hover:bg-muted disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {input && suggestions.length > 0 && (
          <div className="border rounded text-xs divide-y max-h-32 overflow-auto">
            {suggestions.slice(0, 8).map((s) => (
              <button
                key={s}
                type="button"
                className="w-full text-left px-2 py-1 hover:bg-muted"
                onClick={() => addTag(s)}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Press Enter or comma to add
        </p>
      </PopoverContent>
    </Popover>
  );
}
