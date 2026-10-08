// Creating a category in Sitoo's navigation, from Origo.
//
// Origo only ever READ Sitoo's categories (Pull references), so a category
// Sitoo did not have — Jewelry, for Tom Wood — meant someone opening Sitoo's
// admin, then pulling, then choosing it. Until then the Sitoo push refused every
// product filed under the Origo category. This creates it in the till and
// records it, the way brand-create.ts does for manufacturers.

import { prisma } from "@/lib/db";
import {
  createCategory as createSitooCategory,
  listCategories,
  sitooConfigured,
  type SitooTarget,
} from "@/lib/sitoo/client";
import { nearlySame } from "./brands";
import { CategoryError } from "./categories";

/** Always the live till — see brand-create.ts for the sandbox-id leak this avoids. */
const TARGET: SitooTarget = "production";

const key = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

export type SitooCategoryResult =
  | { ok: true; action: "created" | "linked-existing"; id: string; label: string }
  | { ok: false; similar: { id: string; label: string }[] };

/**
 * Link Sitoo's category of this name under this parent, or create it.
 *
 * Sitoo is read first: an exact name under the same parent is the same
 * category, and linking it avoids a duplicate in the till's navigation. A near
 * miss anywhere (a plural, "Jewellery" against "Jewelry") is returned for a
 * person to decide on. `categoryId`, when given, also sets that Origo
 * category's Sitoo navigation.
 */
export async function linkOrCreateSitooCategory(input: {
  name: string;
  parentSitooId?: string | null;
  categoryId?: string | null;
  confirmSimilar?: boolean;
}): Promise<SitooCategoryResult> {
  const name = input.name?.trim().replace(/\s+/g, " ") ?? "";
  if (!name) throw new CategoryError("Give the Sitoo category a name.");
  if (!sitooConfigured(TARGET))
    throw new CategoryError(
      "Sitoo is not configured in this environment (SITOO_BASE_URL / SITOO_API_ID / SITOO_API_KEY)."
    );

  const existing = await listCategories(TARGET);
  if (existing.source !== "endpoint")
    throw new CategoryError(
      `Could not read Sitoo's categories, so a duplicate cannot be ruled out. ${existing.note ?? ""}`.trim()
    );
  const byId = new Map(existing.items.map((c) => [String(c.categoryid), c]));
  const pathOf = (id: string): string => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = byId.get(id);
    while (cur && !seen.has(String(cur.categoryid))) {
      seen.add(String(cur.categoryid));
      parts.unshift(cur.title?.trim() || String(cur.categoryid));
      cur = cur.categoryparentid ? byId.get(String(cur.categoryparentid)) : undefined;
    }
    return parts.join(" > ");
  };

  const parentId = input.parentSitooId?.trim() || null;
  if (parentId && !byId.has(parentId))
    throw new CategoryError(`Sitoo has no category ${parentId} to put this under.`);

  const k = key(name);
  const same = existing.items.find(
    (c) => key(c.title ?? "") === k && String(c.categoryparentid ?? "") === String(parentId ?? "")
  );
  if (same) {
    const id = String(same.categoryid);
    await record(id, same.title ?? name, pathOf(id), input.categoryId);
    return { ok: true, action: "linked-existing", id, label: pathOf(id) };
  }

  if (!input.confirmSimilar) {
    const similar = existing.items
      .filter((c) => {
        const ck = key(c.title ?? "");
        return ck && nearlySame(k, ck);
      })
      .map((c) => ({ id: String(c.categoryid), label: pathOf(String(c.categoryid)) }));
    if (similar.length) return { ok: false, similar };
  }

  const newId = String(
    await createSitooCategory(
      { title: name, ...(parentId ? { categoryparentid: Number(parentId) } : {}) },
      TARGET
    )
  );
  const label = parentId ? `${pathOf(parentId)} > ${name}` : name;
  await record(newId, name, label, input.categoryId);
  return { ok: true, action: "created", id: newId, label };
}

/** Keep the pulled-reference table current, so every dropdown offers it at once. */
async function record(id: string, name: string, path: string, categoryId?: string | null) {
  await prisma.categoryChannelMap.upsert({
    where: { system_externalKey: { system: "SITOO", externalKey: id } },
    create: { system: "SITOO", externalKey: id, externalName: name, externalPath: path },
    update: { externalName: name, externalPath: path, lastSeenAt: new Date() },
  });
  if (categoryId)
    await prisma.category.update({ where: { id: categoryId }, data: { sitooCategoryId: id } });
}
