// The shape of a draft's JSON payload, and the one function allowed to read it.
//
// There is no zod in this repo and adding it for one file would be a dependency
// nobody else uses. What matters is not the library but the discipline: a draft
// outlives the deploy that created it, so a field that moves must produce a
// clear refusal rather than a crash three steps into the wizard. Every route
// that touches a payload goes through parseDraftPayload.

import type { ProductKind } from "@/generated/prisma/enums";
import type { PublishChannelKey } from "./fields";

export const DRAFT_SCHEMA_VERSION = 1;

export const DRAFT_STEPS = [
  "brand",
  "style",
  "colorways",
  "sizes",
  "prices",
  "barcodes",
  "review",
] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

export interface DraftVariant {
  /** Stable within the draft, so reordering colourways cannot re-key a barcode. */
  key: string;
  /** SizeSystemEntry.id, or null for a size typed ad hoc. */
  entryId: string | null;
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
  skuToken: string;
  variantSku: string;
  barcode: string | null;
  /** Where the barcode came from — the brand's own, allocated, or a CSV import. */
  barcodeSource: "brand" | "allocated" | "csv" | null;
}

export interface DraftColorway {
  key: string;
  name: string;
  color: string | null;
  swatchHex: string | null;
  colorwaySku: string;
  /** True when a person overrode the generated SKU. Surfaced through to review. */
  manualSku: boolean;
  /** Null inherits the batch default. */
  kind: ProductKind | null;
  sizeSystemId: string | null;
  variants: DraftVariant[];
  prices: { COST?: string; MSRP?: string };
}

export type DraftStyle =
  | { mode: "existing"; id: string; styleSku: string; styleName: string }
  | { mode: "new"; styleName: string; styleSku: string; manualSku: boolean };

export interface DraftTemplate {
  category: string;
  gender: string;
  unisex: boolean;
  hsCode: string;
  customsDescription: string;
  weightKg: string;
  fiberComposition: string;
  countryOfOrigin: string;
  manufacturerId: string;
}

export interface DraftPayloadV1 {
  version: 1;
  brand: { id: string | null; name: string; skuToken: string | null; isLivid: boolean };
  seasonId: string | null;
  channels: PublishChannelKey[];
  kind: ProductKind;
  template: DraftTemplate;
  style: DraftStyle | null;
  colorways: DraftColorway[];
}

export class DraftPayloadError extends Error {}

export function emptyDraftPayload(): DraftPayloadV1 {
  return {
    version: 1,
    brand: { id: null, name: "", skuToken: null, isLivid: false },
    seasonId: null,
    // All three preselected — the user unticks what they do not want.
    channels: ["SHOPIFY", "LOOM", "SITOO"],
    kind: "MERCHANDISE",
    template: {
      category: "",
      gender: "",
      unisex: false,
      hsCode: "",
      customsDescription: "",
      weightKg: "",
      fiberComposition: "",
      countryOfOrigin: "",
      manufacturerId: "",
    },
    style: null,
    colorways: [],
  };
}

const KINDS: ProductKind[] = [
  "MERCHANDISE",
  "AGGREGATE",
  "MATERIAL",
  "CONSUMABLE",
  "SAMPLE",
  "SERVICE",
  "TEST",
];
const CHANNELS: PublishChannelKey[] = ["SHOPIFY", "LOOM", "SITOO"];

/**
 * Read a stored payload, or refuse clearly.
 *
 * Deliberately forgiving about MISSING optional fields (a draft saved by an
 * older deploy simply lacks them) and strict about wrong SHAPES (an array where
 * an object belongs means the payload is not what we think, and guessing would
 * carry the confusion into the master).
 */
