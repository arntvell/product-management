// The category model: one vocabulary, mapped outward, archivable.
//
// Merging writes a TOMBSTONE and never deletes — the same posture
// merge-colorways.ts takes, which is why the 21 merges it has done can still be
// explained. A category with historic products behind it is not disposable just
// because nobody should pick it again; `archived` says "never offer this",
// `active` says "offer this in the builder", and they are different questions.

import { prisma } from "@/lib/db";
import { LOOM_CATEGORIES } from "./loom-category";
import { categorySlug, normalizeCategoryKey, type RefSystem } from "./reference-pull";

export class CategoryError extends Error {}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
  active: boolean;
  archived: boolean;
  shopifyProductType: string | null;
  loomCategory: string | null;
  sitooCategoryId: string | null;
  /** How many external values resolve here, by system. */
  mapped: Record<string, number>;
  styles: number;
  colorways: number;
}

export interface UnmappedValue {
  id: string;
  system: string;
  externalKey: string;
  externalName: string;
  externalPath: string | null;
  productCount: number;
}

export async function listCategoryTree(
  opts: { includeArchived?: boolean } = {}
): Promise<CategoryNode[]> {
  const rows = await prisma.category.findMany({
    where: opts.includeArchived ? {} : { archived: false },
    orderBy: [{ path: "asc" }],
    select: {
      id: true,
      slug: true,
      name: true,
      parentId: true,
      path: true,
      depth: true,
      active: true,
      archived: true,
      shopifyProductType: true,
      loomCategory: true,
      sitooCategoryId: true,
      channelMaps: { select: { system: true } },
      _count: { select: { styles: true, colorways: true } },
    },
  });
  return rows.map((r) => {
    const mapped: Record<string, number> = {};
    for (const m of r.channelMaps) mapped[m.system] = (mapped[m.system] ?? 0) + 1;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      parentId: r.parentId,
      path: r.path,
      depth: r.depth,
      active: r.active,
      archived: r.archived,
      shopifyProductType: r.shopifyProductType,
      loomCategory: r.loomCategory,
      sitooCategoryId: r.sitooCategoryId,
      mapped,
      styles: r._count.styles,
      colorways: r._count.colorways,
    };
  });
}

export async function listUnmapped(system?: RefSystem): Promise<UnmappedValue[]> {
  const rows = await prisma.categoryChannelMap.findMany({
    where: { categoryId: null, ...(system ? { system } : {}) },
    // Most-used first: the review queue should start where the catalogue is.
    orderBy: [{ productCount: "desc" }, { externalName: "asc" }],
    take: 500,
  });
  return rows.map((r) => ({
    id: r.id,
    system: r.system,
    externalKey: r.externalKey,
    externalName: r.externalName,
    externalPath: r.externalPath,
    productCount: r.productCount,
  }));
}

export interface CreateCategoryInput {
  name: string;
  parentId?: string | null;
  shopifyProductType?: string | null;
  loomCategory?: string | null;
  sitooCategoryId?: string | null;
}

export async function createCategory(input: CreateCategoryInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new CategoryError("A category needs a name.");
  if (input.loomCategory && !LOOM_CATEGORIES.includes(input.loomCategory as never))
    throw new CategoryError(
      `"${input.loomCategory}" is not one of Loom's categories (${LOOM_CATEGORIES.join(", ")}).`
    );

  const slug = categorySlug(name);
  const clash = await prisma.category.findUnique({ where: { slug } });
  if (clash) throw new CategoryError(`"${clash.name}" already covers that name.`);

  const parent = input.parentId
    ? await prisma.category.findUnique({ where: { id: input.parentId } })
    : null;

  const created = await prisma.category.create({
    data: {
      slug,
      name,
      parentId: parent?.id ?? null,
      path: parent ? `${parent.path}/${slug}` : slug,
      depth: parent ? parent.depth + 1 : 0,
      shopifyProductType: input.shopifyProductType?.trim() || null,
      loomCategory: input.loomCategory?.trim() || null,
      sitooCategoryId: input.sitooCategoryId?.trim() || null,
    },
    select: { id: true },
  });
  return created.id;
}

