// Manual creation of external-brand products via the brand-template builder
// (Phase 2, plan §6). Creates Style -> Colorway -> Variants with source=MANUAL
// into a CONTINUITY season, applying shared brand-template defaults and per-
// product overrides, and records the target channels. Loom requires the full
// customs block. External products carry no threadflowId, so the Threadflow
// sync never touches them.
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import type { ChannelKey } from "./fields";

export class ValidationError extends Error {}

// ---------------------------------------------------------------------------
// Brand-template builder: create many products for a brand from shared defaults
// ---------------------------------------------------------------------------

export interface BrandTemplateInput {
  category: string | null;
  gender: string | null;
  unisex: boolean;
  channels: ChannelKey[];
  hsCode: string | null;
  customsDescription: string | null;
  weightKg: string | null;
  fiberComposition: string | null;
  countryOfOrigin: string | null;
  manufacturer: { existingId?: string; newName?: string; country?: string | null };
  sizes: string[];
}

export interface BuildProductsInput {
  brand: { existingId?: string; newName?: string };
  template: BrandTemplateInput;
  saveTemplate: boolean;
  products: Array<{
    name: string;
    colorwaySku: string;
    color?: string | null;
    swatchHex?: string | null;
    priceNok?: string | null;
    sizes?: string[]; // overrides the template sizes when provided
  }>;
}

function validateBuild(input: BuildProductsInput): void {
  const errs: string[] = [];
  if (!input.brand.existingId && !req(input.brand.newName))
    errs.push("Choose or name a brand.");
  if (!input.template.channels.length)
    errs.push("Select at least one channel.");
  if (!req(input.template.category)) errs.push("Category is required.");
  const rows = input.products.filter((p) => req(p.name) || req(p.colorwaySku));
  if (rows.length === 0) errs.push("Add at least one product.");
  for (const p of rows) {
    if (!req(p.name) || !req(p.colorwaySku))
      errs.push("Every product needs a name and SKU.");
  }
  if (input.template.channels.includes("LOOM")) {
    const t = input.template;
    if (!req(t.hsCode)) errs.push("HS code is required for Loom.");
    if (!req(t.customsDescription))
      errs.push("Customs description is required for Loom.");
    if (!req(t.weightKg)) errs.push("Weight (kg) is required for Loom.");
    if (!req(t.fiberComposition))
      errs.push("Fibre composition is required for Loom.");
    if (!req(t.countryOfOrigin))
      errs.push("Country of origin is required for Loom.");
    if (!t.manufacturer.existingId && !req(t.manufacturer.newName))
      errs.push("Manufacturer is required for Loom.");
  }
  if (errs.length) throw new ValidationError([...new Set(errs)].join(" "));
}

