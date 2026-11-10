// Making a drop visible.
//
// A vintage garment is pushed hidden and revealed later — the shoot finishes
// at its own pace and the drop goes live at an announced time, so "on Shopify"
// and "on sale" are two different moments. Three things stand between them:
//
//   the status   a DRAFT product is on no storefront whatever its channels say.
//                Push creates ACTIVE, but someone can set a drop to Draft in
//                Shopify admin while it waits — DROP 193 was, and the reveal
//                went through without errors and opened nothing.
//   the tags     `hide` and `rocket-hide` are what the theme and the Rocket
//                app read to keep a product out of listings.
//   the channel  a product can be ACTIVE and still not published to the Online
//                Store. `productSet` sets status; it does not publish.
//
// Reveal does all three, in that order, and then READS THE PRODUCTS BACK.
// Shopify accepts a publish of a draft product without an error and does
// nothing, so "no userErrors" is not "live": only the read-back says what the
// storefront actually shows.
//
// Publishing SHOULD already have happened at push time — see
// `/api/vintage/channels`, which stages a drop on the channels while the tags
// still hide it. Reveal keeps doing it as a backstop because it is idempotent
// and because a garment that missed staging would otherwise be untagged and
// still invisible, which looks like the drop working and is not. The expensive
// half belongs hours before the drop opens, not during it.
import { shopifyGraphQL } from "./client";

/** The tags that hide a vintage product from the storefront. */
export const HIDE_TAGS = ["hide", "rocket-hide"] as const;

const ACTIVATE = `
  mutation Activate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id status }
      userErrors { field message }
    }
  }
`;

// What decides whether a revealed product is actually on the storefront.
const LIVE_STATE = `
  query LiveState($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        status
        tags
        resourcePublicationsV2(first: 25) { nodes { isPublished publication { id } } }
      }
    }
  }
`;

const TAGS_REMOVE = `
  mutation RemoveTags($id: ID!, $tags: [String!]!) {
    tagsRemove(id: $id, tags: $tags) {
      node { id }
      userErrors { field message }
    }
  }
`;

// The store's own `publications` list needs the `read_publications` scope,
// which this token does not have. A product's `resourcePublicationsV2` does
// NOT — so the channels are read off a product that is already live, and that
// is enough to publish others to the same set. Verified on 2026-09-25:
// `publications` is denied, `resourcePublicationsV2` returns all five.
const CHANNELS_FROM_PRODUCT = `
  query ChannelsFrom($id: ID!) {
    product(id: $id) {
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { id } } }
    }
  }
`;

const PUBLICATIONS_QUERY = `
  query Publications { publications(first: 25) { nodes { id name } } }
`;

const PUBLISH_MUTATION = `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      publishable { availablePublicationsCount { count } }
      userErrors { field message }
    }
  }
`;

export interface RevealResult {
  activated: string[];
  untagged: string[];
  published: string[];
  warnings: string[];
  /** Read back afterwards: ACTIVE, no hide tag, published on every channel. */
  live: string[];
  /** Read back afterwards and NOT live, with what is still in the way. */
  notLive: { id: string; title: string; why: string[] }[];
}

/**
 * The store's sales channels.
 *
 * Needs the `read_publications` scope. Without it this returns null and the
 * caller reports that publishing was skipped rather than pretending a product
 * is live — an ACTIVE product that no channel carries is invisible, and
 * silently leaving it that way is the failure this whole module exists to
 * prevent.
 */
export async function listPublications(
  referenceProductGid?: string
): Promise<{ id: string; name: string }[] | null> {
  const referenceWasGiven = !!referenceProductGid;
  try {
    const res = await shopifyGraphQL<{ publications: { nodes: { id: string; name: string }[] } }>(
      PUBLICATIONS_QUERY
    );
    return res.publications?.nodes ?? [];
  } catch {
    // Fall back to asking a live product which channels carry it.
    try {
      // The caller's reference is usually one of the products being revealed,
      // which on a fresh drop is not published yet and so lists nothing. Find
      // one that IS live instead — the channels belong to the store, not to
      // the garment, so any published vintage product answers the question.
      if (!referenceProductGid) {
        const found = await shopifyGraphQL<{ products: { nodes: { id: string }[] } }>(
          `query AnyLiveVintage {
             products(first: 1, query: "vendor:Vintage AND published_status:published") {
               nodes { id }
             }
           }`
        );
        referenceProductGid = found.products?.nodes?.[0]?.id;
      }
      if (!referenceProductGid) return null;
      const res = await shopifyGraphQL<{
        product: {
          resourcePublicationsV2: { nodes: { isPublished: boolean; publication: { id: string } }[] };
        } | null;
      }>(CHANNELS_FROM_PRODUCT, { id: referenceProductGid });
      const nodes = res.product?.resourcePublicationsV2?.nodes ?? [];
      const live = nodes.filter((n) => n.isPublished).map((n) => ({ id: n.publication.id, name: "" }));
      if (live.length) return live;
      // The reference was not actually live. Try again without it, which takes
      // the branch above that goes looking for one.
      return referenceWasGiven ? listPublications() : null;
    } catch {
      return null;
    }
  }
}

/**
 * Set ACTIVE, remove the hide tags, publish to every sales channel the store
 * has — then read each product back and say which are really live.
 */
