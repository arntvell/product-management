// Creating a brand, and giving it a Sitoo manufacturer.
//
// Until this existed a brand was only ever a side effect of an import
// (Threadflow, Cin7, the Shopify pull), so a brand that was new to the shop had
// no way in: the product builder picks from existing brands only. These are
// external brands — Livid comes from Threadflow and is refused here — and they
// reach Loom through the stock registry, which the push orchestrator already
// sends every batch to.
//
// Shopify and Loom need nothing set up first: Shopify's vendor and Loom's brand
// are the brand NAME, written at push. Sitoo is the exception. It files a brand
// as a manufacturer with a numeric id, and finalize.ts refuses a Sitoo product
// whose brand has no such link — so this file can create one.

import { prisma } from "@/lib/db";
import {
  createManufacturers,
  listManufacturers,
  sitooConfigured,
  type SitooTarget,
} from "@/lib/sitoo/client";
import {
  BrandError,
  checkBrandName,
  cleanSkuToken,
  nearlySame,
  normalizeBrandName,
} from "./brands";

/**
 * Always production. resolveTarget() would fall through to SITOO_TARGET, and the
 * 2026-09-21 live-create notes record sandbox ids leaking into production refs
 * exactly that way. A manufacturer id is only worth linking if it is the till's.
 */
const SITOO_TARGET: SitooTarget = "production";

export interface CreateBrandInput {
  name: string;
  skuToken?: string | null;
  /** Create despite near-miss names (a plural, a typo). Exact clashes still block. */
  confirmSimilar?: boolean;
}

export type CreateBrandResult =
  | { ok: true; id: string; name: string }
  | { ok: false; similar: string[] };

export async function createBrand(input: CreateBrandInput): Promise<CreateBrandResult> {
  const name = input.name?.trim().replace(/\s+/g, " ") ?? "";
  if (!name) throw new BrandError("Give the brand a name.");
  if (name.toLowerCase().includes("livid"))
    throw new BrandError(
      "Livid product comes from Threadflow. New brands here are external brands only."
    );

  const skuToken = cleanSkuToken(input.skuToken);
  const check = await checkBrandName(name);
  if (check.exact.length)
    throw new BrandError(
      `"${check.exact[0]}" already exists — that is the same name once case and punctuation are ignored.`
    );
  if (check.similar.length && !input.confirmSimilar) return { ok: false, similar: check.similar };

  const brand = await prisma.brand.create({
    data: {
      name,
      isLivid: false,
      skuToken,
      normalizedName: normalizeBrandName(name),
    },
    select: { id: true, name: true },
  });
  return { ok: true, ...brand };
}

export interface BrandSitooState {
  configured: boolean;
  links: { id: string; name: string }[];
}

export async function getBrandSitooState(brandId: string): Promise<BrandSitooState> {
  const refs = await prisma.brandChannelRef.findMany({
    where: { brandId, system: "SITOO", role: "BRAND", externalId: { not: null } },
    select: { externalId: true, externalName: true },
  });
  const seen = new Map<string, string>();
  for (const r of refs) if (!seen.has(r.externalId!)) seen.set(r.externalId!, r.externalName);
  return {
    configured: sitooConfigured(SITOO_TARGET),
    links: [...seen].map(([id, name]) => ({ id, name })),
  };
}

export type SitooLinkResult =
  | { ok: true; action: "created" | "linked-existing"; manufacturerId: string; name: string }
  | { ok: false; similar: { id: string; name: string }[] };

/**
 * Give a brand its Sitoo manufacturer: link the one Sitoo already has under this
 * name, or create it.
 *
 * Sitoo is asked first, because a second manufacturer with the same name in the
 * till is permanent clutter on every product picker there. Near-miss names are
 * returned for a person to decide on, as everywhere else brands are compared.
 */
export async function linkOrCreateSitooManufacturer(
  brandId: string,
  opts: { confirmSimilar?: boolean } = {}
): Promise<SitooLinkResult> {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { id: true, name: true, isLivid: true, mergedIntoId: true },
  });
  if (!brand) throw new BrandError("Brand not found.");
  if (brand.mergedIntoId) throw new BrandError("This brand has been merged into another.");

  const state = await getBrandSitooState(brandId);
  if (state.links.length)
    throw new BrandError(
      `Already linked to Sitoo manufacturer ${state.links.map((l) => `${l.name} (${l.id})`).join(", ")}.`
    );
  if (!state.configured)
    throw new BrandError(
      "Sitoo is not configured in this environment (SITOO_BASE_URL / SITOO_API_ID / SITOO_API_KEY)."
    );

  const existing = await listManufacturers(SITOO_TARGET);
  if (existing.source !== "endpoint")
    // Creating blind could duplicate a manufacturer we failed to read.
    throw new BrandError(
      `Could not read Sitoo's manufacturers, so a duplicate cannot be ruled out. ${existing.note ?? ""}`.trim()
    );

  const key = normalizeBrandName(brand.name);
  const exact = existing.items.find((m) => normalizeBrandName(m.name ?? "") === key);
  if (exact) {
    await linkRef(brandId, String(exact.externalcompanyid), exact.name);
    return {
      ok: true,
      action: "linked-existing",
      manufacturerId: String(exact.externalcompanyid),
      name: exact.name,
    };
  }

  if (!opts.confirmSimilar) {
    const similar = existing.items
      .filter((m) => nearlySame(key, normalizeBrandName(m.name ?? "")))
      .map((m) => ({ id: String(m.externalcompanyid), name: m.name }));
    if (similar.length) return { ok: false, similar };
  }

  const [res] = await createManufacturers([{ name: brand.name }], SITOO_TARGET);
  if (!res || res.statuscode !== 200 || typeof res.return !== "number")
    throw new BrandError(
      `Sitoo did not create the manufacturer: ${res?.errortext ?? `status ${res?.statuscode ?? "none"}`}`
    );

  const id = String(res.return);
  await linkRef(brandId, id, brand.name);
  return { ok: true, action: "created", manufacturerId: id, name: brand.name };
}

/**
 * Write the ref the way the reference pull does (externalKey = externalId = the
 * numeric id, role BRAND), so finalize.ts and the Sitoo push read it unchanged.
 */
async function linkRef(brandId: string, id: string, name: string) {
  const prior = await prisma.brandChannelRef.findUnique({
    where: { system_externalKey: { system: "SITOO", externalKey: id } },
    select: { brandId: true, brand: { select: { name: true } } },
  });
  if (prior?.brandId && prior.brandId !== brandId)
    throw new BrandError(
      `Sitoo manufacturer ${id} is already linked to "${prior.brand?.name}". If they are the same ` +
        `brand, merge them on /catalog/brands/identity.`
    );
  await prisma.brandChannelRef.upsert({
    where: { system_externalKey: { system: "SITOO", externalKey: id } },
    create: {
      system: "SITOO",
      externalKey: id,
      externalName: name,
      externalId: id,
      brandId,
      role: "BRAND",
    },
    update: { brandId, role: "BRAND", externalName: name, lastSeenAt: new Date() },
  });
}
