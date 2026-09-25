// Creating a week's vintage drop in the master.
//
// 40-60 one-of-one garments every Friday. This is deliberately not the
// seven-step product wizard: that shape exists to mint a grid of colourways
// and sizes from a style, and a vintage garment is one row with one size. It
// is also not `finalize.ts`, though it writes the same tables in the same
// order and that file is the reference for this transaction.
//
// Where it diverges from the wizard, and why:
//
//   SKU. Style and colourway are `VN-ONLN-<n>`; the variant is
//   `VN-ONLN-<n>-OS`. That is the wizard's invariant
//   (`variantSku = colorwaySku + "-" + sizeToken`) rather than an exception to
//   it, and it is what the spreadsheet writes
//   (`1. EXPORT SHOPIFY`!N: `CONCATENATE("VN-ONLN-", A, "-OS")`), what 1,695 of
//   the 2,086 master rows carry, and what every recent live variant carries.
//   The 391 without the suffix are legacy, all below item 1112 — the same band
//   whose barcodes predate the deterministic pairing.
//
//   Size. `sizeLabel` is "OS" on all 2,086: there is one of each garment, so
//   the master's size axis carries nothing. The size a CUSTOMER picks is the
//   garment's own, and it lives on VintageDetail — see `vintageOptionSize`,
//   which the Shopify preview uses for the option value.
import { prisma } from "@/lib/db";
import { normalizeSku } from "./sku";
import { storedForm, barcodeKey, barcodeSpellings } from "./barcode";
import { buildVintageBody, vintageBodyShape, REQUIRED_MEASUREMENTS } from "./vintage-body";
import { VINTAGE_BRAND_NAME, VINTAGE_CUSTOMS, VINTAGE_SIZE_TOKEN } from "./vintage";

export class VintageError extends Error {}

/** One row of the drop sheet — the sheet's INPUT columns, in its own terms. */
export interface VintageItemInput {
  /** Nummer (A). The photographs are named after it. */
  itemNumber: string;
  /** Tittel (B). */
  title: string;
  /** Beskrivelse (C). */
  description: string;
  /** Kategori (D). */
  category: string;
  /** Opprinnelig produkt (E) — keys the COST lookup. */
  sourceProduct?: string | null;
  /** Pris nett (G) — what it sells for, NOK. */
  price: string;
  /** COST, NOK. Defaults to 100 at push time when absent. */
  cost?: string | null;
  chestWidth?: string | null;
  frontLength?: string | null;
  waist?: string | null;
  frontRise?: string | null;
  inseam?: string | null;
  /** Størrelse (J). */
  taggedSize?: string | null;
  /** Approx size (N). Presence selects the jeans body template. */
  approxSize?: string | null;
  /** Type mål (O). "1" = top. */
  measurementType: string;
  /** Barcode (Q). */
  barcode: string;
  /** BRAND (R) — the garment's original maker, a Shopify tag. */
  originalBrand?: string | null;
  /** Ordered photo URLs, base photo first. Empty until the shoot uploads. */
  photoUrls: string[];
  /**
   * Shopify tags. Omitted -> the standard set for the drop. Given -> used as
   * written, because a drop sometimes carries a campaign or collaboration tag
   * that no rule could know about.
   */
  tags?: string[] | null;
}

export interface VintageItemProblem {
  itemNumber: string;
  problems: string[];
}

/**
 * Everything the spreadsheet could get wrong in silence.
 *
 * All of these are fatal rather than warnings. The sheet's failure mode is
 * that a row with no photo, or a bottom with no waist, exports perfectly
 * happily and goes live broken — `9309-vintage` is a bandana whose body reads
 * "Waist  cm". Refusing the drop is the entire point of moving off it.
 */
