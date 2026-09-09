"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { EditLayer } from "@/lib/master/edit";

/**
 * Write a long text field in a surface big enough to write in.
 *
 * The grid cell for a description was a 220px single-line input in a 40px row:
 * no wrapping, no way to see what you had typed, and no room to work. Following
 * the legacy editor, the cell became read-only and the writing happens here —
 * a proper textarea, and the one place a value can be applied to a whole
 * selection at once.
 */
export interface CellPanelTarget {
  rowId: string;
  rowLabel: string;
  field: string;
  fieldLabel: string;
  layer: EditLayer;
  /** Current value for this row/layer/field, dirty edits included. */
  value: string;
  /** The BASE value a channel layer falls back to when left empty. */
  inherited?: string;
}

/**
 * Render this with a `key` that identifies the cell — see the call site. A new
 * key remounts the panel with the new value, which is why there is no effect
 * here syncing state to props.
 */
export function CellPanel({
  target,
  selectedCount,
  onClose,
  onApply,
  onApplyToSelected,
}: {
  target: CellPanelTarget;
  /** How many rows the bulk action would touch (selection, else all filtered). */
  selectedCount: number;
  onClose: () => void;
  onApply: (value: string) => void;
  onApplyToSelected: (value: string) => void;
}) {
  const [value, setValue] = useState(target.value);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const isDirty = value !== target.value;

  const close = () => {
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  };

  const channel = target.layer !== "BASE";

  return (
    <Sheet open onOpenChange={(open) => !open && close()}>
      <SheetContent className="flex w-[560px] flex-col sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle className="text-base">{target.rowLabel}</SheetTitle>
          <p className="text-sm text-muted-foreground">
            {target.fieldLabel}
            {channel && <> · {target.layer} override</>}
          </p>
        </SheetHeader>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
          {confirmDiscard && (
            <div className="space-y-2 rounded-md border border-amber-400 bg-amber-500/10 p-3">
              <p className="text-sm font-medium">You have unsaved changes here</p>
              <p className="text-xs text-muted-foreground">
                Closing discards what you typed in this panel. Anything already
                applied is kept and still needs Save.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    setValue(target.value);
                    setConfirmDiscard(false);
                    onClose();
                  }}
                >
                  Discard
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Keep editing
                </Button>
              </div>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            <Label htmlFor="cell-panel-value">{target.fieldLabel}</Label>
            {channel && (
              <p className="mb-1 mt-0.5 text-xs text-muted-foreground">
                {target.inherited
                  ? "Leave this empty to use the base value below."
                  : "No base value to fall back on."}
              </p>
            )}
            <Textarea
              id="cell-panel-value"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={channel ? target.inherited || "" : "Write here…"}
              className="min-h-[240px] flex-1 text-sm"
            />
            {channel && target.inherited && (
              <div className="mt-2 rounded-md border bg-muted/30 p-2">
                <p className="text-[11px] font-medium uppercase text-muted-foreground">
                  Base value
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">
                  {target.inherited}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              onClick={() => {
                onApply(value);
                onClose();
              }}
              disabled={!isDirty}
            >
              Apply
            </Button>
            {selectedCount > 1 && (
              <Button
                variant="secondary"
                onClick={() => {
                  // Overwriting a lot of products at once is worth a beat.
                  if (
                    selectedCount >= 25 &&
                    !confirm(
                      `Set ${target.fieldLabel} to this value on ${selectedCount} products?`
                    )
                  )
                    return;
                  onApplyToSelected(value);
                  onClose();
                }}
              >
                Apply to {selectedCount} rows
              </Button>
            )}
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <span className="ml-auto text-xs text-muted-foreground">
              Still needs <b>Save</b> afterwards
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
