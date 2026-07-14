// Push master products to Loom's upsert endpoint.
import { prisma } from "@/lib/db";
import { buildLoomPayload } from "./payload";
import { loomUpsert } from "./client";

export interface LoomPushResult {
  ok: boolean;
  status: number;
  styles: number;
  colorways: number;
  response: unknown;
  raw: string;
}

export async function pushColorwaysToLoom(
  colorwayIds: string[],
  seasonCode: string
): Promise<LoomPushResult> {
  const payload = await buildLoomPayload(colorwayIds, seasonCode);
  const res = await loomUpsert(payload);

  if (res.ok) {
    // Record the Loom publication on success.
    await prisma.$transaction(
      colorwayIds.map((colorwayId) =>
        prisma.channelPublication.upsert({
          where: { colorwayId_channel: { colorwayId, channel: "LOOM" } },
          create: {
            colorwayId,
            channel: "LOOM",
            published: true,
            lastPushedAt: new Date(),
            lastPushStatus: "ok",
          },
          update: { published: true, lastPushedAt: new Date(), lastPushStatus: "ok" },
        })
      )
    );
  }

  return {
    ok: res.ok,
    status: res.status,
    styles: payload.styles.length,
    colorways: colorwayIds.length,
    response: res.data,
    raw: res.raw,
  };
}
