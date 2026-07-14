import { notFound } from "next/navigation";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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

  const initialPublications = cw.publications.map((p) => ({
    channel: p.channel,
    published: p.published,
    externalId: p.externalId,
    lastPushedAt: p.lastPushedAt?.toISOString() ?? null,
    lastPushStatus: p.lastPushStatus,
  }));

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
      <ChannelsPanel colorwayId={cw.id} initialPublications={initialPublications} />
    </>
  );
}