/** Point an observed external value at a category. */
export async function mapExternalValue(mapId: string, categoryId: string | null): Promise<void> {
  const map = await prisma.categoryChannelMap.findUnique({ where: { id: mapId } });
  if (!map) throw new CategoryError("That value is not in the review queue.");
  if (categoryId) {
    const cat = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!cat) throw new CategoryError("Category not found.");
  }
  await prisma.categoryChannelMap.update({
    where: { id: mapId },
    data: { categoryId },
  });

  // Mapping teaches the outbound value the channel actually uses. Sitoo's is an
  // id we cannot derive from a name; Loom's is its own vocabulary word, which
  // `toLoomCategory` can only GUESS at from our text. Without this the Loom half
  // of the queue was inert — a person could map all 11 and nothing would change,
  // which is worse than not offering it.
  //
  // Shopify is deliberately absent: `shopifyProductType` is already set and is
  // what live products send today, so writing Shopify's spelling here would
  // silently re-type 4,584 products on their next push. That is a deliberate
  // edit on the category screen, not a side effect of filing a review row.
  if (categoryId && map.system === "SITOO") {
    await prisma.category.update({
      where: { id: categoryId },
      data: { sitooCategoryId: map.externalKey },
    });
  }
  if (categoryId && map.system === "LOOM" && LOOM_CATEGORIES.includes(map.externalName as never)) {
    await prisma.category.update({
      where: { id: categoryId },
      data: { loomCategory: map.externalName },
    });
  }
}

export interface MergeResult {
  maps: number;
  styles: number;
  colorways: number;
}

/**
 * Fold `loserId` into `winnerId`.
 *
 * A tombstone, never a delete: the loser keeps its row, gains `mergedIntoId` and
 * is archived. Deleting it would break every historic product that points at it
 * and lose the record that the two were ever the same thing.
 */
export async function mergeCategories(loserId: string, winnerId: string): Promise<MergeResult> {
  if (loserId === winnerId) throw new CategoryError("A category cannot merge into itself.");
  const [loser, winner] = await Promise.all([
    prisma.category.findUnique({ where: { id: loserId } }),
    prisma.category.findUnique({ where: { id: winnerId } }),
  ]);
  if (!loser || !winner) throw new CategoryError("Category not found.");
  if (winner.mergedIntoId)
    throw new CategoryError(`"${winner.name}" has itself been merged away; pick its survivor.`);

  return prisma.$transaction(async (tx) => {
    const maps = await tx.categoryChannelMap.updateMany({
      where: { categoryId: loserId },
      data: { categoryId: winnerId },
    });
    const styles = await tx.style.updateMany({
      where: { categoryId: loserId },
      data: { categoryId: winnerId },
    });
    const colorways = await tx.colorway.updateMany({
      where: { categoryId: loserId },
      data: { categoryId: winnerId },
    });
    // Children follow the survivor rather than being orphaned.
    await tx.category.updateMany({ where: { parentId: loserId }, data: { parentId: winnerId } });
    await tx.category.update({
      where: { id: loserId },
      data: { mergedIntoId: winnerId, archived: true, active: false },
    });
    // The survivor inherits any outbound value it lacks.
    await tx.category.update({
      where: { id: winnerId },
      data: {
        shopifyProductType: winner.shopifyProductType ?? loser.shopifyProductType,
        loomCategory: winner.loomCategory ?? loser.loomCategory,
        sitooCategoryId: winner.sitooCategoryId ?? loser.sitooCategoryId,
      },
    });
    return { maps: maps.count, styles: styles.count, colorways: colorways.count };
  });
}

export async function setCategoryFlags(
  id: string,
  flags: { active?: boolean; archived?: boolean }
): Promise<void> {
  await prisma.category.update({ where: { id }, data: flags });
}

export async function updateCategoryOutbound(
  id: string,
  values: {
    shopifyProductType?: string | null;
    loomCategory?: string | null;
    sitooCategoryId?: string | null;
  }
): Promise<void> {
  if (values.loomCategory && !LOOM_CATEGORIES.includes(values.loomCategory as never))
    throw new CategoryError(
      `"${values.loomCategory}" is not one of Loom's categories (${LOOM_CATEGORIES.join(", ")}).`
    );
  await prisma.category.update({
    where: { id },
    data: {
      ...(values.shopifyProductType !== undefined
        ? { shopifyProductType: values.shopifyProductType?.trim() || null }
        : {}),
      ...(values.loomCategory !== undefined
        ? { loomCategory: values.loomCategory?.trim() || null }
        : {}),
      ...(values.sitooCategoryId !== undefined
        ? { sitooCategoryId: values.sitooCategoryId?.trim() || null }
        : {}),
    },
  });
}

export interface AdoptResult {
  created: number;
  mappedValues: number;
  styles: number;
  colorways: number;
  dryRun: boolean;
}

/**
 * Seed the model from Origio's own category strings, and point the existing
 * products at it.
 *
 * This is the bootstrap: without it every one of the 93 values sits unmapped and
 * somebody has to type them all back in. It creates a Category per distinct
 * Origio value, maps the ORIGIO queue rows to it, and sets `categoryId` on the
 * styles and colorways that carry that text — leaving the text column exactly
 * as it is.
 */
