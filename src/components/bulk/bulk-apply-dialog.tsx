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
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { MetafieldKey } from "@/types";

interface BulkApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onApply: (field: MetafieldKey, value: string) => void;
}

const TEXT_FIELDS = METAFIELD_DEFINITIONS.filter(
  (d) => d.type !== "list.product_reference"
);

const LARGE_SELECTION_THRESHOLD = 50;

export function BulkApplyDialog({
  open,
  onOpenChange,
  selectedCount,
  onApply,
}: BulkApplyDialogProps) {
  const [field, setField] = useState<MetafieldKey>(TEXT_FIELDS[0].key);
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);

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

  const selectedFieldDef = TEXT_FIELDS.find((d) => d.key === field);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
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
                This will set <strong>{selectedFieldDef?.label}</strong> to the
                value below for all {selectedCount} selected products.
              </p>
              <pre className="mt-2 rounded bg-muted p-2 text-xs max-h-[100px] overflow-auto whitespace-pre-wrap">
                {value}
              </pre>
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
                <Select
                  value={field}
                  onValueChange={(v) => setField(v as MetafieldKey)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TEXT_FIELDS.map((d) => (
                      <SelectItem key={d.key} value={d.key}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Value</Label>
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter value to apply..."
                  className="min-h-[100px]"
                />
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
