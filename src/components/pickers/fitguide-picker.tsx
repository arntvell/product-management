"use client";

import { useMemo } from "react";
import { PagePicker } from "./page-picker";
import type { ShopifyPage, Product } from "@/types";

interface FitguidePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fitguidePages: ShopifyPage[];
  selectedId: string | null;
  onSelect: (pageId: string) => void;
  onClear: () => void;
  product: Product | null;
  allProducts: Product[];
}

/**
 * Extracts the parent title prefix from a product title.
 * E.g., "Amber Japan Blue Scurry" in a group sharing "Amber Japan" prefix
 * would try to match a fitguide page titled "Amber Japan fitguide".
 */
function extractParentPrefix(product: Product, allProducts: Product[]): string {
  // Find products with the same vendor and type
  const siblings = allProducts.filter(
    (p) =>
      p.id !== product.id &&
      p.vendor === product.vendor &&
      p.productType === product.productType
  );

  if (siblings.length === 0) return product.title;

  // Find longest common prefix with any sibling
  let longestPrefix = "";
  for (const sibling of siblings) {
    const wordsA = product.title.split(/\s+/);
    const wordsB = sibling.title.split(/\s+/);
    const common: string[] = [];
    for (let i = 0; i < Math.min(wordsA.length, wordsB.length); i++) {
      if (wordsA[i] === wordsB[i]) common.push(wordsA[i]);
      else break;
    }
    const prefix = common.join(" ");
    if (prefix.length > longestPrefix.length) {
      longestPrefix = prefix;
    }
  }

  return longestPrefix || product.title;
}

export function FitguidePicker({
  open,
  onOpenChange,
  fitguidePages,
  selectedId,
  onSelect,
  onClear,
  product,
  allProducts,
}: FitguidePickerProps) {
  const suggestedId = useMemo(() => {
    if (!product || fitguidePages.length === 0) return null;

    const prefix = extractParentPrefix(product, allProducts).toLowerCase();

    // Try to find a page matching "{prefix} fitguide"
    const match = fitguidePages.find((p) => {
      const pTitle = p.title.toLowerCase();
      return pTitle === `${prefix} fitguide` || pTitle.startsWith(prefix);
    });

    return match?.id || null;
  }, [product, allProducts, fitguidePages]);

  return (
    <PagePicker
      open={open}
      onOpenChange={onOpenChange}
      pages={fitguidePages}
      selectedId={selectedId}
      onSelect={onSelect}
      onClear={onClear}
      title="Select fit guide page"
      suggestedId={suggestedId}
    />
  );
}