export async function adoptOrigioCategories(
  opts: { dryRun?: boolean } = {}
): Promise<AdoptResult> {
  const rows = await prisma.categoryChannelMap.findMany({
    where: { system: "ORIGIO" },
  });

  let created = 0;
  let mappedValues = 0;
  let styles = 0;
  let colorways = 0;

  for (const row of rows) {
    const slug = categorySlug(row.externalName);
    let cat = await prisma.category.findUnique({ where: { slug } });
    if (!cat) {
      if (opts.dryRun) {
        created++;
        continue;
      }
      cat = await prisma.category.create({
        data: {
          slug,
          name: row.externalName,
          path: slug,
          depth: 0,
          // Origio's own spelling is the natural Shopify productType, since that
          // is where most of these came from in the first place.
          shopifyProductType: row.externalName,
        },
      });
      created++;
    }
    if (opts.dryRun) {
      mappedValues++;
      continue;
    }

    if (!row.categoryId) {
      await prisma.categoryChannelMap.update({
        where: { id: row.id },
        data: { categoryId: cat.id },
      });
      mappedValues++;
    }

    const s = await prisma.style.updateMany({
      where: { categoryId: null, category: { equals: row.externalName, mode: "insensitive" } },
      data: { categoryId: cat.id },
    });
    const c = await prisma.colorway.updateMany({
      where: { categoryId: null, productType: { equals: row.externalName, mode: "insensitive" } },
      data: { categoryId: cat.id },
    });
    styles += s.count;
    colorways += c.count;
  }

  return { created, mappedValues, styles, colorways, dryRun: Boolean(opts.dryRun) };
}

export { normalizeCategoryKey };

export interface ExactCategoryLinkResult {
  linked: Record<string, number>;
  sitooIds: number;
  loomWords: number;
  unmatched: { system: string; externalName: string; externalKey: string; productCount: number }[];
  ambiguous: { system: string; externalName: string; candidates: string[] }[];
  /** One Origio category matched by SEVERAL values of the same channel — a
   *  duplicate inside that channel. The busiest wins; the rest are reported so
   *  somebody can merge them at the source. */
  collisions: { system: string; category: string; kept: string; dropped: string[] }[];
  dryRun: boolean;
}

/**
 * Link every pulled category value that matches exactly one Origio category.
 *
 * Same argument as `linkExactBrandRefs`, and the same limit — "exactly one" or
 * it goes to a person. What makes this one matter more is the Sitoo id: 83 Sitoo
 * categories were pulled and not one id was stored, so `categoryRef.sitooCategoryId`
 * resolved to null for every product and a Sitoo create carried no category at
 * all. That is the duplicate this model exists to prevent.
 *
 * Outbound-safe by construction: linking sets Sitoo's id and Loom's own word,
 * and never touches `shopifyProductType`, which live products already send.
 */
