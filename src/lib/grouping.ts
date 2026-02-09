import type { Product, ProductGroup } from "@/types";
import { parseGidList } from "./utils";

const LIVID_VENDORS = ["Livid Jeans", "Livid Unisex"];

/**
 * Auto-detect product groups by finding products that share a base name
 * within the same vendor + product type.
 *
 * Algorithm:
 * 1. Group products by (vendor, productType)
 * 2. Within each group, find the longest common prefix for subsets of titles
 * 3. Group products by their detected base name
 * 4. Filter out single-product groups
 */
export function detectProductGroups(products: Product[]): ProductGroup[] {
  // Step 1: Group by vendor + type
  const vendorTypeGroups = new Map<string, Product[]>();
  for (const product of products) {
    const key = `${product.vendor}|||${product.productType}`;
    const group = vendorTypeGroups.get(key) || [];
    group.push(product);
    vendorTypeGroups.set(key, group);
  }

  const allGroups: ProductGroup[] = [];

  // Step 2: Within each vendor+type group, detect base names
  for (const [, groupProducts] of vendorTypeGroups) {
    if (groupProducts.length < 2) continue;

    const baseNameGroups = detectBaseNames(groupProducts);

    for (const [baseName, members] of baseNameGroups) {
      if (members.length < 2) continue;

      const linkStatus = computeLinkStatus(members);
      const groupId = `${members[0].vendor}--${members[0].productType}--${baseName}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");

      allGroups.push({
        id: groupId,
        baseName,
        vendor: members[0].vendor,
        productType: members[0].productType,
        members,
        linkStatus,
      });
    }
  }

  return allGroups.sort((a, b) => a.baseName.localeCompare(b.baseName));
}

/**
 * For a set of products (same vendor+type), detect base names by finding
 * the longest common prefix between title pairs, then clustering.
 */
function detectBaseNames(products: Product[]): Map<string, Product[]> {
  const titles = products.map((p) => p.title);
  const baseNames = new Map<string, Product[]>();

  // For each pair, compute the word-level common prefix
  // Then take the most frequent prefixes as base names
  const prefixCounts = new Map<string, Set<number>>();

  for (let i = 0; i < titles.length; i++) {
    for (let j = i + 1; j < titles.length; j++) {
      const prefix = longestCommonWordPrefix(titles[i], titles[j]);
      if (prefix.length > 0) {
        const existing = prefixCounts.get(prefix) || new Set();
        existing.add(i);
        existing.add(j);
        prefixCounts.set(prefix, existing);
      }
    }
  }

  // Sort prefixes by length (longest first) to prefer more specific groupings
  const sortedPrefixes = [...prefixCounts.entries()].sort(
    (a, b) => b[0].length - a[0].length
  );

  const assigned = new Set<number>();

  for (const [prefix, indices] of sortedPrefixes) {
    // Only consider prefixes that match at least 2 unassigned products
    const unassigned = [...indices].filter((i) => !assigned.has(i));
    if (unassigned.length < 2) continue;

    // Also check for any other unassigned products that share this prefix
    for (let i = 0; i < products.length; i++) {
      if (!assigned.has(i) && products[i].title.startsWith(prefix)) {
        // Check the suffix is a reasonable variant name (not empty after trimming)
        const suffix = products[i].title.slice(prefix.length).trim();
        if (suffix.length > 0) {
          unassigned.push(i);
        }
      }
    }

    const uniqueIndices = [...new Set(unassigned)];
    if (uniqueIndices.length < 2) continue;

    const members = uniqueIndices.map((i) => products[i]);
    baseNames.set(prefix.trim(), members);
    uniqueIndices.forEach((i) => assigned.add(i));
  }

  return baseNames;
}

/**
 * Find the longest common prefix at word boundaries.
 * "Amber Japan Blue Scurry" + "Amber Japan Fog" → "Amber Japan"
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

  // Don't return the prefix if it covers ALL words of both titles (they're identical)
  if (
    commonWords.length === wordsA.length &&
    commonWords.length === wordsB.length
  ) {
    return "";
  }

  // Need at least one common word, and the prefix shouldn't be just a generic word
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
 * Filters to Livid vendors, runs grouping, returns a map of
 * productId -> suggested linked IDs (excluding already-linked).
 */
export function detectLividAutoLinks(
  products: Product[]
): Map<string, string[]> {
  const lividProducts = products.filter((p) =>
    LIVID_VENDORS.includes(p.vendor)
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