export function validateVintageItems(items: VintageItemInput[]): VintageItemProblem[] {
  const out: VintageItemProblem[] = [];
  const seen = new Map<string, number>();
  for (const i of items) seen.set(i.itemNumber, (seen.get(i.itemNumber) ?? 0) + 1);

  // Two spellings of one barcode are one barcode, so compare by key rather
  // than by string — `Variant.barcode` is unique and the insert would fail on
  // the whole drop, naming a constraint rather than the two garments.
  const barcodeSeen = new Map<string, number>();
  for (const i of items) {
    const k = barcodeKey(i.barcode);
    if (k) barcodeSeen.set(k, (barcodeSeen.get(k) ?? 0) + 1);
  }

  for (const i of items) {
    const p: string[] = [];
    const n = i.itemNumber?.trim();

    if (!n) p.push("no item number");
    else if (!/^\d+$/.test(n)) p.push(`item number "${n}" is not a number`);
    else if ((seen.get(i.itemNumber) ?? 0) > 1) p.push(`item number ${n} appears more than once`);

    if (!i.title?.trim()) p.push("no title");
    if (!i.description?.trim()) p.push("no description");
    if (!i.category?.trim()) p.push("no category");
    if (!i.price?.trim()) p.push("no price");

    // A barcode has to be a barcode, not merely present. `storedForm` returns
    // null for a bad check digit or a wrong length, and the row would then be
    // written with no barcode at all — a silent loss, and the till cannot ring
    // up what it cannot scan.
    if (!i.barcode?.trim()) p.push("no barcode");
    else if (!storedForm(i.barcode))
      p.push(`barcode "${i.barcode.trim()}" is not a valid EAN-13 or UPC-A`);
    else if ((barcodeSeen.get(barcodeKey(i.barcode)!) ?? 0) > 1)
      p.push(`barcode ${i.barcode.trim()} is on more than one garment in this drop`);
    if (!i.taggedSize?.trim() && !i.approxSize?.trim()) p.push("no size");

    // The measurements the body template will print. A blank one does not
    // fail the export, it prints an empty measurement to a customer.
    const shape = vintageBodyShape(i);
    for (const field of REQUIRED_MEASUREMENTS[shape]) {
      const v = (i as unknown as Record<string, string | null | undefined>)[field];
      if (!v?.toString().trim()) p.push(`${shape}: no ${field}`);
    }

    // Photographs are NOT required here. The shoot uploads after the writing
    // is done, so a garment legitimately exists in the master for a while with
    // no image. What must never happen is that one reaching the storefront —
    // and the Shopify readiness gate already refuses a colorway with no media
    // (`hasImage` in shopifyMissing), which is the check that actually
    // protects the customer. Blocking creation too would only force the
    // operator to retype the drop once the photos land.

    if (p.length) out.push({ itemNumber: n || "(blank)", problems: p });
  }
  return out;
}

/** `VN-ONLN-13644` from `13644`. */
export function vintageSku(itemNumber: string): string {
  return normalizeSku(`VN-ONLN-${itemNumber.trim()}`);
}

/**
 * The product title: `Tittel (Size)`, e.g. "2009 Carhartt Worker Shirt (L)".
 *
 * The size goes in the NAME as well as on the variant, because Shopify's
 * product title is what a customer scanning a collection reads, and one-of-one
 * garments are browsed by size. `channelProductTitle` passes it through
 * unchanged: for vintage the style name and the colourway name are the same
 * string, so it does not get prefixed.
 */
export function vintageName(title: string, size: string): string {
  const t = title.trim();
  const sz = size.trim();
  if (!sz) return t;
  // Always append. The title is written WITHOUT the size and the size is added
  // here, which is what the sheet does and what every live product reads like.
  //
  // A guard that skipped appending when the title already ended in brackets
  // lived here briefly and was wrong twice over: it would silently drop the
  // size from a legitimate title like "Nike (vintage) Crewneck", and it papered
  // over an entry mistake rather than showing it. The drop sheet warns on a
  // title that looks like it already carries its size, which is the place to
  // catch it — while it can still be corrected.
  return `${t} (${sz})`;
}

