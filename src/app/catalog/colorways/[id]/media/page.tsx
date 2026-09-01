import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { listColorwayMedia } from "@/lib/master/media";
import { MediaManager, type MediaItem } from "@/components/catalog/media-manager";

export const dynamic = "force-dynamic";

export default async function ColorwayMediaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
    />
  );
}
