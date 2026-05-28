import type { Product, ProductGroup } from "@/types";
import { parseGidList } from "./utils";

const LIVID_VENDORS = ["Livid Jeans", "Livid Unisex"];

// Products matching these patterns are excluded from auto-grouping
const EXCLUDE_FROM_GROUPING = /vintage|used|preloved/i;

function isExcluded(product: Product): boolean {
  return (
    EXCLUDE_FROM_GROUPING.test(product.productType) ||
    EXCLUDE_FROM_GROUPING.test(product.title) ||
    product.tags.some((t) => EXCLUDE_FROM_GROUPING.test(t))
  );
}

/**
 * Auto-detect product groups by finding products that share a base name
 * within the same vendor, using union-find so that transitively connected
 * names (e.g. Boston Suede Taupe + Boston Suede Black + Boston Taupe) all
 * land in the same group regardless of how specific each pairwise prefix is.
 *
 * Vintage / used goods are excluded entirely from grouping.
 */
export function detectProductGroups(products: Product[]): ProductGroup[] {
  // Only group active (and draft) non-vintage products
  const eligible = products.filter(
    (p) => p.status !== "ARCHIVED" && !isExcluded(p)
  );

  // Group by vendor
  const vendorGroups = new Map<string, Product[]>();
  for (const product of eligible) {
    const key = product.vendor;
    const group = vendorGroups.get(key) ?? [];
    group.push(product);
    vendorGroups.set(key, group);
  }

  const allGroups: ProductGroup[] = [];

  for (const [, groupProducts] of vendorGroups) {
    if (groupProducts.length < 2) continue;

    const baseNameGroups = detectBaseNames(groupProducts);

    for (const [baseName, members] of baseNameGroups) {
      if (members.length < 2) continue;

      const linkStatus = computeLinkStatus(members);

      // Use most common productType for the group card label
      const typeCounts = new Map<string, number>();
      for (const m of members)
        typeCounts.set(m.productType, (typeCounts.get(m.productType) ?? 0) + 1);
      const productType = [...typeCounts.entries()].sort(
        (a, b) => b[1] - a[1]
      )[0][0];

      const groupId = `${members[0].vendor}--${baseName}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");

      allGroups.push({
        id: groupId,
        baseName,
        vendor: members[0].vendor,
        productType,
        members,
        linkStatus,
      });
    }
  }

  return allGroups.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

/**
 * For a set of products (same vendor), detect base name groups using
 * union-find so that transitively related products end up in the same group.
 *
 * Example: "Boston Suede Taupe" + "Boston Suede Black" + "Boston Taupe"
 * - Pair 1-2 share "Boston Suede"
 * - Pair 1-3 share "Boston"
 * - All three end up in one group with base name "Boston"
 */
function detectBaseNames(products: Product[]): Map<string, Product[]> {
  const n = products.length;

  // Union-Find
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(x: number, y: number) {
    parent[find(x)] = find(y);
  }

  // Add edge between any two products that share at least one common word prefix
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const prefix = longestCommonWordPrefix(
        products[i].title,
        products[j].title
      );
      if (prefix.length > 0) union(i, j);
    }
  }

  // Collect connected components
  const components = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const group = components.get(root) ?? [];
    group.push(i);
    components.set(root, group);
  }

  // Compute base name for each component = minimum pairwise common prefix
  const baseNames = new Map<string, Product[]>();
  for (const [, indices] of components) {
    if (indices.length < 2) continue;

    const members = indices.map((i) => products[i]);

    // Iteratively narrow down the base name to the shortest prefix
    // shared across all members
    let baseName = members[0].title;
    for (const m of members.slice(1)) {
      const p = longestCommonWordPrefix(baseName, m.title);
      if (p.length > 0 && p.length < baseName.length) {
        baseName = p;
      }
    }
    baseName = baseName.trim();
    if (baseName) baseNames.set(baseName, members);
  }

  return baseNames;
}

/**
 * Find the longest common prefix at word boundaries.
 * "Amber Japan Blue Scurry" + "Amber Japan Fog" → "Amber Japan "
 */
function longestCommonWordPrefix(a: string, b: string): string {
  const wordsA = a.split(/\s+/);
  const wordsB = b.split(/\s+/);
  const commonWords: string[] = [];

  for (let i = 0; i < Math.min(wordsA.length, wordsB.length); i++) {
    if (wordsA[i] === wordsB[i]) {
      commonWords.push(wordsA[i]);
    } else {
      break;
    }
  }

  // Don't return the prefix if it covers ALL words of both titles (identical)
  if (
    commonWords.length === wordsA.length &&
    commonWords.length === wordsB.length
  ) {
    return "";
  }

  if (commonWords.length === 0) return "";

  return commonWords.join(" ") + " ";
}

/**
 * Determine the link status of a group based on their same_product metafields.
 */
function computeLinkStatus(
  members: Product[]
): "linked" | "partially_linked" | "not_linked" {
  const memberIds = new Set(members.map((m) => m.id));
  let fullyLinked = 0;
  let partiallyLinked = 0;

  for (const member of members) {
    const linkedIds = parseGidList(member.metafields.same_product);
    const otherMemberIds = [...memberIds].filter((id) => id !== member.id);
    const linkedOthers = otherMemberIds.filter((id) => linkedIds.includes(id));

    if (linkedOthers.length === otherMemberIds.length) {
      fullyLinked++;
    } else if (linkedOthers.length > 0) {
      partiallyLinked++;
    }
  }

  if (fullyLinked === members.length) return "linked";
  if (fullyLinked > 0 || partiallyLinked > 0) return "partially_linked";
  return "not_linked";
}

/**
 * Auto-detect Livid product groups and suggest same_product links.
 */
export function detectLividAutoLinks(
  products: Product[]
): Map<string, string[]> {
  const lividProducts = products.filter(
    (p) =>
      LIVID_VENDORS.includes(p.vendor) &&
      p.status !== "ARCHIVED" &&
      !isExcluded(p)
  );

  const groups = detectProductGroups(lividProducts);
  const suggestions = new Map<string, string[]>();

  for (const group of groups) {
    const memberIds = group.members.map((m) => m.id);

    for (const member of group.members) {
      const currentLinks = parseGidList(member.metafields.same_product);
      const otherIds = memberIds.filter((id) => id !== member.id);
      const newLinks = otherIds.filter((id) => !currentLinks.includes(id));

      if (newLinks.length > 0) {
        suggestions.set(member.id, [...currentLinks, ...newLinks]);
      }
    }
  }

  return suggestions;
}
