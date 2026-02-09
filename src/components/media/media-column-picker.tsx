"use client";

import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { MEDIA_COLUMN_DEFINITIONS, type MediaColumnKey } from "@/lib/media-columns";

interface MediaColumnPickerProps {
  visibleKeys: Set<MediaColumnKey>;
  onToggle: (key: MediaColumnKey) => void;
  onReset: () => void;
  onShowAll: () => void;
}

export function MediaColumnPicker({
  visibleKeys,
  onToggle,
  onReset,
  onShowAll,
}: MediaColumnPickerProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Settings2 className="h-3.5 w-3.5" />
          Columns
          <span className="text-muted-foreground">
            ({visibleKeys.size}/{MEDIA_COLUMN_DEFINITIONS.length})
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3" align="end">
        <div className="space-y-1">
          <p className="text-sm font-medium mb-2">Toggle columns</p>
          {MEDIA_COLUMN_DEFINITIONS.map((col) => (
            <div key={col.key} className="flex items-center gap-2 py-0.5">
              <Checkbox
                id={`media-col-${col.key}`}
                checked={visibleKeys.has(col.key)}
                onCheckedChange={() => onToggle(col.key)}
              />
              <Label
                htmlFor={`media-col-${col.key}`}
                className="text-sm cursor-pointer flex-1"
              >
                {col.label}
              </Label>
            </div>
          ))}
        </div>
        <Separator className="my-2" />
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={onReset}
          >
            Defaults
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={onShowAll}
          >
            Show All
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
