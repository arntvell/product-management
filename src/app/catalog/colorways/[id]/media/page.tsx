import { notFound } from "next/navigation";
import { safeFrom } from "@/lib/back-link";
import { prisma } from "@/lib/db";
import { listColorwayMedia } from "@/lib/master/media";
import { MediaManager, type MediaItem } from "@/components/catalog/media-manager";

export const dynamic = "force-dynamic";

export default async function ColorwayMediaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const from = safeFrom((await searchParams).from);
  const cw = await prisma.colorway.findUnique({
    where: { id },
    select: { id: true, name: true, styleId: true },
  });
  if (!cw) notFound();
  const media = await listColorwayMedia(id);
  return (
    <MediaManager
      colorwayId={cw.id}
      colorwayName={cw.name}
      styleId={cw.styleId}
      initialMedia={media as MediaItem[]}
      from={from}
    />
  );
}
