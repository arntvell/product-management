"use client";

import * as React from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// §6: a 480px right slide-in for rules, bulk edits and the confirmation a
// destructive action gets. Esc closes.
//
// Built on Sheet rather than ported from the design system's own Drawer: ours
// is Radix Dialog underneath, so it brings the focus trap, scroll lock and
// aria wiring that a hand-rolled panel does not have.
export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
}: DrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-drawer bg-ecru shadow-overlay sm:max-w-drawer"
      >
        <SheetHeader className="flex h-14 shrink-0 flex-row items-center justify-between border-b border-line px-5">
          <SheetTitle className="font-display text-section uppercase">
            {title}
          </SheetTitle>
          {description && (
            <SheetDescription className="sr-only">
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <SheetFooter className="flex shrink-0 flex-row justify-end gap-2 border-t border-line p-5">
            {footer}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
