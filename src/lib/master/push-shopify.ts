// Live Shopify push (Phase 3). Uses productSet (declarative) so create and
// update share one idempotent path: core fields, free-text custom.* metafields
// (incl. style_name/color_hex), a "Size" option, and one variant per master
// variant with the NOK MSRP price + barcode.
// Not yet: media (adopt TF -> Blob -> Shopify files) and reference/product-ref
// GID resolution (see the preview warnings).
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import {
  PRODUCT_SET_MUTATION,
  FILE_CREATE_MUTATION,
  METAFIELDS_DELETE_MUTATION,
} from "@/lib/shopify/mutations";
import { METAFIELD_NAMESPACE } from "@/lib/constants";
import { getColorwayForPublish, buildShopifyPreview } from "./publish";
import { shopifyMissing, shopifyBlockingMissing } from "./readiness";
import { resolveCustoms, toInventoryItemInput } from "./customs-shopify";
import {
  adoptExistingShopifyProduct,
  recordShopifyVariantRefs,
  type AdoptionRoute,
  type VariantRefResult,
} from "@/lib/shopify/adopt";

// Fetch the live product's fields we must MERGE with (not overwrite): tags a
// merchant added in Shopify admin, and current publish status.
const PRODUCT_MERGE_QUERY = `
  query ProductMerge($id: ID!) {
    product(id: $id) {
      id
      status
      tags
      metafields(first: 100) { nodes { namespace key type value } }
    }
  }
`;

type PublishColorway = NonNullable<Awaited<ReturnType<typeof getColorwayForPublish>>>;
type Metafield = { namespace: string; key: string; value: string; type: string };

/** Resolve master colorway ids -> the Shopify product GIDs of those already pushed. */
async function resolveProductGids(masterIds: string[]): Promise<{ gids: string[]; skipped: number }> {
  if (masterIds.length === 0) return { gids: [], skipped: 0 };
  const pubs = await prisma.channelPublication.findMany({
    where: { colorwayId: { in: masterIds }, channel: "SHOPIFY", NOT: { externalId: null } },
    select: { colorwayId: true, externalId: true },
  });
  const byId = new Map(pubs.map((p) => [p.colorwayId, p.externalId!]));
  const gids = masterIds.map((id) => byId.get(id)).filter(Boolean) as string[];
  return { gids, skipped: masterIds.length - gids.length };
}

