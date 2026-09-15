// Keeping the three SKU levels in step as the wizard is edited.
//
// Everything here re-derives DOWNWARD only: change the style and colourway SKUs
// follow; change a colourway name and its variant SKUs follow. Nothing ever
// re-derives a styleSku from a colourway, and an existing style's SKU is never
// touched at all — that is roadmap decision 2.2, and it is the reason Barnes is
// not called two different things today.

import {
  buildColorwaySku,
  buildVariantSku,
  normalizeSku,
} from "@/lib/master/sku";
import type { DraftPayloadV1, DraftColorway } from "@/lib/master/draft-payload";

export function restyleColorway(cw: DraftColorway, styleSku: string): DraftColorway {
  const colorwaySku = cw.manualSku
    ? normalizeSku(cw.colorwaySku)
    : buildColorwaySku(styleSku, cw.name || "");
  return {
    ...cw,
    colorwaySku,
    variants: cw.variants.map((v) => ({
      ...v,
      variantSku: buildVariantSku(colorwaySku, v.skuToken),
    })),
  };
}

/** Re-derive every colourway and variant SKU from the current style SKU. */
export function resyncSkus(p: DraftPayloadV1): DraftPayloadV1 {
  const styleSku = p.style?.styleSku ?? "";
  if (!styleSku) return p;
  return { ...p, colorways: p.colorways.map((cw) => restyleColorway(cw, styleSku)) };
}