/** Approx size wins over the tagged size — it is the contemporary one. */
export function vintageSize(i: { approxSize?: string | null; taggedSize?: string | null }): string {
  return (i.approxSize?.trim() || i.taggedSize?.trim() || "").trim();
}

/**
 * The plain-text twin of the body, for `custom.full_description`.
 *
 * The sheet writes both: HTML into the product body, and this into the
 * metafield, with a different layout ("Chest Width: 62", no "cm"). Read off
 * `13762-vintage` on 2026-09-25. The push already maps
 * `Colorway.fullDescription` to that metafield, so this is what gets stored
 * there.
 */
export function vintagePlainDescription(i: VintageItemInput): string {
  const shape = vintageBodyShape(i);
  const lines: string[] = [i.description.trim(), ""];
  if (shape === "tops") {
    lines.push(`Chest Width: ${i.chestWidth ?? ""}`, `Front Length: ${i.frontLength ?? ""}`);
  } else {
    if (shape === "jeans")
      lines.push(
        `Standardized contemporary size: ${i.approxSize ?? ""}`,
        `Tagged size: ${i.taggedSize ?? ""}`
      );
    lines.push(`Waist: ${i.waist ?? ""}`, `Front rise: ${i.frontRise ?? ""}`, `Inseam Length: ${i.inseam ?? ""}`);
  }
  lines.push("", "Hot tip for buying vintage online");
  lines.push(
    "Please be aware that sizes and fits vary greatly from brand to brand, and decade to decade. " +
      "Instead of just following the garments' S/M/L labels, we recommend comparing the garments' " +
      "measurements with a similar product you own and know fits you."
  );
  return lines.join("\n");
}

/** Shopify tags: the drop, the original brand, and the storefront's own flags. */
export function vintageTags(drop: string, originalBrand?: string | null): string[] {
  const dropTag = `DROP${drop.replace(/\D/g, "")}`;
  return [dropTag, "rocket-hide", ...(originalBrand?.trim() ? [originalBrand.trim()] : []), "hide"];
}

export interface CreateVintageResult {
  created: number;
  colorwayIds: string[];
  skipped: Array<{ itemNumber: string; reason: string }>;
}

/**
 * Write a drop. One transaction: either the whole drop lands or none of it
 * does, so a half-created drop never has to be reconciled by hand.
 */
