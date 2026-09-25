// Making a drop visible.
//
// A vintage garment is pushed hidden and revealed later — the shoot finishes
// at its own pace and the drop goes live at an announced time, so "on Shopify"
// and "on sale" are two different moments. Two things stand between them:
//
//   the tags     `hide` and `rocket-hide` are what the theme and the Rocket
//                app read to keep a product out of listings.
//   the channel  a product can be ACTIVE and still not published to the Online
//                Store. `productSet` sets status; it does not publish.
//
// Reveal does both, in that order, so a product never appears in a listing
// before it is actually purchasable.
import { shopifyGraphQL } from "./client";

/** The tags that hide a vintage product from the storefront. */
export const HIDE_TAGS = ["hide", "rocket-hide"] as const;

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
  untagged: string[];
  published: string[];
  warnings: string[];
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

/** Remove the hide tags, then publish to every sales channel the store has. */
export async function revealProducts(
  productGids: string[],
  opts: { removeTags?: boolean; publish?: boolean; referenceProductGid?: string } = {}
): Promise<RevealResult> {
  const removeTags = opts.removeTags ?? true;
  const publish = opts.publish ?? true;
  const warnings: string[] = [];
  const untagged: string[] = [];
  const published: string[] = [];

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

  if (publish) {
    // Any already-published vintage product will do as the reference — the
    // channels are a property of the store, not of the garment.
    const pubs = await listPublications(opts.referenceProductGid ?? productGids[0]);
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

  return { untagged, published, warnings };
}
