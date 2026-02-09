"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { METAFIELD_DEFINITIONS } from "@/lib/constants";
import type { MetafieldKey, Product } from "@/types";

interface SidePanelProps {
  product: Product | null;
  field: MetafieldKey | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (productId: string, field: MetafieldKey, value: string) => void;
  currentValue: string;
  selectedCount?: number;
  onApplyToSelected?: (field: MetafieldKey, value: string) => void;
}

export function SidePanel({
  product,
  field,
  isOpen,
  onClose,
  onSave,
  currentValue,
  selectedCount = 0,
  onApplyToSelected,
}: SidePanelProps) {
  const [value, setValue] = useState(currentValue);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    setValue(currentValue);
  }, [currentValue, product?.id, field]);

  const isDirty = value !== currentValue;

  const handleClose = useCallback(() => {
    if (isDirty) {
      setShowConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleDiscardAndClose = useCallback(() => {
    setShowConfirm(false);
    setValue(currentValue);
    onClose();
  }, [currentValue, onClose]);

  if (!product || !field) return null;

  const def = METAFIELD_DEFINITIONS.find((d) => d.key === field);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <SheetContent className="w-[500px] sm:max-w-[500px]">
        <SheetHeader>
          <SheetTitle className="text-base">{product.title}</SheetTitle>
          <p className="text-sm text-muted-foreground">{def?.label}</p>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          {showConfirm && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 space-y-2">
              <p className="text-sm font-medium">You have unsaved changes</p>
              <p className="text-xs text-muted-foreground">
                Closing will discard your edits.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDiscardAndClose}
                >
                  Discard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                >
                  Keep Editing
                </Button>
              </div>
            </div>
          )}
          <div>
            <Label htmlFor="field-value">{def?.label}</Label>
            <p className="text-xs text-muted-foreground mb-2">
              {def?.description}
            </p>
            <Textarea
              id="field-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="min-h-[200px] font-mono text-sm"
              placeholder={`Enter ${def?.label?.toLowerCase()}...`}
            />
          </div>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                onSave(product.id, field, value);
                setShowConfirm(false);
                onClose();
              }}
              disabled={!isDirty}
            >
              Apply
            </Button>
            {selectedCount > 1 && onApplyToSelected && (
              <Button
                variant="secondary"
                onClick={() => {
                  onApplyToSelected(field, value);
                  setShowConfirm(false);
                  onClose();
                }}
              >
                Apply to {selectedCount} selected
              </Button>
            )}
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