/** model_info is a text metafield: resolve the metaobject id -> "Model is X tall …". */
async function resolveModelText(metaobjectGid: string): Promise<string | null> {
  try {
    const res = await shopifyGraphQL<{
      metaobject: { fields: { key: string; value: string }[] } | null;
    }>(
      `query M($id: ID!) { metaobject(id: $id) { fields { key value } } }`,
      { id: metaobjectGid }
    );
    const fields = res.metaobject?.fields ?? [];
    const get = (k: string) => fields.find((f) => f.key === k)?.value ?? "";
    const height = get("height");
    const size = get("size_worn");
    if (!height && !size) return null;
    return `Model is ${height} tall and wearing a size ${size}`.replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
}

/** Build the full custom.* metafield set (free-text, refs, links, model). */
async function buildMetafields(
  cw: PublishColorway,
  warnings: string[]
): Promise<Metafield[]> {
  const ns = METAFIELD_NAMESPACE;
  const mf: Metafield[] = [];
  const add = (key: string, type: string, value: string | null | undefined) => {
    if (value && String(value).trim()) mf.push({ namespace: ns, key, value: String(value), type });
  };
  // Shopify-resolved free text (override -> base).
  const rs = (field: string, base: string | null) => {
    const o = cw.channelContent.find((c) => c.channel === "SHOPIFY" && c.field === field);
    return o ? o.value : base;
  };
  add("short_description", "multi_line_text_field", rs("shortDescription", cw.shortDescription));
  add("full_description", "multi_line_text_field", rs("fullDescription", cw.fullDescription));
  add("details", "multi_line_text_field", rs("details", cw.details));
  add("style_tagline", "multi_line_text_field", rs("styleTagline", cw.styleTagline));
  add("style_name", "single_line_text_field", rs("styleName", cw.styleName));
  // Shopify rejects a malformed colour outright, failing the whole product for
  // a swatch. "#00000" (five digits) did exactly that. Send it only if it is a
  // real hex; otherwise warn and let the rest of the product through.
  if (cw.swatchHex && !/^#[0-9A-Fa-f]{6}$/.test(cw.swatchHex.trim())) {
    warnings.push(`Skipped color_hex — "${cw.swatchHex}" is not a 6-digit hex colour.`);
  } else {
    add("color_hex", "color", cw.swatchHex);
  }

  // Reference metafields (Shopify GIDs, stored directly).
  add("care_page", "page_reference", cw.carePageId);
  add("fitguide", "page_reference", cw.fitguidePageId);
  add("recommended_product_from_collection", "collection_reference", cw.recommendedCollectionId);

  // model_info is text on Shopify — resolve the picked model to a sentence.
  if (cw.modelInfoId) add("model_info", "multi_line_text_field", await resolveModelText(cw.modelInfoId));

  // Product links: master ids -> Shopify product GIDs (skip not-yet-pushed).
  const links: [string, string[]][] = [
    ["same_product", cw.sameProduct],
    ["style_with", cw.styleWith],
    ["style_with_unisex_herre", cw.styleWithUnisexHerre],
    ["style_with_unisex_dame", cw.styleWithUnisexDame],
  ];
  for (const [key, ids] of links) {
    if (ids.length === 0) continue;
    const { gids, skipped } = await resolveProductGids(ids);
    if (gids.length) add(key, "list.product_reference", JSON.stringify(gids));
    if (skipped > 0)
      warnings.push(`${key}: ${skipped} linked product(s) not yet on Shopify — skipped.`);
  }
  return mf;
}

interface ProductSetResult {
  productSet: {
    product: {
      id: string;
      handle: string;
      status: string;
      variants: {
        edges: {
          node: {
            id: string;
            sku: string | null;
            barcode: string | null;
            inventoryItem: { id: string } | null;
          };
        }[];
      };
    } | null;
    userErrors: { field: string[]; message: string }[];
  };
}

export interface PushResult {
  action: "create" | "update";
  productGid: string;
  handle: string | null;
  variants: number;
  metafields: number;
  warnings: string[];
  adminUrl: string;
  /** Set when a product we thought was new turned out to already exist. */
  adopted?: AdoptionRoute;
  /** Per-variant identity recorded from the response. */
  variantRefs?: VariantRefResult;
}

export async function pushColorwayToShopify(
  id: string,
  seasonCode?: string,
  /** Publish despite missing merchandising fields (never despite missing
   *  variants or price). A deliberate choice, not a default. */
  allowIncomplete = false,
  /**
   * Delete managed custom.* metafields that are blank in the master.
   *
   * Off by default, because blank in the master usually means "we have not
   * written this yet", not "erase what the shop has". Carry-overs were
   * merchandised in Shopify long before this master existed, so treating an
   * empty cell as an instruction to delete would wipe live copy the first time
   * anyone re-pushed a product. Clearing a field live is a deliberate act, so it
   * takes a deliberate flag.
   */
  clearEmptied = false,
  /**
   * Force the customs write on or off for this call, overriding
   * SHOPIFY_CUSTOMS_WRITE. The backfill and the dry-run preview need to ask for
   * it explicitly; nothing else should.
   */
  allowCustoms?: boolean
): Promise<PushResult> {
  const cw = await getColorwayForPublish(id, seasonCode);
  if (!cw) throw new Error("Colorway not found");
  const preview = buildShopifyPreview(cw);

  // Never create blind. ChannelPublication is OUR record of what Shopify holds,
  // and a crash between productSet returning and the publication write leaves
  // Shopify with a product we have no row for — at which point this branch would
  // say "create" and make a second one. Ask Shopify instead.
  const publication = cw.publications.find((p) => p.channel === "SHOPIFY");
  let externalId = publication?.externalId ?? null;
  let adopted: AdoptionRoute | undefined;
  if (!externalId) {
    const found = await adoptExistingShopifyProduct(id);
    if (found) {
      externalId = found.productGid;
      adopted = found.via;
    }
  }
  const existing = externalId ? { externalId } : null;
  const action: "create" | "update" = externalId ? "update" : "create";

  // --- Readiness gate: never push a product that can't publish correctly. ---
  const hasVariants = preview.variants.length > 0;
  const hasPrice = cw.prices.some((p) => p.currency === "NOK" && p.priceType === "MSRP");
  const shopDesc =
    cw.channelContent.find((c) => c.channel === "SHOPIFY" && c.field === "fullDescription")?.value ??
    cw.fullDescription ??
    cw.shortDescription;
  const missing = shopifyMissing({
    hasVariants,
    hasPrice,
    description: shopDesc,
    hasImage: cw.media.length > 0 || cw.seasonImages.length > 0,
    hasTags: cw.tags.length > 0,
    swatchHex: cw.swatchHex,
    carePageId: cw.carePageId,
    fitguidePageId: cw.fitguidePageId,
  });
  // Variants and price are absolute; the merchandising fields can be waived
  // deliberately, but never by omission — publishing a product page with no
  // description or photograph should take a decision, not a default.
  const blocking = shopifyBlockingMissing({ hasVariants, hasPrice });
  if (blocking.length || (missing.length && !allowIncomplete))
    throw new Error(
      `Not ready for Shopify — missing: ${missing.join(", ")}${
        seasonCode ? ` (season ${seasonCode})` : ""
      }.${blocking.length ? "" : " Pass allowIncomplete to publish anyway."}`
    );

  const warnings: string[] = [];
  if (adopted)
    warnings.push(
      `Shopify already held this product (found by ${adopted}) — updated it instead of creating a second one. ` +
        `The master's publication record was missing; it has been repaired.`
    );
  if (!seasonCode)
    warnings.push("Pushed without a season — price is not season-scoped; verify it's correct.");
  const metafields = await buildMetafields(cw, warnings);

  // --- Size options ---
  //
  // Shopify identifies a variant by its OPTION VALUES, not by SKU, and
  // productSet is declarative: any variant whose option values are not in the
  // input is deleted. So the option scheme we send has to match the one the
  // product already uses, or every variant is destroyed and recreated — losing
  // its inventory levels and its GID (which order line items and
  // VariantChannelRef point at).
  //
  // Bottoms are sold as Waist x Length and are live on Shopify with two
  // options. Sending a single "Size" of "W30/L32" would rebuild 42 FW26
  // products holding 6,062 units. The master already stores the axes
  // separately, so use them: two options when the colorway is 2-D, one
  // otherwise. See docs/shopify-push.md §1.
  const is2D = preview.variants.some((v) => v.dim2 !== null && v.dim2 !== "");
  const dedupe = (xs: string[]) => [...new Set(xs)];

  const productOptions = is2D
    ? [
        { name: "Waist", position: 1, values: dedupe(preview.variants.map((v) => v.dim1)).map((name) => ({ name })) },
        { name: "Length", position: 2, values: dedupe(preview.variants.map((v) => v.dim2 as string)).map((name) => ({ name })) },
      ]
    : [
        { name: "Size", position: 1, values: dedupe(preview.variants.map((v) => v.size)).map((name) => ({ name })) },
      ];

  // Customs. Shopify has never received any of this — `sku` was the only
  // inventoryItem field ever written — so it ships behind a flag and is inert
  // until SHOPIFY_CUSTOMS_WRITE=on. Every flow funnels through this function
  // (single push, bulk push, the orchestrator), so turning it on covers them all.
  //
  // Nothing is emitted for a value we do not have: omission leaves Shopify's
  // value alone, the same policy clearEmptied applies to metafields, and
  // productSet is declarative enough that a null would blank a merchant's data.
  const customsEnabled = allowCustoms ?? process.env.SHOPIFY_CUSTOMS_WRITE === "on";
  const customs = resolveCustoms(cw);
  const customsInput = customsEnabled ? toInventoryItemInput(customs) : {};
  if (customsEnabled && customs.countryUnresolved)
    warnings.push(
      `Country of origin "${customs.countryUnresolved}" is not a country code Shopify ` +
        `recognises, so it was omitted. A wrong code would reject the whole product.`
    );

  // Track inventory on everything we stock. Shopify creates variants untracked
  // unless told otherwise, and an untracked item ignores the stock Pio, Loom and
  // Sitoo sync onto it — every product Origio created before this landed
  // untracked. Services (gift wrap) carry no stock and are left as they are. On
  // an update this is a no-op for an item that is already tracked.
  const tracked = cw.kind !== "SERVICE";

  const variants = preview.variants.map((v) => ({
    optionValues: is2D
      ? [
          { optionName: "Waist", name: v.dim1 },
          { optionName: "Length", name: v.dim2 as string },
        ]
      : [{ optionName: "Size", name: v.size }],
    ...(v.price ? { price: v.price } : {}),
    inventoryItem: { sku: v.sku, ...(tracked ? { tracked: true } : {}), ...customsInput },
    ...(v.barcode ? { barcode: v.barcode } : {}),
  }));

  // A 2-D colorway with a variant missing its length would silently collapse
  // onto another variant's option pair, so refuse rather than push a product
  // with variants merged or dropped.
  if (is2D) {
    const bad = preview.variants.filter((v) => !v.dim2);
    if (bad.length)
      throw new Error(
        `${bad.length} variant(s) have a waist but no length (${bad
          .map((v) => v.sku)
          .slice(0, 5)
          .join(", ")}) — fix the size labels before pushing.`
      );
  }

  // --- Media (pass 2) ---
  // Only public URLs (Blob / Shopify CDN) can push; Threadflow refs must be
  // adopted to Blob first. Routing depends on unisex (see the media rule):
  //   non-unisex: gallery -> product media; flat -> custom.flat
  //   unisex:     flat -> product media; men/women -> custom.men_images/women_images; flat -> custom.flat
  const isPublic = (u: string) => /^https?:\/\//i.test(u);
  const urlsFor = (role: string) =>
    cw.media.filter((m) => m.role === role && isPublic(m.url)).map((m) => m.url);
  const galleryUrls = [
    ...urlsFor("GALLERY"),
    ...cw.seasonImages.filter((s) => isPublic(s.url)).map((s) => s.url),
  ];
  const flatUrls = urlsFor("FLAT");
  const menUrls = urlsFor("MEN");
  const womenUrls = urlsFor("WOMEN");
  const nonPublic = [...cw.media, ...cw.seasonImages].filter((m) => !isPublic(m.url)).length;
  if (nonPublic > 0)
    warnings.push(`${nonPublic} image(s) are Threadflow refs — adopt them into Blob before they can push.`);

  // A unisex product's gallery is the flat-lay, because the gendered model
  // shots go to custom.men_images / custom.women_images instead. But a style
  // can be flagged unisex before its flat has been shot, and an empty `files`
  // list means the product page has no photograph at all — so fall back to the
  // gallery rather than publish a blank product.
  const productMediaUrls = preview.unisex
    ? flatUrls.length
      ? flatUrls
      : [...galleryUrls, ...menUrls, ...womenUrls]
    : galleryUrls;
  if (preview.unisex && !flatUrls.length && productMediaUrls.length)
    warnings.push(
      "Unisex product with no FLAT image — used the gendered/gallery shots for the product media instead."
    );

  // Idempotent media: reuse the Shopify file GID we cached on first upload
  // (MediaAsset.shopifyMediaId / SeasonImage.shopifyFileId) so re-pushing does
  // NOT create duplicate files. Only upload URLs we've never uploaded.
  // Best-effort: if the token lacks write_files (or any error), skip media and
  // keep pushing the rest. Requires the `write_files` scope on the token.
  const gidByUrl = new Map<string, string>();
  for (const m of cw.media) if (m.shopifyMediaId && isPublic(m.url)) gidByUrl.set(m.url, m.shopifyMediaId);
  for (const s of cw.seasonImages) if (s.shopifyFileId && isPublic(s.url)) gidByUrl.set(s.url, s.shopifyFileId);

  const allMediaUrls = [...new Set([...productMediaUrls, ...flatUrls, ...menUrls, ...womenUrls])];
  const toCreate = allMediaUrls.filter((u) => !gidByUrl.has(u));
  if (toCreate.length) {
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
      // Cache the new GIDs so the next push reuses them instead of duplicating.
      if (created.length) {
        try {
          await prisma.$transaction(
            created.flatMap(({ url, gid }) => [
              prisma.mediaAsset.updateMany({
                where: { colorwayId: id, url, shopifyMediaId: null },
                data: { shopifyMediaId: gid },
              }),
              prisma.seasonImage.updateMany({
                where: { colorwayId: id, url, shopifyFileId: null },
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
  }
  const mediaFileIds = (urls: string[]) =>
    urls.map((u) => gidByUrl.get(u)).filter(Boolean) as string[];
  const flatGid = mediaFileIds(flatUrls);
  const menGids = mediaFileIds(menUrls);
  const womenGids = mediaFileIds(womenUrls);
  const productMediaGids = mediaFileIds(productMediaUrls);
  if (flatGid[0]) metafields.push({ namespace: METAFIELD_NAMESPACE, key: "flat", type: "file_reference", value: flatGid[0] });
  if (menGids.length) metafields.push({ namespace: METAFIELD_NAMESPACE, key: "men_images", type: "list.file_reference", value: JSON.stringify(menGids) });
  if (womenGids.length) metafields.push({ namespace: METAFIELD_NAMESPACE, key: "women_images", type: "list.file_reference", value: JSON.stringify(womenGids) });

  // productSet is declarative (full-replace), so for an UPDATE we must first
  // read the live product and MERGE, or we'd wipe merchant-added data.
  let tags = preview.product.tags;
  let status: string | undefined = preview.product.status;
  if (action === "update" && existing?.externalId) {
    const live = await shopifyGraphQL<{
      product: {
        id: string;
        status: string;
        tags: string[];
        metafields: { nodes: Metafield[] };
      } | null;
    }>(PRODUCT_MERGE_QUERY, { id: existing.externalId });

    // productSet is declarative for metafields exactly as it is for variants and
    // files: any key NOT in the input is deleted. The master is the authority
    // for the custom.* fields it manages, but it is not the authority for
    // everything on the product — descriptions and care pages were merchandised
    // in Shopify long before this master existed, and apps own keys like
    // `badge`, `rating` and `google_product_category`.
    //
    // So carry every live metafield into the input and let the master's values
    // overlay the keys it actually has. Without this a push strips the product
    // down to whatever the master happens to hold: Abby White went from 17
    // metafields to 3, losing its description, details, care page and model
    // info. Emptying a field on purpose is what `clearEmptied` is for, and it
    // runs after this as an explicit delete.
    // `global.title_tag` / `global.description_tag` are Shopify's own SEO
    // fields surfaced as metafields. productSet owns them through its `seo`
    // input, so sending them back as metafields is rejected outright — "Key
    // must be unique within this namespace on this resource" — and takes the
    // whole product with it. They are Shopify-managed, so omitting them does
    // not delete them.
    const RESERVED_NS = new Set(["global"]);
    const liveMetafields = (live.product?.metafields.nodes ?? []).filter(
      (m) => !RESERVED_NS.has(m.namespace)
    );
    const managed = new Set(metafields.map((m) => `${m.namespace}.${m.key}`));
    // When the caller asked to clear emptied fields, the keys the master
    // manages and has deliberately blanked must NOT be carried back — that is
    // the whole point of the flag. Everything else still is.
    const clearing = new Set(
      clearEmptied
        ? preview.emptyMetafieldKeys.map((k) => `${METAFIELD_NAMESPACE}.${k}`)
        : []
    );
    const carried = liveMetafields.filter(
      (m) =>
        !managed.has(`${m.namespace}.${m.key}`) &&
        !clearing.has(`${m.namespace}.${m.key}`)
    );
    if (carried.length) {
      // `type` is required when writing, and a value we did not author is sent
      // back verbatim.
      metafields.push(
        ...carried.map((m) => ({
          namespace: m.namespace,
          key: m.key,
          type: m.type,
          value: m.value,
        }))
      );
    }

    const liveTags = live.product?.tags ?? [];
    // Additive: union of live tags + master tags (never removes merchant tags).
    tags = [...new Set([...liveTags, ...preview.product.tags])];
    // Never silently unpublish: if the product is live (ACTIVE) but master says
    // DRAFT/ARCHIVED, leave the live status alone and warn instead.
    const liveStatus = live.product?.status;
    if (liveStatus === "ACTIVE" && preview.product.status !== "ACTIVE") {
      status = undefined;
      warnings.push(
        `Kept live status ACTIVE (master is ${preview.product.status}) — change status in Shopify directly to unpublish.`
      );
    }
  }

  const input: Record<string, unknown> = {
    ...(existing?.externalId ? { id: existing.externalId } : {}),
    title: preview.product.title,
    handle: preview.product.handle,
    vendor: preview.product.vendor ?? undefined,
    productType: preview.product.productType ?? undefined,
    tags,
    ...(status ? { status } : {}),
    metafields,
    ...(productMediaGids.length
      ? { files: productMediaGids.map((gid) => ({ id: gid })) }
      : {}),
    ...(hasVariants ? { productOptions, variants } : {}),
  };

  const res = await shopifyGraphQL<ProductSetResult>(PRODUCT_SET_MUTATION, { input });
  const errs = res.productSet?.userErrors ?? [];
  if (errs.length) throw new Error(`productSet: ${errs.map((e) => e.message).join(", ")}`);
  const product = res.productSet?.product;
  if (!product) throw new Error("productSet returned no product");

  // Identity first, before the metafield tidy-up below — a failure there must
  // not cost us the variant and inventory-item ids. Until now these rows came
  // only from the linker, so a freshly created product had no InventoryItem gid
  // until someone remembered to run it, and Loom's registry joins on that gid.
  let variantRefs: VariantRefResult | undefined;
  try {
    variantRefs = await recordShopifyVariantRefs(
      id,
      product.variants.edges.map((e) => e.node)
    );
    if (variantRefs.unmatched.length)
      warnings.push(
        `Shopify returned ${variantRefs.unmatched.length} variant SKU(s) the master does not hold: ${variantRefs.unmatched.join(", ")}.`
      );
    if (variantRefs.missing.length)
      warnings.push(
        `Shopify did not return ${variantRefs.missing.length} master variant(s): ${variantRefs.missing.join(", ")}.`
      );
    if (variantRefs.linked && !variantRefs.inventoryLinked)
      warnings.push(
        "No InventoryItem ids came back — Loom's stock registry has nothing to join on for this product."
      );
  } catch (err) {
    warnings.push(
      `Could not record Shopify variant identity: ${err instanceof Error ? err.message : String(err)}. Run the Shopify linker.`
    );
  }

  // Clear metafields the user emptied in master. productSet does delete a key
  // it is not given, but the carry-forward above deliberately keeps every key
  // the master does not manage, so an emptied managed key needs an explicit
  // delete. Skip keys we just set. Only meaningful on update — a fresh create
  // has nothing to delete — and only when the caller asked for it.
  if (action === "update" && clearEmptied) {
    const setKeys = new Set(metafields.map((m) => m.key));
    const toDelete = preview.emptyMetafieldKeys.filter((k) => !setKeys.has(k));
    if (toDelete.length) {
      try {
        await shopifyGraphQL(METAFIELDS_DELETE_MUTATION, {
          metafields: toDelete.map((key) => ({
            ownerId: product.id,
            namespace: METAFIELD_NAMESPACE,
            key,
          })),
        });
      } catch {
        warnings.push(`Could not clear ${toDelete.length} emptied metafield(s) on Shopify.`);
      }
    }
  }

  await prisma.channelPublication.upsert({
    where: { colorwayId_channel: { colorwayId: id, channel: "SHOPIFY" } },
    create: {
      colorwayId: id,
      channel: "SHOPIFY",
      published: true,
      externalId: product.id,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
    update: {
      published: true,
      externalId: product.id,
      lastPushedAt: new Date(),
      lastPushStatus: "ok",
    },
  });

  const numericId = product.id.split("/").pop();
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "");
  return {
    action,
    productGid: product.id,
    handle: product.handle,
    variants: product.variants.edges.length,
    metafields: metafields.length,
    warnings,
    adminUrl: `https://${store}/admin/products/${numericId}`,
    ...(adopted ? { adopted } : {}),
    ...(variantRefs ? { variantRefs } : {}),
  };
}

export interface BulkPushRow {
  colorwayId: string;
  ok: boolean;
  action?: "create" | "update";
  variants?: number;
  warnings?: string[];
  error?: string;
}

// Push many colorways with bounded concurrency (Shopify throttling is handled
// in the client). One product's failure never blocks the rest.
export async function bulkPushToShopify(
  ids: string[],
  seasonCode?: string,
  opts: { allowIncomplete?: boolean; clearEmptied?: boolean } = {}
): Promise<BulkPushRow[]> {
  const CONCURRENCY = 3;
  const results: BulkPushRow[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const rows = await Promise.all(
      batch.map(async (colorwayId): Promise<BulkPushRow> => {
        try {
          const r = await pushColorwayToShopify(
            colorwayId,
            seasonCode,
            opts.allowIncomplete ?? false,
            opts.clearEmptied ?? false
          );
          return { colorwayId, ok: true, action: r.action, variants: r.variants, warnings: r.warnings };
        } catch (err) {
          return { colorwayId, ok: false, error: err instanceof Error ? err.message : "Push failed" };
        }
      })
    );
    results.push(...rows);
  }
  return results;
}