export async function createVintageItems(
  drop: string,
  items: VintageItemInput[],
  opts: { dryRun?: boolean } = {}
): Promise<CreateVintageResult> {
  const problems = validateVintageItems(items);
  if (problems.length)
    throw new VintageError(
      `${problems.length} item(s) cannot be created:\n` +
        problems.map((p) => `  ${p.itemNumber}: ${p.problems.join("; ")}`).join("\n")
    );

  const brand = await prisma.brand.findFirst({
    where: { name: VINTAGE_BRAND_NAME },
    select: { id: true },
  });
  if (!brand) throw new VintageError(`No "${VINTAGE_BRAND_NAME}" brand in the master.`);

  const season = await prisma.season.findFirst({
    where: { kind: "CONTINUITY" },
    select: { id: true },
  });
  if (!season) throw new VintageError("No CONTINUITY season in the master.");

  // Refuse rather than collide: the SKU is the item number, and a repeated
  // number means the sheet reused one.
  const skus = items.map((i) => vintageSku(i.itemNumber));
  const existing = await prisma.colorway.findMany({
    where: { colorwaySku: { in: skus } },
    select: { colorwaySku: true },
  });
  if (existing.length)
    throw new VintageError(
      `${existing.length} item(s) already exist in the master: ` +
        existing.map((e) => e.colorwaySku).join(", ")
    );

  // Same for barcodes. `Variant.barcode` is unique, so a collision fails the
  // whole transaction naming a constraint; catching it here names the garment
  // and the code instead. Checked in both spellings, because a 12-digit UPC-A
  // and its zero-prefixed form are one barcode and the index is on the string.
  const spellings = items.flatMap((i) => barcodeSpellings(i.barcode));
  if (spellings.length) {
    const taken = await prisma.variant.findMany({
      where: { barcode: { in: spellings } },
      select: { barcode: true, variantSku: true },
    });
    if (taken.length)
      throw new VintageError(
        `${taken.length} barcode(s) are already on another garment: ` +
          taken.map((t) => `${t.barcode} (${t.variantSku})`).join(", ")
      );
  }

  const styleRows: Array<Record<string, unknown>> = [];
  const colorwayRows: Array<Record<string, unknown>> = [];
  const variantRows: Array<Record<string, unknown>> = [];
  const entryRows: Array<Record<string, unknown>> = [];
  const linkRows: Array<Record<string, unknown>> = [];
  const priceRows: Array<Record<string, unknown>> = [];
  const pubRows: Array<Record<string, unknown>> = [];
  const detailRows: Array<Record<string, unknown>> = [];
  const ownerRows: Array<Record<string, unknown>> = [];
  const mediaRows: Array<Record<string, unknown>> = [];
  const colorwayIds: string[] = [];
  const now = new Date();

  for (const i of items) {
    const sku = vintageSku(i.itemNumber);
    const size = vintageSize(i);
    const name = vintageName(i.title, size);
    const styleId = crypto.randomUUID();
    const colorwayId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const entryId = crypto.randomUUID();
    colorwayIds.push(colorwayId);

    // One garment is its own style. styleName === name so the shared
    // `channelProductTitle` leaves the title alone rather than prefixing it.
    styleRows.push({
      id: styleId,
      styleSku: sku,
      styleName: name,
      brandId: brand.id,
      // MANUAL, not CIN7_IMPORT. The 2,086 existing rows say CIN7_IMPORT
      // because that is genuinely how they arrived; a garment typed into this
      // screen arrived by hand. `Source` records provenance, and claiming an
      // importer wrote this would be false — and would invite the Cin7
      // importer to treat it as its own on a later run.
      source: "MANUAL",
      hsCode: VINTAGE_CUSTOMS.hsCode,
      customsDescription: VINTAGE_CUSTOMS.customsDescription,
      weightKg: VINTAGE_CUSTOMS.weightKg,
    });

    colorwayRows.push({
      id: colorwayId,
      styleId,
      brandId: brand.id,
      colorwaySku: sku,
      name,
      styleName: name,
      source: "MANUAL",
      kind: "MERCHANDISE",
      // ACTIVE, unlike every other create path, which defaults to DRAFT.
      //
      // `status` is the master's INTENT for the product, and the intent of a
      // drop is that it goes on sale — the flow ends by putting it at the top
      // of the collection, which is meaningless for a product customers
      // cannot see. Every live vintage product on the store is ACTIVE.
      //
      // Nothing is exposed by this on its own: the row reaches Shopify only
      // when someone presses Push, and DRAFT here would instead create an
      // invisible product and quietly make that last step a no-op.
      status: "ACTIVE",
      vendor: VINTAGE_BRAND_NAME,
      productType: i.category.trim(),
      countryOfOrigin: VINTAGE_CUSTOMS.countryOfOrigin,
      tags: i.tags?.length ? i.tags.map((t) => t.trim()).filter(Boolean) : vintageTags(drop, i.originalBrand),
      fullDescription: vintagePlainDescription(i),
      shortDescription: i.description.trim(),
    });

    variantRows.push({
      id: variantId,
      colorwayId,
      variantSku: `${sku}-${VINTAGE_SIZE_TOKEN}`,
      barcode: storedForm(i.barcode),
      // The axis, not the garment's size. One of each means there is nothing
      // to choose between, and every existing row says OS.
      sizeLabel: VINTAGE_SIZE_TOKEN,
      dim1: VINTAGE_SIZE_TOKEN,
      dim2: null,
    });

    entryRows.push({ id: entryId, colorwayId, seasonId: season.id, drop, approvedForProduction: true });
    linkRows.push({ seasonEntryId: entryId, variantId });

    for (const [priceType, amount] of [
      ["MSRP", i.price],
      ["COST", i.cost],
    ] as const) {
      if (!amount?.trim()) continue;
      priceRows.push({
        seasonId: season.id,
        colorwayId,
        currency: "NOK",
        priceType,
        amount: amount.trim().replace(",", "."),
      });
    }

    // Both channels: Loom holds the stock, Shopify sells it.
    for (const channel of ["SHOPIFY", "LOOM"] as const)
      pubRows.push({ colorwayId, channel, published: false });

    detailRows.push({
      colorwayId,
      itemNumber: i.itemNumber.trim(),
      description: i.description.trim(),
      measurementType: i.measurementType.trim(),
      category: i.category.trim(),
      taggedSize: i.taggedSize?.trim() || null,
      approxSize: i.approxSize?.trim() || null,
      chestWidth: i.chestWidth?.trim() || null,
      frontLength: i.frontLength?.trim() || null,
      waist: i.waist?.trim() || null,
      frontRise: i.frontRise?.trim() || null,
      inseam: i.inseam?.trim() || null,
      originalBrand: i.originalBrand?.trim() || null,
      sourceProduct: i.sourceProduct?.trim() || null,
    });

    // Lock every field this screen writes. `normalize` is NOT source-scoped —
    // it selects on the column being non-null and would recase a vendor or a
    // product type — and its only protection is a MANUAL FieldOwner row. Hand
    // written copy losing its capitals to a nightly pass is exactly the kind
    // of silent drift this master exists to stop.
    for (const field of [
      "name",
      "styleName",
      "vendor",
      "productType",
      "tags",
      "fullDescription",
      "shortDescription",
      "countryOfOrigin",
    ])
      ownerRows.push({
        entityType: "colorway",
        entityId: colorwayId,
        field,
        owner: "MANUAL",
        lockedAt: now,
        authority: `manual:vintage-drop-${drop}`,
      });

    // Position follows the caller's order, which `photos.ts` has already
    // sorted so the base photo leads — position 0 is the featured image.
    i.photoUrls.forEach((url, position) => {
      mediaRows.push({
        colorwayId,
        url,
        source: "EXTERNAL",
        role: "GALLERY",
        blobPathname: null,
        position,
      });
    });
  }

  if (opts.dryRun)
    return { created: items.length, colorwayIds: [], skipped: [] };

  await prisma.$transaction(
    async (tx) => {
      await tx.style.createMany({ data: styleRows as never });
      await tx.colorway.createMany({ data: colorwayRows as never });
      await tx.variant.createMany({ data: variantRows as never });
      await tx.seasonEntry.createMany({ data: entryRows as never });
      await tx.seasonVariant.createMany({ data: linkRows as never });
      if (priceRows.length) await tx.price.createMany({ data: priceRows as never });
      await tx.channelPublication.createMany({ data: pubRows as never });
      await tx.vintageDetail.createMany({ data: detailRows as never });
      await tx.fieldOwner.createMany({ data: ownerRows as never });
      if (mediaRows.length) await tx.mediaAsset.createMany({ data: mediaRows as never });
    },
    { timeout: 30_000, maxWait: 5_000 }
  );

  return { created: items.length, colorwayIds, skipped: [] };
}

/** The Shopify body for a stored garment, rebuilt from its VintageDetail. */
export function bodyForDetail(d: {
  description: string;
  measurementType: string;
  approxSize: string | null;
  taggedSize: string | null;
  chestWidth: string | null;
  frontLength: string | null;
  waist: string | null;
  frontRise: string | null;
  inseam: string | null;
}): string {
  return buildVintageBody(d);
}