export async function linkExactCategoryValues(
  opts: { dryRun?: boolean } = {}
): Promise<ExactCategoryLinkResult> {
  const [rows, cats] = await Promise.all([
    prisma.categoryChannelMap.findMany({ where: { categoryId: null } }),
    prisma.category.findMany({ where: { archived: false }, select: { id: true, name: true } }),
  ]);

  const byKey = new Map<string, { id: string; name: string }[]>();
  for (const c of cats) {
    const k = normalizeCategoryKey(c.name);
    byKey.set(k, [...(byKey.get(k) ?? []), c]);
  }

  const result: ExactCategoryLinkResult = {
    linked: {},
    sitooIds: 0,
    loomWords: 0,
    unmatched: [],
    ambiguous: [],
    collisions: [],
    dryRun: Boolean(opts.dryRun),
  };
  const matched: { row: (typeof rows)[number]; categoryId: string }[] = [];

  for (const r of rows) {
    const hits = byKey.get(normalizeCategoryKey(r.externalName)) ?? [];
    if (hits.length === 1) {
      matched.push({ row: r, categoryId: hits[0].id });
      result.linked[r.system] = (result.linked[r.system] ?? 0) + 1;
      if (r.system === "SITOO") result.sitooIds++;
      if (r.system === "LOOM" && LOOM_CATEGORIES.includes(r.externalName as never))
        result.loomWords++;
    } else if (hits.length > 1)
      result.ambiguous.push({
        system: r.system,
        externalName: r.externalName,
        candidates: hits.map((h) => h.name),
      });
    else
      result.unmatched.push({
        system: r.system,
        externalName: r.externalName,
        externalKey: r.externalKey,
        productCount: r.productCount,
      });
  }

  // A channel can hold two categories of the same name — Sitoo has two called
  // "Bottoms", ids 6 and 24. Both match one Origio category, and only one id can
  // be the outbound value. Take the one with the most product behind it, and
  // REPORT the rest: an arbitrary winner here would be a silent decision about
  // where new product lands, and the duplicate belongs on someone's list.
  const winner = new Map<string, (typeof rows)[number]>();
  for (const m of matched) {
    const key = `${m.row.system}:${m.categoryId}`;
    const held = winner.get(key);
    if (!held || m.row.productCount > held.productCount) winner.set(key, m.row);
  }
  const byKeyRows = new Map<string, (typeof rows)[number][]>();
  for (const m of matched) {
    const key = `${m.row.system}:${m.categoryId}`;
    byKeyRows.set(key, [...(byKeyRows.get(key) ?? []), m.row]);
  }
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  for (const [key, group] of byKeyRows) {
    if (group.length < 2) continue;
    const kept = winner.get(key)!;
    result.collisions.push({
      system: group[0].system,
      category: catName.get(key.split(":")[1]) ?? key,
      kept: `${kept.externalName} [${kept.externalKey}] (${kept.productCount} products)`,
      dropped: group
        .filter((g) => g.id !== kept.id)
        .map((g) => `${g.externalName} [${g.externalKey}] (${g.productCount} products)`),
    });
  }

  if (!opts.dryRun) {
    const byCategory = new Map<string, string[]>();
    for (const m of matched)
      byCategory.set(m.categoryId, [...(byCategory.get(m.categoryId) ?? []), m.row.id]);
    for (const [categoryId, ids] of byCategory)
      await prisma.categoryChannelMap.updateMany({ where: { id: { in: ids } }, data: { categoryId } });

    // Only the winning row per (system, category) writes an outbound value.
    for (const [key, row] of winner) {
      const categoryId = key.split(":")[1];
      if (row.system === "SITOO")
        await prisma.category.update({
          where: { id: categoryId },
          data: { sitooCategoryId: row.externalKey },
        });
      if (row.system === "LOOM" && LOOM_CATEGORIES.includes(row.externalName as never))
        await prisma.category.update({
          where: { id: categoryId },
          data: { loomCategory: row.externalName },
        });
    }
  }
  return result;
}

/**
 * Recompute each category's outbound Sitoo id and Loom word from the links that
 * already exist, busiest channel row wins.
 *
 * Separate from `linkExactCategoryValues` because that one only ever looks at
 * UNLINKED rows — so once a wrong winner is stored, re-running it is a no-op and
 * the wrong value is stuck. This is the repair, and it is idempotent: run it any
 * time the links change and the outbound values follow.
 */
export async function reconcileCategoryOutbound(
  opts: { dryRun?: boolean } = {}
): Promise<{ changed: { category: string; system: string; from: string | null; to: string }[] }> {
  const rows = await prisma.categoryChannelMap.findMany({
    where: { categoryId: { not: null }, system: { in: ["SITOO", "LOOM"] } },
    select: {
      system: true,
      externalKey: true,
      externalName: true,
      productCount: true,
      categoryId: true,
      category: { select: { name: true, sitooCategoryId: true, loomCategory: true } },
    },
  });

  const winner = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const key = `${r.system}:${r.categoryId}`;
    const held = winner.get(key);
    if (!held || r.productCount > held.productCount) winner.set(key, r);
  }

  const changed: { category: string; system: string; from: string | null; to: string }[] = [];
  for (const [key, row] of winner) {
    const categoryId = key.split(":")[1];
    if (row.system === "SITOO" && row.category!.sitooCategoryId !== row.externalKey) {
      changed.push({
        category: row.category!.name,
        system: "SITOO",
        from: row.category!.sitooCategoryId,
        to: row.externalKey,
      });
      if (!opts.dryRun)
        await prisma.category.update({
          where: { id: categoryId },
          data: { sitooCategoryId: row.externalKey },
        });
    }
    if (
      row.system === "LOOM" &&
      LOOM_CATEGORIES.includes(row.externalName as never) &&
      row.category!.loomCategory !== row.externalName
    ) {
      changed.push({
        category: row.category!.name,
        system: "LOOM",
        from: row.category!.loomCategory,
        to: row.externalName,
      });
      if (!opts.dryRun)
        await prisma.category.update({
          where: { id: categoryId },
          data: { loomCategory: row.externalName },
        });
    }
  }
  return { changed };
}
