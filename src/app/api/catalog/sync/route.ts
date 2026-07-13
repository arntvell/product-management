import { NextResponse } from "next/server";
import { syncSeason, type SyncMode } from "@/lib/threadflow/sync";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/sync  { seasonCode: "SS27", mode?: "full" | "no-images" }
export async function POST(req: Request) {
  let body: { seasonCode?: string; mode?: SyncMode };
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

  try {
    const result = await syncSeason(seasonCode, body.mode ?? "full");
    const httpStatus = result.status === "failed" ? 502 : 200;
    return NextResponse.json(result, { status: httpStatus });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}

// GET /api/catalog/sync — recent sync runs (for the browse UI).
export async function GET() {
  const runs = await prisma.syncRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 10,
  });
  return NextResponse.json({ runs });
}
