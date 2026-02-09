"use client";

import { PagePicker } from "./page-picker";
import type { ShopifyPage } from "@/types";

interface CarePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  carePages: ShopifyPage[];
  selectedId: string | null;
  onSelect: (pageId: string) => void;
  onClear: () => void;
}

export function CarePicker({
  open,
  onOpenChange,
  carePages,
  selectedId,
  onSelect,
  onClear,
}: CarePickerProps) {
  return (
    <PagePicker
      open={open}
      onOpenChange={onOpenChange}
      pages={carePages}
      selectedId={selectedId}
      onSelect={onSelect}
      onClear={onClear}
      title="Select care page"
    />
  );
}
