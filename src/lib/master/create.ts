// Manual creation of external-brand products (Phase 2, plan §6).
// Creates Style -> Colorway -> Variants with source=MANUAL, into a CONTINUITY
// season, and records the target channels. Validates the required field set per
// selected channel (Loom requires the full customs block). External products
// carry no threadflowId, so the Threadflow sync never touches them.
import { prisma } from "@/lib/db";
import type { ChannelKey } from "./fields";

export interface CreateProductInput {
  channels: ChannelKey[];
  brand: { existingId?: string; newName?: string };
  style: {
    styleName: string;
    styleSku: string;
    gender: string | null;
    unisex: boolean;
    category: string;
  };
  colorway: {
    name: string;
    colorwaySku: string;
    color?: string | null;
    swatchHex?: string | null;
    countryOfOrigin?: string | null;
  };
  customs: {
    hsCode?: string | null;
    customsDescription?: string | null;
    weightKg?: string | null;
    fiberComposition?: string | null;
  };
  manufacturer: { existingId?: string; newName?: string; country?: string | null };
  sizes: string[];
}

export class ValidationError extends Error {}

function req(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function validate(input: CreateProductInput): void {
  const errs: string[] = [];
  if (!input.channels.length) errs.push("Select at least one channel.");
  if (!input.brand.existingId && !req(input.brand.newName))
    errs.push("Choose or name a brand.");
  if (!req(input.style.styleName)) errs.push("Style name is required.");
  if (!req(input.style.styleSku)) errs.push("Style SKU is required.");
  if (!req(input.style.category)) errs.push("Category is required.");
  if (!req(input.colorway.name)) errs.push("Colorway name is required.");
  if (!req(input.colorway.colorwaySku)) errs.push("Colorway SKU is required.");

  // Loom requires the full customs block + manufacturer + gender.
  if (input.channels.includes("LOOM")) {
    if (!req(input.customs.hsCode)) errs.push("HS code is required for Loom.");
    if (!req(input.customs.customsDescription))
      errs.push("Customs description is required for Loom.");
    if (!req(input.customs.weightKg))
      errs.push("Weight (kg) is required for Loom.");
    if (!req(input.customs.fiberComposition))
      errs.push("Fibre composition is required for Loom.");
    if (!req(input.colorway.countryOfOrigin))
      errs.push("Country of origin is required for Loom.");
    if (!input.manufacturer.existingId && !req(input.manufacturer.newName))
      errs.push("Manufacturer is required for Loom.");
    if (!req(input.style.gender) && !input.style.unisex)
      errs.push("Gender (or unisex) is required for Loom.");
  }

  if (errs.length) throw new ValidationError(errs.join(" "));
}

const CONTINUITY_CODE = "CONTINUITY";

export async function createExternalProduct(
  input: CreateProductInput
): Promise<{ colorwayId: string }> {
  validate(input);

  // Brand
  const brandName = req(input.brand.newName);
  const brand = input.brand.existingId
    ? await prisma.brand.findUniqueOrThrow({ where: { id: input.brand.existingId } })
    : await prisma.brand.upsert({
        where: { name: brandName! },
        create: { name: brandName!, isLivid: brandName === "Livid" },
        update: {},
      });

  // Manufacturer (optional unless Loom, already validated)
  let manufacturerId: string | null = null;
  if (input.manufacturer.existingId) {
    manufacturerId = input.manufacturer.existingId;
  } else if (req(input.manufacturer.newName)) {
    const m = await prisma.manufacturer.create({
      data: {
        name: req(input.manufacturer.newName)!,
        country: req(input.manufacturer.country),
      },
    });
    manufacturerId = m.id;
  }

  // CONTINUITY season for non-seasonal / external products
  const season = await prisma.season.upsert({
    where: { code: CONTINUITY_CODE },
    create: { code: CONTINUITY_CODE, name: "Continuity", kind: "CONTINUITY" },
    update: {},
  });

  try {
    return await prisma.$transaction(async (tx) => {
      const style = await tx.style.create({
        data: {
          source: "MANUAL",
          styleSku: req(input.style.styleSku)!,
          styleName: req(input.style.styleName)!,
          gender: req(input.style.gender),
          unisex: input.style.unisex,
          category: req(input.style.category) ?? "Uncategorized",
          brandId: brand.id,
          hsCode: req(input.customs.hsCode),
          customsDescription: req(input.customs.customsDescription),
          weightKg: req(input.customs.weightKg),
          fiberComposition: req(input.customs.fiberComposition),
        },
      });

      const colorway = await tx.colorway.create({
        data: {
          source: "MANUAL",
          colorwaySku: req(input.colorway.colorwaySku)!,
          name: req(input.colorway.name)!,
          color: req(input.colorway.color),
          swatchHex: req(input.colorway.swatchHex),
          styleId: style.id,
          brandId: brand.id,
          manufacturerId,
          countryOfOrigin: req(input.colorway.countryOfOrigin),
          productType: req(input.style.category),
          vendor: brand.name,
        },
      });

      const entry = await tx.seasonEntry.create({
        data: {
          colorwayId: colorway.id,
          seasonId: season.id,
          approvedForProduction: true,
        },
      });

      const sizes = input.sizes
        .map((s) => s.trim())
        .filter(Boolean);
      const colorwaySku = req(input.colorway.colorwaySku)!;
      for (const size of sizes) {
        const variant = await tx.variant.create({
          data: {
            colorwayId: colorway.id,
            variantSku: `${colorwaySku}-${size.toUpperCase()}`,
            sizeLabel: size,
            dim1: size,
          },
        });
        await tx.seasonVariant.create({
          data: { seasonEntryId: entry.id, variantId: variant.id },
        });
      }

      for (const channel of input.channels) {
        await tx.channelPublication.create({
          data: { colorwayId: colorway.id, channel, published: false },
        });
      }

      return { colorwayId: colorway.id };
    });
  } catch (err) {
    // Unique-constraint violations (duplicate SKU) -> friendly message.
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
}