export async function buildProductsForBrand(
  input: BuildProductsInput
): Promise<{ created: number; brandId: string }> {
  validateBuild(input);

  // Brand
  const brandName = req(input.brand.newName);
  const brand = input.brand.existingId
    ? await prisma.brand.findUniqueOrThrow({ where: { id: input.brand.existingId } })
    : await prisma.brand.upsert({
        where: { name: brandName! },
        create: { name: brandName!, isLivid: brandName === "Livid" },
        update: {},
      });

  // Manufacturer
  let manufacturerId: string | null = null;
  const m = input.template.manufacturer;
  if (m.existingId) manufacturerId = m.existingId;
  else if (req(m.newName)) {
    const created = await prisma.manufacturer.create({
      data: { name: req(m.newName)!, country: req(m.country) },
    });
    manufacturerId = created.id;
  }

  const t = input.template;

  // Optionally persist the template for reuse.
  if (input.saveTemplate) {
    const data = {
      category: req(t.category),
      gender: req(t.gender),
      unisex: t.unisex,
      channels: t.channels,
      hsCode: req(t.hsCode),
      customsDescription: req(t.customsDescription),
      weightKg: req(t.weightKg),
      fiberComposition: req(t.fiberComposition),
      countryOfOrigin: req(t.countryOfOrigin),
      manufacturerId,
      sizes: t.sizes,
    };
    await prisma.brandTemplate.upsert({
      where: { brandId: brand.id },
      create: { brandId: brand.id, ...data },
      update: data,
    });
  }

  const season = await prisma.season.upsert({
    where: { code: CONTINUITY_CODE },
    create: { code: CONTINUITY_CODE, name: "Continuity", kind: "CONTINUITY" },
    update: {},
  });

  const rows = input.products.filter((p) => req(p.name) && req(p.colorwaySku));

  // Build bulk payloads with pre-assigned ids.
  const styleCreates: Array<Record<string, unknown>> = [];
  const colorwayCreates: Array<Record<string, unknown>> = [];
  const variantCreates: Array<Record<string, unknown>> = [];
  const entryCreates: Array<Record<string, unknown>> = [];
  const linkCreates: Array<{ seasonEntryId: string; variantId: string }> = [];
  const priceCreates: Array<Record<string, unknown>> = [];
  const pubCreates: Array<Record<string, unknown>> = [];

  for (const p of rows) {
    const styleId = randomUUID();
    const colorwayId = randomUUID();
    const entryId = randomUUID();
    const sku = req(p.colorwaySku)!;

    styleCreates.push({
      id: styleId,
      source: "MANUAL",
      styleSku: sku,
      styleName: req(p.name)!,
      gender: req(t.gender),
      unisex: t.unisex,
      category: req(t.category) ?? "Uncategorized",
      brandId: brand.id,
      hsCode: req(t.hsCode),
      customsDescription: req(t.customsDescription),
      weightKg: req(t.weightKg),
      fiberComposition: req(t.fiberComposition),
    });
    colorwayCreates.push({
      id: colorwayId,
      source: "MANUAL",
      colorwaySku: sku,
      name: req(p.name)!,
      color: req(p.color),
      swatchHex: req(p.swatchHex),
      styleId,
      brandId: brand.id,
      manufacturerId,
      countryOfOrigin: req(t.countryOfOrigin),
      productType: req(t.category),
      vendor: brand.name,
    });
    entryCreates.push({
      id: entryId,
      colorwayId,
      seasonId: season.id,
      approvedForProduction: true,
    });

    const sizes = (p.sizes && p.sizes.length ? p.sizes : t.sizes)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const size of sizes) {
      const variantId = randomUUID();
      variantCreates.push({
        id: variantId,
        colorwayId,
        variantSku: `${sku}-${size.toUpperCase()}`,
        sizeLabel: size,
        dim1: size,
      });
      linkCreates.push({ seasonEntryId: entryId, variantId });
    }

    if (req(p.priceNok)) {
      priceCreates.push({
        seasonId: season.id,
        colorwayId,
        currency: "NOK",
        priceType: "MSRP",
        amount: req(p.priceNok),
      });
    }
    for (const channel of t.channels) {
      pubCreates.push({ colorwayId, channel, published: false });
    }
  }

  try {
    await prisma.style.createMany({ data: styleCreates as never });
    await prisma.colorway.createMany({ data: colorwayCreates as never });
    if (variantCreates.length)
      await prisma.variant.createMany({ data: variantCreates as never });
    await prisma.seasonEntry.createMany({ data: entryCreates as never });
    if (linkCreates.length)
      await prisma.seasonVariant.createMany({ data: linkCreates, skipDuplicates: true });
    if (priceCreates.length)
      await prisma.price.createMany({ data: priceCreates as never });
    if (pubCreates.length)
      await prisma.channelPublication.createMany({ data: pubCreates as never });
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw new ValidationError(
        "A style, colorway, or variant SKU already exists. SKUs must be unique."
      );
    }
    throw err;
  }

  return { created: rows.length, brandId: brand.id };
}

function req(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

const CONTINUITY_CODE = "CONTINUITY";