export function parseDraftPayload(raw: unknown): DraftPayloadV1 {
  if (!isRecord(raw)) throw new DraftPayloadError("Draft payload is not an object.");
  const version = num(raw.version) ?? 1;
  if (version > DRAFT_SCHEMA_VERSION)
    throw new DraftPayloadError(
      `This draft was saved by a newer version of Origio (payload v${version}). Reload the page.`
    );

  const base = emptyDraftPayload();
  const brand = isRecord(raw.brand) ? raw.brand : {};
  const template = isRecord(raw.template) ? raw.template : {};

  return {
    version: 1,
    brand: {
      id: str(brand.id) || null,
      name: str(brand.name),
      skuToken: str(brand.skuToken) || null,
      isLivid: bool(brand.isLivid),
    },
    seasonId: str(raw.seasonId) || null,
    channels: arr(raw.channels)
      .map((c) => str(c) as PublishChannelKey)
      .filter((c) => CHANNELS.includes(c)),
    kind: KINDS.includes(str(raw.kind) as ProductKind)
      ? (str(raw.kind) as ProductKind)
      : base.kind,
    template: {
      category: str(template.category),
      gender: str(template.gender),
      unisex: bool(template.unisex),
      hsCode: str(template.hsCode),
      customsDescription: str(template.customsDescription),
      weightKg: str(template.weightKg),
      fiberComposition: str(template.fiberComposition),
      countryOfOrigin: str(template.countryOfOrigin),
      manufacturerId: str(template.manufacturerId),
    },
    style: parseStyle(raw.style),
    colorways: arr(raw.colorways).map(parseColorway),
  };
}

function parseStyle(raw: unknown): DraftStyle | null {
  if (!isRecord(raw)) return null;
  if (raw.mode === "existing") {
    const id = str(raw.id);
    if (!id) return null;
    return { mode: "existing", id, styleSku: str(raw.styleSku), styleName: str(raw.styleName) };
  }
  if (raw.mode === "new") {
    return {
      mode: "new",
      styleName: str(raw.styleName),
      styleSku: str(raw.styleSku),
      manualSku: bool(raw.manualSku),
    };
  }
  return null;
}

function parseColorway(raw: unknown): DraftColorway {
  if (!isRecord(raw)) throw new DraftPayloadError("A colourway in this draft is malformed.");
  return {
    key: str(raw.key) || cryptoKey(),
    name: str(raw.name),
    color: str(raw.color) || null,
    swatchHex: str(raw.swatchHex) || null,
    colorwaySku: str(raw.colorwaySku),
    manualSku: bool(raw.manualSku),
    kind: KINDS.includes(str(raw.kind) as ProductKind) ? (str(raw.kind) as ProductKind) : null,
    sizeSystemId: str(raw.sizeSystemId) || null,
    variants: arr(raw.variants).map(parseVariant),
    prices: parsePrices(raw.prices),
  };
}

function parseVariant(raw: unknown): DraftVariant {
  if (!isRecord(raw)) throw new DraftPayloadError("A size in this draft is malformed.");
  const source = str(raw.barcodeSource);
  return {
    key: str(raw.key) || cryptoKey(),
    entryId: str(raw.entryId) || null,
    sizeLabel: str(raw.sizeLabel),
    dim1: str(raw.dim1),
    dim2: str(raw.dim2) || null,
    skuToken: str(raw.skuToken),
    variantSku: str(raw.variantSku),
    barcode: str(raw.barcode) || null,
    barcodeSource:
      source === "brand" || source === "allocated" || source === "csv" ? source : null,
  };
}

function parsePrices(raw: unknown): DraftColorway["prices"] {
  if (!isRecord(raw)) return {};
  const out: DraftColorway["prices"] = {};
  if (str(raw.COST)) out.COST = str(raw.COST);
  if (str(raw.MSRP)) out.MSRP = str(raw.MSRP);
  return out;
}

export function draftTitle(payload: DraftPayloadV1): string {
  const brand = payload.brand.name || "New product";
  const style = payload.style?.styleName;
  const n = payload.colorways.length;
  if (style) return `${brand} — ${style}${n ? ` (${n} colourway${n === 1 ? "" : "s"})` : ""}`;
  return brand;
}

// --- tiny readers, so a wrong type is never silently coerced into the master ---

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function bool(v: unknown): boolean {
  return v === true;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function cryptoKey(): string {
  return Math.random().toString(36).slice(2, 10);
}
