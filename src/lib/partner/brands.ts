// Loom's Buying planner holds draft brands. At plan lock it asks Origio to
// create or link each one, then makes its own Brand row with Origio's id.
//
//   resolve    by loom_brand_id, then by name (case and punctuation ignored).
//              Found: link it (set Brand.loomBrandId) and answer existed: true.
//              A brand's token is never changed here: an existing brand answers
//              with the token its SKUs already use.
//   create     isLivid false, an empty BrandTemplate, and a SKU token: the one
//              sent, or the derived one, refused if another brand holds it.
//   dry run    writes nothing, not even the link; answers with the token.
//   idempotent by natural key, not a stored loom_key (that would need a
//              migration): a repeat resolves the brand the first call made, so
//              it returns the same origio_brand_id, with existed: true.
//
// supplier_name and currency have no home on Origio's Brand; they are accepted
// and ignored. Loom keeps them on its own row.
import { prisma } from "@/lib/db";
import { cleanSkuToken, normalizeBrandName, BrandError } from "@/lib/master/brands";
import { PartnerRequestError } from "./external-products";
import { chooseToken, effectiveToken, matchBrand, takenTokens, type BrandRow } from "./brand-rules";

export interface BrandItem {
  loom_key: string;
  loom_brand_id?: string | null;
  name: string;
  sku_token?: string | null;
  supplier_name?: string | null;
  currency?: string | null;
}

export type BrandResult =
  | {
      loom_key: string;
      ok: true;
      origio_brand_id: string | null; // null on a dry run that would create
      name: string;
      sku_token: string | null;
      existed: boolean;
      /** Origio's link to Loom after this call (a dry run: what it would be). */
      loom_brand_id: string | null;
      is_livid: boolean;
      warnings: string[];
    }
  | { loom_key: string; ok: false; error: string };

const BRAND_SELECT = {
  id: true,
  name: true,
  isLivid: true,
  skuToken: true,
  loomBrandId: true,
  archived: true,
  mergedIntoId: true,
} as const;

export async function upsertPartnerBrands(body: {
  dry_run?: unknown;
  items?: unknown;
}): Promise<{ dryRun: boolean; items: BrandResult[] }> {
  const dryRun = body.dry_run !== false;
  if (!Array.isArray(body.items)) throw new PartnerRequestError("items must be an array");

  const out: BrandResult[] = [];
  // Brands a dry run would create, so two items naming one new brand agree.
  const planned = new Map<string, BrandResult>();
  for (const raw of body.items as BrandItem[]) {
    const key = typeof raw?.loom_key === "string" ? raw.loom_key : "";
    if (!key) {
      out.push({ loom_key: "", ok: false, error: "loom_key is missing" });
      continue;
    }
    try {
      out.push(await oneBrand(raw, dryRun, planned));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.push({ loom_key: key, ok: false, error: msg });
    }
  }
  return { dryRun, items: out };
}

async function oneBrand(
  item: BrandItem,
  dryRun: boolean,
  planned: Map<string, BrandResult>
): Promise<BrandResult> {
  const key = item.loom_key;
  const name = typeof item.name === "string" ? item.name.trim().replace(/\s+/g, " ") : "";
  if (!name) return { loom_key: key, ok: false, error: "name is missing" };
  const loomId = typeof item.loom_brand_id === "string" ? item.loom_brand_id.trim() || null : null;
  let given: string | null;
  try {
    given = cleanSkuToken(item.sku_token);
  } catch (err) {
    return { loom_key: key, ok: false, error: err instanceof BrandError ? err.message : String(err) };
  }

  // Read fresh per item: a real call's earlier item may have created a brand.
  const all: BrandRow[] = await prisma.brand.findMany({ select: BRAND_SELECT });
  const match = matchBrand({ loom_brand_id: loomId, name }, all);
  if (match.kind === "refuse") return { loom_key: key, ok: false, error: match.error };

  if (match.kind === "found") {
    const b = match.brand;
    const warnings: string[] = [];
    const token = effectiveToken(b);
    if (given && given !== token)
      warnings.push(`${b.name} already makes SKUs with ${token ?? "no token"}; ${given} was not applied`);
    if (!b.skuToken)
      warnings.push(`${b.name} has no SKU token of its own in Origio; new styles derive ${token ?? "none"}`);
    if (b.archived) warnings.push(`${b.name} is archived in Origio`);
    const linkTo = b.loomBrandId ?? loomId;
    if (!dryRun && loomId && !b.loomBrandId) {
      // Guarded on null so a race cannot overwrite another link.
      await prisma.brand.updateMany({ where: { id: b.id, loomBrandId: null }, data: { loomBrandId: loomId } });
    }
    return {
      loom_key: key,
      ok: true,
      origio_brand_id: b.id,
      name: b.name,
      sku_token: token,
      existed: true,
      loom_brand_id: linkTo,
      is_livid: b.isLivid,
      warnings,
    };
  }

  // --- new brand ---
  if (name.toLowerCase().includes("livid"))
    return { loom_key: key, ok: false, error: "Livid product comes from Threadflow; Origio creates external brands only" };
  const norm = normalizeBrandName(name);
  const again = planned.get(norm);
  if (again) return { ...again, loom_key: key };

  const styles = await prisma.style.findMany({
    where: { styleSku: { startsWith: "EXT-" } },
    select: { styleSku: true, brand: { select: { name: true } } },
  });
  const taken = takenTokens(
    all,
    styles.map((s) => ({ styleSku: s.styleSku, brandName: s.brand?.name ?? null }))
  );
  const choice = chooseToken(name, given, taken);
  if (!choice.ok) return { loom_key: key, ok: false, error: choice.error };

  const warnings = [`${name} has no customs defaults in Origio yet; products are created without them`];
  if (dryRun) {
    const r: BrandResult = {
      loom_key: key,
      ok: true,
      origio_brand_id: null,
      name,
      sku_token: choice.token,
      existed: false,
      loom_brand_id: loomId,
      is_livid: false,
      warnings,
    };
    planned.set(norm, r);
    return r;
  }

  const created = await prisma.$transaction(async (tx) => {
    const b = await tx.brand.create({
      data: { name, isLivid: false, skuToken: choice.token, normalizedName: norm, loomBrandId: loomId },
      select: { id: true, name: true },
    });
    await tx.brandTemplate.create({ data: { brandId: b.id } });
    return b;
  });
  return {
    loom_key: key,
    ok: true,
    origio_brand_id: created.id,
    name: created.name,
    sku_token: choice.token,
    existed: false,
    loom_brand_id: loomId,
    is_livid: false,
    warnings,
  };
}
