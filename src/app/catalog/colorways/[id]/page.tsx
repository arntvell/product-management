import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { safeFrom } from "@/lib/back-link";
import { getColorwayForEdit, listColorwayOptions } from "@/lib/master/queries";
import {
  ColorwayEditor,
  type ColorwayEditorProps,
} from "@/components/catalog/colorway-editor";
import { ChannelsPanel } from "@/components/catalog/channels-panel";
import { ReferencesPanel } from "@/components/catalog/references-panel";
import {
  CHANNELS,
  OVERRIDE_FIELD_KEYS,
  SPLIT_FIELD_KEYS,
  type ChannelKey,
  type ProductStatusValue,
  type SplitFieldKey,
} from "@/lib/master/fields";

export const dynamic = "force-dynamic";

export default async function ColorwayEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const from = safeFrom((await searchParams).from);
  const [cw, colorwayOptions] = await Promise.all([
    getColorwayForEdit(id),
    listColorwayOptions(),
  ]);
  if (!cw) notFound();

  const initialBase = Object.fromEntries(
    SPLIT_FIELD_KEYS.map((k) => [k, (cw[k] as string | null) ?? ""])
  ) as Record<SplitFieldKey, string>;

  const initialOverrides = Object.fromEntries(
    CHANNELS.map((c) => [c, {}])
  ) as ColorwayEditorProps["initialOverrides"];
  for (const row of cw.channelContent) {
    if (
      (CHANNELS as readonly string[]).includes(row.channel) &&
      (OVERRIDE_FIELD_KEYS as readonly string[]).includes(row.field)
    ) {
      initialOverrides[row.channel as ChannelKey][row.field] = row.value;
    }
  }

  // One price field per season the product is in, carrying the season id the
  // save writes back against. A season with no Price row shows an empty field
  // rather than being hidden — "no price yet" is the thing to fix.
  const priceBySeason = new Map(cw.prices.map((p) => [p.seasonId, p.amount.toString()]));
  const seasonPrices = [
    ...new Map(cw.entries.map((e) => [e.season.id, e.season.code])).entries(),
  ].map(([seasonId, code]) => ({
    seasonId,
    code,
    amount: priceBySeason.get(seasonId) ?? "",
  }));

  // Which systems hold this product. Store vintage carries SITOO and LOOM and
  // no SHOPIFY row; online vintage the reverse — so this is also what keeps a
  // store-only edit off the webshop.
  const targetedChannels = cw.publications.map((p) => p.channel);

  const initialPublications = cw.publications.map((p) => ({
    channel: p.channel,
    published: p.published,
    externalId: p.externalId,
    lastPushedAt: p.lastPushedAt?.toISOString() ?? null,
    lastPushStatus: p.lastPushStatus,
  }));

  // How much of the product the till holds: a Sitoo push updates when every
  // size is there, and creates the product otherwise.
  const [sizeTotal, sizesInSitoo] = await Promise.all([
    prisma.variant.count({ where: { colorwayId: cw.id } }),
    prisma.variant.count({ where: { colorwayId: cw.id, channelRefs: { some: { channel: "SITOO" } } } }),
  ]);
  const shopifyGid = cw.publications.find((p) => p.channel === "SHOPIFY")?.externalId;
  const store = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopifyAdminUrl = shopifyGid && store ? `https://${store}/admin/products/${shopifyGid.split("/").pop()}` : null;

  return (
    <>
      <ColorwayEditor
        colorwayId={cw.id}
        source={cw.source}
        header={{
          name: cw.name,
          colorwaySku: cw.colorwaySku,
          styleName: cw.style.styleName,
          styleId: cw.style.id,
        }}
        initialProps={{
          status: cw.status as ProductStatusValue,
          tags: cw.tags,
          vendor: cw.vendor ?? "",
          productType: cw.productType ?? "",
        }}
        initialBase={initialBase}
        initialOverrides={initialOverrides}
        styleColorwayCount={cw.style._count.colorways}
        initialPrices={seasonPrices}
        targetedChannels={targetedChannels}
        from={from}
      />
      <ReferencesPanel
        colorwayId={cw.id}
        colorwayOptions={colorwayOptions.filter((o) => o.id !== cw.id)}
        initial={{
          carePageId: cw.carePageId,
          fitguidePageId: cw.fitguidePageId,
          recommendedCollectionId: cw.recommendedCollectionId,
          modelInfoId: cw.modelInfoId,
          sameProduct: cw.sameProduct,
          styleWith: cw.styleWith,
          styleWithUnisexHerre: cw.styleWithUnisexHerre,
          styleWithUnisexDame: cw.styleWithUnisexDame,
        }}
      />
      <ChannelsPanel
        colorwayId={cw.id}
        initialPublications={initialPublications}
        seasonCodes={cw.entries.map((e) => e.season.code)}
        brandIsLivid={cw.brand?.isLivid === true}
        sitooSizes={{ linked: sizesInSitoo, total: sizeTotal }}
        shopifyAdminUrl={shopifyAdminUrl}
      />
    </>
  );
}
