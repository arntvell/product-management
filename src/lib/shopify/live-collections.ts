// Shopify collections, read and written live — the Collections module of the
// live store editor. Nothing here goes through the master: an edit is a
// collectionUpdate / metafieldsSet on the store, immediately.
//
// The metafield columns are not a hard-coded list (the Products editor's
// METAFIELD_DEFINITIONS is): they are whatever collection metafield
// definitions the store has, so a definition added in Shopify admin shows up
// here without a code change. SEO title and description are collection fields
// (`seo`), which Shopify stores as global.title_tag / description_tag.

import { shopifyGraphQL } from "./client";

export interface CollectionMetafieldDef {
  /** "custom.show-image" */
  id: string;
  namespace: string;
  key: string;
  name: string;
  /** Shopify type name: boolean, date_time, single_line_text_field, … */
  type: string;
}

export interface LiveCollection {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  updatedAt: string;
  sortOrder: string;
  templateSuffix: string;
  image: { url: string; altText: string | null } | null;
  seoTitle: string;
  seoDescription: string;
  /** Rule-based ("smart") when set; membership is Shopify's to decide. */
  rules: { column: string; relation: string; condition: string }[] | null;
  disjunctive: boolean;
  productsCount: number;
  published: boolean;
  /** "namespace.key" -> value, for the defined metafields only. */
  metafields: Record<string, string>;
}

export const SORT_ORDERS = [
  "MANUAL",
  "BEST_SELLING",
  "ALPHA_ASC",
  "ALPHA_DESC",
  "PRICE_DESC",
  "PRICE_ASC",
  "CREATED",
  "CREATED_DESC",
] as const;

const DEFS_QUERY = `{
  metafieldDefinitions(ownerType: COLLECTION, first: 100) {
    nodes { namespace key name type { name } }
  }
}`;

const LIST_QUERY = `query($after: String) {
  collections(first: 100, after: $after, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle descriptionHtml updatedAt sortOrder templateSuffix
      image { url altText }
      seo { title description }
      ruleSet { appliedDisjunctively rules { column relation condition } }
      productsCount { count }
      resourcePublicationsV2(first: 10) { nodes { isPublished } }
      metafields(first: 50) { nodes { namespace key value } }
    }
  }
}`;

