import { notFound } from "next/navigation";
import { getColorwayForEdit } from "@/lib/master/queries";
import {
  ColorwayEditor,
  type ColorwayEditorProps,
} from "@/components/catalog/colorway-editor";
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
  const cw = await getColorwayForEdit(id);
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

  return (
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
  );
}
