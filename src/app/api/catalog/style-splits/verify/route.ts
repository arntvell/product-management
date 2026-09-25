import { NextResponse } from "next/server";
import { pushColorwaysToLoom, type LoomPushResult } from "@/lib/loom/push";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/style-splits/verify
//   { styleIds: string[], dryRun?: true, mode?: "data" | "full" }
//
// Push one or two re-nested styles and look at what Loom makes of them, before
// the other ~1,000 go. This is the proof run: it answers the two things we
// cannot determine from our side — whether Loom moves a colorway_id that
// arrives under a new style_id, and what it does with the style block that is
// left empty.
//
// Three things it does differently from the generic push endpoint, each of
// which matters here:
//
//   whole styles, not colourways   You verify nesting, so every colourway of
//                                  the style has to go — a partial send tells
//                                  you nothing about grouping.
//   one call per season            The payload is season-scoped, and a re-nested
//                                  style usually spans Archive plus a live one.
//   mode "data" by default         "full" is readiness-gated and silently skips
//                                  colourways; a skipped one stays under its OLD
//                                  style in Loom, which looks exactly like the
//                                  re-nest having failed.
//
// Dry run unless told otherwise: LOOM_URL is unset in local dev, so a real send
// from a laptop goes to production Loom.
export async function POST(req: Request) {
  let body: { styleIds?: string[]; dryRun?: boolean; mode?: "data" | "full" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const styleIds = body.styleIds?.filter(Boolean) ?? [];
  if (!styleIds.length) {
    return NextResponse.json({ error: "styleIds is required" }, { status: 400 });
  }
  // A guard rail, not a limit of the mechanism: this endpoint exists to send a
  // couple of styles. Sending the whole repair through it would defeat it.
  if (styleIds.length > 5) {
    return NextResponse.json(
      { error: "Verify at most 5 styles at a time — that is the point of it." },
      { status: 400 }
    );
  }

  const dryRun = body.dryRun !== false;
  const mode = body.mode ?? "data";

  const styles = await prisma.style.findMany({
    where: { id: { in: styleIds } },
    select: {
      id: true,
      styleSku: true,
      styleName: true,
      colorways: {
        select: {
          id: true,
          colorwaySku: true,
          archived: true,
          entries: { select: { season: { select: { code: true } } } },
        },
      },
    },
  });
  if (!styles.length) {
    return NextResponse.json({ error: "No such style" }, { status: 404 });
  }

  // Group by season: one delivery per season, carrying every colourway of these
  // styles that belongs to it.
  const bySeason = new Map<string, { ids: string[]; archived: string[] }>();
  for (const s of styles) {
    for (const cw of s.colorways) {
      for (const code of new Set(cw.entries.map((e) => e.season.code))) {
        const bucket = bySeason.get(code) ?? { ids: [], archived: [] };
        bucket.ids.push(cw.id);
        // An archived colourway still goes, flagged channels.loom = false —
        // that is how Loom is told which of two same-named colours is retired.
        if (cw.archived) bucket.archived.push(cw.id);
        bySeason.set(code, bucket);
      }
    }
  }

  const unseasoned = styles.flatMap((s) =>
    s.colorways.filter((c) => !c.entries.length).map((c) => c.colorwaySku)
  );

  // A fresh event id per run. Loom dedupes on the delivery id, so a retry that
  // reuses one is answered with the original job's stale result.
  const stamp = `${Date.now().toString(36)}`;

  const runs: Array<{
    season: string;
    colorways: number;
    archived: number;
    result?: LoomPushResult;
    error?: string;
  }> = [];

  for (const [season, bucket] of bySeason) {
    const entry = {
      season,
      colorways: bucket.ids.length,
      archived: bucket.archived.length,
    };
    try {
      const result = await pushColorwaysToLoom(bucket.ids, season, {
        dryRun,
        mode,
        archiveColorwayIds: bucket.archived,
        eventId: `origio-splitcheck-${season.toLowerCase()}-${stamp}`,
      });
      runs.push({ ...entry, result });
    } catch (err) {
      runs.push({ ...entry, error: err instanceof Error ? err.message : "Push failed" });
    }
  }

  const skipped = runs.flatMap((r) => r.result?.skipped ?? []);
  return NextResponse.json({
    dryRun,
    mode,
    styles: styles.map((s) => ({
      styleId: s.id,
      styleSku: s.styleSku,
      styleName: s.styleName,
      colorways: s.colorways.length,
    })),
    seasons: [...bySeason.keys()],
    runs,
    // The number that decides whether the verification is worth anything: a
    // skipped colourway never reaches Loom, so it stays nested under its old
    // style and the result you are looking at is not the re-nest.
    skipped,
    warnings: [
      ...(unseasoned.length
        ? [
            `${unseasoned.length} colourway(s) belong to no season and cannot be ` +
              `pushed at all: ${unseasoned.slice(0, 5).join(", ")}${unseasoned.length > 5 ? "…" : ""}`,
          ]
        : []),
      ...(skipped.length
        ? [
            `${skipped.length} colourway(s) were not sent. They stay under their ` +
              `old style in Loom, so this run does not show you the finished nesting.`,
          ]
        : []),
    ],
    ok: runs.every((r) => !r.error && (r.result?.ok ?? false)),
  });
}