export async function collectionMetafieldDefs(): Promise<CollectionMetafieldDef[]> {
  const r = await shopifyGraphQL<{
    metafieldDefinitions: { nodes: { namespace: string; key: string; name: string; type: { name: string } }[] };
  }>(DEFS_QUERY);
  return r.metafieldDefinitions.nodes
    .map((d) => ({ id: `${d.namespace}.${d.key}`, namespace: d.namespace, key: d.key, name: d.name, type: d.type.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listLiveCollections(defs: CollectionMetafieldDef[]): Promise<LiveCollection[]> {
  const wanted = new Set(defs.map((d) => d.id));
  const out: LiveCollection[] = [];
  let after: string | null = null;
  do {
    type Node = {
      id: string;
      title: string;
      handle: string;
      descriptionHtml: string;
      updatedAt: string;
      sortOrder: string;
      templateSuffix: string | null;
      image: { url: string; altText: string | null } | null;
      seo: { title: string | null; description: string | null };
      ruleSet: { appliedDisjunctively: boolean; rules: { column: string; relation: string; condition: string }[] } | null;
      productsCount: { count: number } | null;
      resourcePublicationsV2: { nodes: { isPublished: boolean }[] };
      metafields: { nodes: { namespace: string; key: string; value: string }[] };
    };
    const r: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Node[] } } =
      await shopifyGraphQL(LIST_QUERY, { after });
    for (const c of r.collections.nodes) {
      const metafields: Record<string, string> = {};
      for (const m of c.metafields.nodes) {
        const k = `${m.namespace}.${m.key}`;
        if (wanted.has(k)) metafields[k] = m.value;
      }
      out.push({
        id: c.id,
        title: c.title,
        handle: c.handle,
        descriptionHtml: c.descriptionHtml ?? "",
        updatedAt: c.updatedAt,
        sortOrder: c.sortOrder,
        templateSuffix: c.templateSuffix ?? "",
        image: c.image,
        seoTitle: c.seo?.title ?? "",
        seoDescription: c.seo?.description ?? "",
        rules: c.ruleSet?.rules ?? null,
        disjunctive: !!c.ruleSet?.appliedDisjunctively,
        productsCount: c.productsCount?.count ?? 0,
        published: c.resourcePublicationsV2.nodes.some((n) => n.isPublished),
        metafields,
      });
    }
    after = r.collections.pageInfo.hasNextPage ? r.collections.pageInfo.endCursor : null;
  } while (after);
  return out;
}

/** The collection fields this editor writes. Anything absent is left alone. */
export interface CollectionFieldChanges {
  title?: string;
  handle?: string;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  sortOrder?: string;
  templateSuffix?: string;
}

export interface CollectionChange {
  id: string;
  fields?: CollectionFieldChanges;
  /** "namespace.key" -> value; "" clears it. */
  metafields?: Record<string, string>;
}

export interface CollectionResult {
  id: string;
  ok: boolean;
  errors: string[];
}

const UPDATE = `mutation($input: CollectionInput!) {
  collectionUpdate(input: $input) { collection { id } userErrors { field message } }
}`;
const MF_SET = `mutation($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { userErrors { field message } }
}`;
const MF_DELETE = `mutation($m: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $m) { userErrors { field message } }
}`;

/**
 * Apply one collection's changes: its own fields in one collectionUpdate, its
 * metafields in one set and one delete. Each collection reports on its own, so
 * a refusal on one does not hide what happened to the rest.
 */
export async function applyCollectionChange(
  ch: CollectionChange,
  defs: CollectionMetafieldDef[]
): Promise<CollectionResult> {
  const errors: string[] = [];
  const f = ch.fields ?? {};
  const input: Record<string, unknown> = { id: ch.id };
  if (f.title !== undefined) {
    if (!f.title.trim()) errors.push("A collection needs a title.");
    else input.title = f.title.trim();
  }
  if (f.handle !== undefined) {
    const h = f.handle.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(h)) errors.push(`"${f.handle}" is not a valid handle (a-z, 0-9 and dashes).`);
    else {
      input.handle = h;
      // The old address keeps working: a handle is a URL.
      input.redirectNewHandle = true;
    }
  }
  if (f.descriptionHtml !== undefined) input.descriptionHtml = f.descriptionHtml;
  if (f.templateSuffix !== undefined) input.templateSuffix = f.templateSuffix.trim() || null;
  if (f.sortOrder !== undefined) {
    if (!(SORT_ORDERS as readonly string[]).includes(f.sortOrder)) errors.push(`Unknown sort order ${f.sortOrder}.`);
    else input.sortOrder = f.sortOrder;
  }
  if (f.seoTitle !== undefined || f.seoDescription !== undefined)
    input.seo = {
      ...(f.seoTitle !== undefined ? { title: f.seoTitle } : {}),
      ...(f.seoDescription !== undefined ? { description: f.seoDescription } : {}),
    };
  if (errors.length) return { id: ch.id, ok: false, errors };

  if (Object.keys(input).length > 1) {
    const r = await shopifyGraphQL<{ collectionUpdate: { userErrors: { field: string[] | null; message: string }[] } }>(
      UPDATE,
      { input }
    );
    errors.push(...r.collectionUpdate.userErrors.map((e) => e.message));
  }

  const byId = new Map(defs.map((d) => [d.id, d]));
  const sets: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = [];
  const deletes: { ownerId: string; namespace: string; key: string }[] = [];
  for (const [k, raw] of Object.entries(ch.metafields ?? {})) {
    const def = byId.get(k);
    if (!def) {
      errors.push(`${k} is not a collection metafield in this store.`);
      continue;
    }
    const value = raw.trim();
    if (!value) deletes.push({ ownerId: ch.id, namespace: def.namespace, key: def.key });
    else sets.push({ ownerId: ch.id, namespace: def.namespace, key: def.key, type: def.type, value });
  }
  if (sets.length) {
    const r = await shopifyGraphQL<{ metafieldsSet: { userErrors: { message: string }[] } }>(MF_SET, { m: sets });
    errors.push(...r.metafieldsSet.userErrors.map((e) => e.message));
  }
  if (deletes.length) {
    const r = await shopifyGraphQL<{ metafieldsDelete: { userErrors: { message: string }[] } }>(MF_DELETE, {
      m: deletes,
    });
    errors.push(...r.metafieldsDelete.userErrors.map((e) => e.message));
  }
  return { id: ch.id, ok: errors.length === 0, errors };
}
