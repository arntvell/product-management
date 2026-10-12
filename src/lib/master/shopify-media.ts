// Images to Shopify: upload once, remember the file id, attach without replacing.
//
// Shared by the first push (push-shopify.ts, which attaches through productSet)
// and the selective update (shopify-update.ts, which must ADD to a live
// product and never take away what the shop already shows).

import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { FILE_CREATE_MUTATION } from "@/lib/shopify/mutations";

export const isPublicUrl = (u: string) => /^https?:\/\//i.test(u);

/**
 * A Shopify file id for every URL, uploading only the ones never uploaded.
 *
 * MediaAsset.shopifyMediaId / SeasonImage.shopifyFileId cache the id, so a
 * re-push reuses it instead of creating a duplicate file. Best-effort: a
 * failure is a warning, and the URL is simply missing from the result.
 */
export async function ensureShopifyFiles(
  colorwayId: string,
  urls: string[],
  known: Map<string, string>,
  warnings: string[]
): Promise<Map<string, string>> {
  const gidByUrl = new Map(known);
  const toCreate = [...new Set(urls)].filter((u) => isPublicUrl(u) && !gidByUrl.has(u));
  if (!toCreate.length) return gidByUrl;
  try {
    const fc = await shopifyGraphQL<{
      fileCreate: { files: { id: string }[]; userErrors: { message: string }[] };
    }>(FILE_CREATE_MUTATION, {
      files: toCreate.map((u) => ({ originalSource: u, contentType: "IMAGE" })),
    });
    if (fc.fileCreate.userErrors.length)
      warnings.push(`media: ${fc.fileCreate.userErrors.map((e) => e.message).join(", ")}`);
    const created: { url: string; gid: string }[] = [];
    toCreate.forEach((u, i) => {
      const g = fc.fileCreate.files[i]?.id;
      if (g) {
        gidByUrl.set(u, g);
        created.push({ url: u, gid: g });
      }
    });
    if (created.length) {
      try {
        await prisma.$transaction(
          created.flatMap(({ url, gid }) => [
            prisma.mediaAsset.updateMany({
              where: { colorwayId, url, shopifyMediaId: null },
              data: { shopifyMediaId: gid },
            }),
            prisma.seasonImage.updateMany({
              where: { colorwayId, url, shopifyFileId: null },
              data: { shopifyFileId: gid },
            }),
          ])
        );
      } catch {
        /* caching is best-effort; a failure just means we re-upload next time */
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    warnings.push(
      /write_files|Access denied/i.test(msg)
        ? "Media skipped — the Shopify token needs the write_files scope."
        : `Media skipped — ${msg}`
    );
  }
  return gidByUrl;
}

/** The cached file ids a colourway's images already have. */
export function knownFileIds(cw: {
  media: { url: string; shopifyMediaId: string | null }[];
  seasonImages: { url: string; shopifyFileId: string | null }[];
}): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of cw.media) if (x.shopifyMediaId && isPublicUrl(x.url)) m.set(x.url, x.shopifyMediaId);
  for (const x of cw.seasonImages) if (x.shopifyFileId && isPublicUrl(x.url)) m.set(x.url, x.shopifyFileId);
  return m;
}

/**
 * Add files to a live product's media, after the ones it has — nothing removed,
 * nothing reordered. Files already on the product are skipped. A just-created
 * file is processed by Shopify before it can be attached, so this waits for it.
 */
export async function attachFilesToProduct(
  productGid: string,
  fileGids: string[],
  warnings: string[]
): Promise<string[]> {
  if (!fileGids.length) return [];
  const live = await shopifyGraphQL<{ product: { media: { nodes: { id: string }[] } } | null }>(
    `query($id: ID!){ product(id:$id){ media(first: 250){ nodes{ id } } } }`,
    { id: productGid }
  );
  const onProduct = new Set((live.product?.media.nodes ?? []).map((n) => n.id));
  const toAttach = [...new Set(fileGids)].filter((g) => !onProduct.has(g));
  if (!toAttach.length) return [];

  // Wait for READY (or FAILED) — up to ~30s.
  for (let i = 0; i < 15; i++) {
    const st = await shopifyGraphQL<{ nodes: ({ id: string; fileStatus: string } | null)[] }>(
      `query($ids:[ID!]!){ nodes(ids:$ids){ ... on File { id fileStatus } } }`,
      { ids: toAttach }
    );
    const pending = st.nodes.filter((n) => n && n.fileStatus !== "READY" && n.fileStatus !== "FAILED");
    const failed = st.nodes.filter((n) => n?.fileStatus === "FAILED");
    if (failed.length) warnings.push(`${failed.length} image(s) failed to process in Shopify and were not added.`);
    if (!pending.length) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const r = await shopifyGraphQL<{
    fileUpdate: { files: { id: string }[]; userErrors: { message: string }[] };
  }>(
    `mutation($f:[FileUpdateInput!]!){ fileUpdate(files:$f){ files{ id } userErrors{ message } } }`,
    { f: toAttach.map((id) => ({ id, referencesToAdd: [productGid] })) }
  );
  if (r.fileUpdate.userErrors.length)
    throw new Error(r.fileUpdate.userErrors.map((e) => e.message).join(", "));
  return r.fileUpdate.files.map((f) => f.id);
}
