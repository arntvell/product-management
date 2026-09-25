// Putting a product at the top of a Shopify collection.
//
// The Vintage collection is an unusual shape and the whole module depends on
// it, so it is worth stating: it is a RULE-BASED (automated) collection —
// `VENDOR EQUALS Vintage` — whose sort order is nonetheless `MANUAL`.
//
// Two consequences:
//
//   Membership is automatic. There is no `collectionAddProducts` call here and
//   there must not be: Shopify does not let you add a product explicitly to an
//   automated collection. A product the push creates with `vendor: "Vintage"`
//   joins on its own, which is why the drop flow sets that vendor.
//
//   Membership is also EVENTUAL. The rule is evaluated after the product is
//   created, not during, so a reorder issued too early moves a product Shopify
//   does not yet consider a member — and errors. Hence `waitForMembership`.
import { shopifyGraphQL } from "./client";

/** The storefront's Vintage collection. Rule-based on `VENDOR = Vintage`. */
export const VINTAGE_COLLECTION_GID =
  process.env.SHOPIFY_VINTAGE_COLLECTION_GID || "gid://shopify/Collection/237750812862";

// `newPosition` is an UnsignedInt64, which GraphQL serialises as a string.
const REORDER_MUTATION = `
  mutation ReorderCollection($id: ID!, $moves: [MoveInput!]!) {
    collectionReorderProducts(id: $id, moves: $moves) {
      job { id done }
      userErrors { field message }
    }
  }
`;

const JOB_QUERY = `
  query ReorderJob($id: ID!) {
    job(id: $id) { id done }
  }
`;

/** Is this product currently a member of the collection? */
async function isMember(collectionId: string, productGid: string): Promise<boolean> {
  const res = await shopifyGraphQL<{
    collection: { products: { nodes: { id: string }[] } } | null;
  }>(
    `query InCollection($id: ID!, $q: String!) {
       collection(id: $id) { products(first: 1, query: $q) { nodes { id } } }
     }`,
    { id: collectionId, q: `id:${productGid.split("/").pop()}` }
  );
  return (res.collection?.products.nodes ?? []).some((n) => n.id === productGid);
}

/**
 * Block until every product is a member, or give up.
 *
 * Rule evaluation is usually quick but is not synchronous with the create, and
 * reordering a non-member is an error rather than a no-op. Returns the ids that
 * made it, so the caller can reorder those and report the rest instead of
 * failing the whole drop for one straggler.
 */
export async function waitForMembership(
  productGids: string[],
  opts: { collectionId?: string; timeoutMs?: number; intervalMs?: number } = {}
): Promise<{ members: string[]; missing: string[] }> {
  const collectionId = opts.collectionId ?? VINTAGE_COLLECTION_GID;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  const pending = new Set(productGids);
  const members: string[] = [];

  while (pending.size && Date.now() < deadline) {
    for (const gid of [...pending]) {
      if (await isMember(collectionId, gid)) {
        pending.delete(gid);
        members.push(gid);
      }
    }
    if (pending.size && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Preserve the caller's order — it decides what ends up on top.
  return {
    members: productGids.filter((g) => members.includes(g)),
    missing: [...pending],
  };
}

export interface ReorderResult {
  moved: number;
  jobId: string | null;
  /** True when the job reported done before we stopped waiting. */
  settled: boolean;
  warnings: string[];
}

/**
 * Move products to the top of the collection, first in the list ending first.
 *
 * One call with every move rather than one call per product: the collection
 * holds ~3,800 products, the mutation is asynchronous, and a job per garment
 * would mean 40-60 overlapping reorders of the same collection every Friday.
 */
export async function moveToTopOfCollection(
  productGids: string[],
  opts: { collectionId?: string; waitMs?: number } = {}
): Promise<ReorderResult> {
  const collectionId = opts.collectionId ?? VINTAGE_COLLECTION_GID;
  const warnings: string[] = [];
  if (!productGids.length) return { moved: 0, jobId: null, settled: true, warnings };

  const moves = productGids.map((id, i) => ({ id, newPosition: String(i) }));

  const res = await shopifyGraphQL<{
    collectionReorderProducts: {
      job: { id: string; done: boolean } | null;
      userErrors: { field: string[]; message: string }[];
    };
  }>(REORDER_MUTATION, { id: collectionId, moves });

  const errs = res.collectionReorderProducts?.userErrors ?? [];
  if (errs.length)
    throw new Error(`collectionReorderProducts: ${errs.map((e) => e.message).join(", ")}`);

  const job = res.collectionReorderProducts?.job ?? null;
  if (!job) return { moved: moves.length, jobId: null, settled: false, warnings };

  const settled = await waitForJob(job, opts.waitMs ?? 60_000);
  if (!settled)
    warnings.push(
      `Reorder job ${job.id} had not finished after ${Math.round((opts.waitMs ?? 60_000) / 1000)}s. ` +
        `Shopify is still applying it; the order will settle on its own.`
    );

  return { moved: moves.length, jobId: job.id, settled, warnings };
}

async function waitForJob(job: { id: string; done: boolean }, timeoutMs: number): Promise<boolean> {
  if (job.done) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    const res = await shopifyGraphQL<{ job: { done: boolean } | null }>(JOB_QUERY, { id: job.id });
    if (res.job?.done) return true;
  }
  return false;
}
