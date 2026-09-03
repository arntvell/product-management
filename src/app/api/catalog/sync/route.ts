import { NextResponse } from "next/server";
import {
  isSyncMode,
  previewSeason,
  syncSeason,
  SYNC_MODES,
} from "@/lib/threadflow/sync";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/sync
//   { seasonCode: "SS27", mode?: "full" | "no-images", dryRun?: boolean }
// dryRun returns what the sync would do and writes nothing — not even a SyncRun
// row.
export async function POST(req: Request) {
  let body: { seasonCode?: string; mode?: unknown; dryRun?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const seasonCode = body.seasonCode?.trim();
  if (!seasonCode) {
    return NextResponse.json(
      { error: "seasonCode is required (e.g. \"SS27\")" },
      { status: 400 }
    );
  }

  const mode = body.mode ?? "full";
  if (!isSyncMode(mode)) {
    return NextResponse.json(
      { error: `mode must be one of ${SYNC_MODES.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    if (body.dryRun) {
      const preview = await previewSeason(seasonCode, mode);
      return NextResponse.json({ dryRun: true, ...preview });
    }
    const result = await syncSeason(seasonCode, mode);
    // Only a thrown error is a 502. "partial" means the run completed and wrote
    // everything it could, with the rest reported in `skipped` — that is a
    // success with caveats, not a failure.
    const httpStatus = result.status === "failed" ? 502 : 200;
    return NextResponse.json({ dryRun: false, ...result }, { status: httpStatus });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// GET /api/catalog/sync?take=10&seasonCode=SS27 — recent runs, so a past run's
// warnings and skips are readable without going to the database.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const takeRaw = Number(url.searchParams.get("take") ?? 10);
  const take = Number.isFinite(takeRaw)
    ? Math.min(Math.max(Math.trunc(takeRaw), 1), 50)
    : 10;
  const seasonCode = url.searchParams.get("seasonCode")?.trim() || undefined;

  const runs = await prisma.syncRun.findMany({
    where: seasonCode ? { seasonCode } : undefined,
    orderBy: { startedAt: "desc" },
    take,
    select: {
      id: true,
      source: true,
      mode: true,
      seasonCode: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      counts: true,
      errors: true,
      warnings: true,
      skipped: true,
    },
  });
  return NextResponse.json({ runs });
}