export async function revealProducts(
  productGids: string[],
  opts: { removeTags?: boolean; publish?: boolean; referenceProductGid?: string } = {}
): Promise<RevealResult> {
  const removeTags = opts.removeTags ?? true;
  const publish = opts.publish ?? true;
  const warnings: string[] = [];
  const activated: string[] = [];
  const untagged: string[] = [];
  const published: string[] = [];

  // Status first: publishing a draft is accepted and does nothing.
  if (publish) {
    for (const id of productGids) {
      try {
        const res = await shopifyGraphQL<{
          productUpdate: { userErrors: { message: string }[] };
        }>(ACTIVATE, { input: { id, status: "ACTIVE" } });
        const errs = res.productUpdate?.userErrors ?? [];
        if (errs.length) warnings.push(`${id}: ${errs.map((e) => e.message).join(", ")}`);
        else activated.push(id);
      } catch (err) {
        warnings.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (removeTags) {
    for (const id of productGids) {
      try {
        const res = await shopifyGraphQL<{
          tagsRemove: { userErrors: { message: string }[] };
        }>(TAGS_REMOVE, { id, tags: [...HIDE_TAGS] });
        const errs = res.tagsRemove?.userErrors ?? [];
        if (errs.length) warnings.push(`${id}: ${errs.map((e) => e.message).join(", ")}`);
        else untagged.push(id);
      } catch (err) {
        warnings.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  let pubs: { id: string; name: string }[] | null = null;
  if (publish) {
    // Any already-published vintage product will do as the reference — the
    // channels are a property of the store, not of the garment.
    pubs = await listPublications(opts.referenceProductGid ?? productGids[0]);
    if (pubs === null) {
      warnings.push(
        "Could not work out the store's sales channels, from `publications` or from a live " +
          "product's own. The products are untagged but NOT published, so they stay invisible. " +
          "Pass a referenceProductGid that is already live, or grant `read_publications`."
      );
    } else if (!pubs.length) {
      warnings.push("Shopify reported no sales channels to publish to.");
    } else {
      const input = pubs.map((p) => ({ publicationId: p.id }));
      for (const id of productGids) {
        try {
          const res = await shopifyGraphQL<{
            publishablePublish: { userErrors: { message: string }[] };
          }>(PUBLISH_MUTATION, { id, input });
          const errs = res.publishablePublish?.userErrors ?? [];
          if (errs.length) warnings.push(`${id}: ${errs.map((e) => e.message).join(", ")}`);
          else published.push(id);
        } catch (err) {
          warnings.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  const { live, notLive } = await readBack(productGids, {
    checkTags: removeTags,
    channels: publish ? (pubs ?? []).map((p) => p.id) : null,
  });
  return { activated, untagged, published, warnings, live, notLive };
}

/**
 * Which products the storefront really shows. `channels` null skips the
 * status and channel checks (a tags-only call); an empty list means the
 * channels could not be worked out, so any unpublished channel counts.
 */
export async function readBack(
  productGids: string[],
  opts: { checkTags: boolean; channels: string[] | null }
): Promise<{ live: string[]; notLive: { id: string; title: string; why: string[] }[] }> {
  const live: string[] = [];
  const notLive: { id: string; title: string; why: string[] }[] = [];
  for (let i = 0; i < productGids.length; i += 50) {
    const ids = productGids.slice(i, i + 50);
    let nodes: ({
      id: string;
      title: string;
      status: string;
      tags: string[];
      resourcePublicationsV2: { nodes: { isPublished: boolean; publication: { id: string } }[] };
    } | null)[] = [];
    try {
      nodes = (await shopifyGraphQL<{ nodes: typeof nodes }>(LIVE_STATE, { ids })).nodes;
    } catch (err) {
      const why = [`could not be read back (${err instanceof Error ? err.message : String(err)})`];
      for (const id of ids) notLive.push({ id, title: "", why });
      continue;
    }
    for (const [j, n] of nodes.entries()) {
      if (!n?.id) {
        notLive.push({ id: ids[j], title: "", why: ["not found on Shopify"] });
        continue;
      }
      const why: string[] = [];
      if (opts.channels) {
        if (n.status !== "ACTIVE") why.push(`status ${n.status.toLowerCase()}`);
        const on = new Set(n.resourcePublicationsV2.nodes.filter((p) => p.isPublished).map((p) => p.publication.id));
        const missing = opts.channels.length
          ? opts.channels.filter((c) => !on.has(c)).length
          : n.resourcePublicationsV2.nodes.filter((p) => !p.isPublished).length;
        if (!on.size) why.push("on no sales channel");
        else if (missing) why.push(`missing from ${missing} sales channel(s)`);
      }
      if (opts.checkTags) {
        const still = n.tags.filter((t) => (HIDE_TAGS as readonly string[]).includes(t));
        if (still.length) why.push(`still tagged ${still.join(", ")}`);
      }
      if (why.length) notLive.push({ id: n.id, title: n.title, why });
      else live.push(n.id);
    }
  }
  return { live, notLive };
}

/** One line for a schedule row or a toast: what is live, and what is not. */
export function describeReveal(r: RevealResult, total: number): string {
  if (!r.notLive.length) return `${r.live.length} of ${total} live`;
  const first = r.notLive[0];
  return (
    `${r.live.length} of ${total} live — ${r.notLive.length} NOT live` +
    ` (${first.title || first.id}: ${first.why.join(", ")}` +
    (r.notLive.length > 1 ? `, and ${r.notLive.length - 1} more` : "") +
    ")"
  );
}
