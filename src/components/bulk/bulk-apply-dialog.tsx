"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { MetafieldKey, ShopifyPage, ShopifyCollection, Model } from "@/types";

interface BulkApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onApply: (field: MetafieldKey, value: string) => void;
  carePages?: ShopifyPage[];
  fitguidePages?: ShopifyPage[];
  collections?: ShopifyCollection[];
  models?: Model[];
}

// Fields that can be bulk-applied (exclude list types handled by other UIs)
const BULK_FIELDS = METAFIELD_DEFINITIONS.filter(
  (d) =>
    d.type !== "list.product_reference" &&
    d.type !== "list.file_reference" &&
    d.type !== "file_reference"
);

const LARGE_SELECTION_THRESHOLD = 50;

export function BulkApplyDialog({
  open,
  onOpenChange,
  selectedCount,
  onApply,
  carePages = [],
  fitguidePages = [],
  collections = [],
  models = [],
}: BulkApplyDialogProps) {
  const [field, setField] = useState<MetafieldKey>(BULK_FIELDS[0].key);
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const selectedFieldDef = BULK_FIELDS.find((d) => d.key === field);
  const fieldType = selectedFieldDef?.type;

  const needsConfirmation =
    selectedCount >= LARGE_SELECTION_THRESHOLD && !confirmed;

  const handleApply = () => {
    if (needsConfirmation) {
      setConfirmed(true);
      return;
    }
    onApply(field, value);
    setValue("");
    setConfirmed(false);
    onOpenChange(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setConfirmed(false);
      setValue("");
    }
    onOpenChange(next);
  };

  const handleFieldChange = (v: string) => {
    setField(v as MetafieldKey);
    setValue("");
  };

  const displayValue = getDisplayValue(value, field, carePages, fitguidePages, collections, models);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk Apply Value</DialogTitle>
        </DialogHeader>

        {confirmed ? (
          <div className="space-y-4 py-4">
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-4 space-y-2">
              <p className="text-sm font-medium">
                Are you sure you want to update {selectedCount} products?
              </p>
              <p className="text-xs text-muted-foreground">
                This will set <strong>{selectedFieldDef?.label}</strong> to{" "}
                <strong>{displayValue}</strong> for all {selectedCount} selected
                products.
              </p>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmed(false)}
              >
                Back
              </Button>
              <Button
                onClick={() => {
                  onApply(field, value);
                  setValue("");
                  setConfirmed(false);
                  onOpenChange(false);
                }}
              >
                Confirm &amp; Apply to {selectedCount} Products
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Apply a value to {selectedCount} selected product
              {selectedCount !== 1 ? "s" : ""}.
            </p>
            <div className="space-y-4 py-4">
              <div>
                <Label>Metafield</Label>
                <Select value={field} onValueChange={handleFieldChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BULK_FIELDS.map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Value</Label>
                {fieldType === "page_reference" && field === "care_page" ? (
                  <ReferenceList
                    items={carePages.map((p) => ({ id: p.id, label: p.title }))}
                    selectedId={value}
                    onSelect={setValue}
                    emptyText="No care pages available"
                  />
                ) : fieldType === "page_reference" && field === "fitguide" ? (
                  <ReferenceList
                    items={fitguidePages.map((p) => ({ id: p.id, label: p.title }))}
                    selectedId={value}
                    onSelect={setValue}
                    emptyText="No fitguide pages available"
                  />
                ) : fieldType === "collection_reference" ? (
                  <ReferenceList
                    items={collections.map((c) => ({ id: c.id, label: c.title }))}
                    selectedId={value}
                    onSelect={setValue}
                    emptyText="No collections available"
                  />
                ) : fieldType === "single_line_text_field" && field === "model_info" ? (
                  <ReferenceList
                    items={models.map((m) => ({
                      id: `Model is ${m.fields.height} tall and wearing a size ${m.fields.size_worn}`,
                      label: `${m.fields.name} (${m.fields.height}, size ${m.fields.size_worn})`,
                    }))}
                    selectedId={value}
                    onSelect={setValue}
                    emptyText="No models available"
                  />
                ) : (
                  <Textarea
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter value to apply..."
                    className="min-h-[100px]"
                  />
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleApply} disabled={!value}>
                {needsConfirmation
                  ? `Review (${selectedCount} products)`
                  : `Apply to ${selectedCount} Products`}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ReferenceList({
  items,
  selectedId,
  onSelect,
  emptyText,
}: {
  items: { id: string; label: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
  emptyText: string;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="max-h-[200px] overflow-auto rounded-md border">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={cn(
            "w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors border-b last:border-b-0",
            selectedId === item.id && "bg-blue-50 font-medium"
          )}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function getDisplayValue(
  value: string,
  field: MetafieldKey,
  carePages: ShopifyPage[],
  fitguidePages: ShopifyPage[],
  collections: ShopifyCollection[],
  models: Model[]
): string {
  if (!value) return "(empty)";
  if (field === "care_page") {
    return carePages.find((p) => p.id === value)?.title || value;
  }
  if (field === "fitguide") {
    return fitguidePages.find((p) => p.id === value)?.title || value;
  }
  if (field === "recommended_product_from_collection") {
    return collections.find((c) => c.id === value)?.title || value;
  }
  if (field === "model_info") {
    return value;
  }
  return value.length > 80 ? value.slice(0, 80) + "..." : value;
}
