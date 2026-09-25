import { NextResponse } from "next/server";
import { pushColorwaysToLoom } from "@/lib/loom/push";
import type { LoomMode } from "@/lib/loom/payload";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // includes waiting for Loom's job to settle

// POST /api/catalog/push/loom
//   { colorwayIds, seasonCode, mode?, dryRun?, archiveColorwayIds?, skipJobWait? }
//
// `mode` decides what job Loom is doing, and it changes who is eligible:
//   "full"  (default) the wholesale catalogue — Livid only, readiness-gated
//   "data"            the stock registry — identity only, no readiness gate,
//                     and nothing excluded, because stock that does not reach
//                     the registry does not reconcile.
// This was accepted by pushColorwaysToLoom but never read here, so every push
// silently ran as "full" and the registry mode was unreachable through the API.
// Writes LIVE to Loom's upsert endpoint unless dryRun is set, in which case the
// payload is built and reported but nothing is transmitted or marked published.
export async function POST(req: Request) {
  let body: {
    colorwayIds?: string[];
    seasonCode?: string;
    dryRun?: boolean;
    archiveColorwayIds?: string[];
    skipJobWait?: boolean;
    eventId?: string;
    mode?: string;
    allowVariantReparent?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.colorwayIds) || !body.colorwayIds.length || !body.seasonCode) {
    return NextResponse.json(
      { error: "colorwayIds and seasonCode are required" },
      { status: 400 }
    );
  }
  const mode = body.mode ?? "full";
  if (mode !== "full" && mode !== "data") {
    return NextResponse.json(
      { error: 'mode must be "full" (wholesale catalogue) or "data" (stock registry)' },
      { status: 400 }
    );
  }
  try {
    const result = await pushColorwaysToLoom(body.colorwayIds, body.seasonCode, {
      dryRun: body.dryRun,
      archiveColorwayIds: body.archiveColorwayIds,
      skipJobWait: body.skipJobWait,
      eventId: body.eventId,
      mode: mode as LoomMode,
      // Opt-in, and only ever true when the caller said so explicitly. Loom
      // refuses a re-parent by default because the variant row carries stock,
      // cost and order history; that refusal is a guard, not an obstacle.
      allowVariantReparent: body.allowVariantReparent === true,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Loom push failed" },
      { status: 500 }
    );
  }
}
