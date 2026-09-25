import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { revealProducts, HIDE_TAGS } from "@/lib/shopify/reveal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

// GET  /api/vintage/schedule            — what is scheduled
// POST /api/vintage/schedule            — { drop, revealAt } | { drop, cancel: true }
// POST /api/vintage/schedule?run=due    — reveal everything now due (the cron)
//
// Pushing and revealing are separate moments: garments reach Shopify hidden as
// the shoot finishes, and the drop opens at an announced time. This stores the
// intention so nobody has to be at a keyboard on Friday at the hour.
//
// THE CRON NEEDS TO GET PAST THE PASSWORD GATE. `vercel.json` schedules
// `?run=due` every ten minutes, and `middleware.ts` requires either the auth
// cookie or `Authorization: Bearer <APP_PASSWORD>`. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>`, so the two have to agree: set
// CRON_SECRET to the same value as APP_PASSWORD in Production. Deliberately
// not solved by exempting this path in middleware — an unauthenticated route
// that publishes products to a storefront is not a trade worth making, and the
// gate was only just fixed to stop failing open.
//
// Until they agree the cron 401s silently, which is why `revealAt` staying set
// with `revealedAt` null is visible on the schedule listing: a drop that
// should have opened and did not is the thing to notice.

export async function GET() {
  const rows = await prisma.vintageDropReveal.findMany({ orderBy: { revealAt: "asc" } });
  return NextResponse.json({
    ok: true,
    schedules: rows.map((r) => ({
      drop: r.drop,
      revealAt: r.revealAt,
      revealedAt: r.revealedAt,
      lastResult: r.lastResult,
      due: !!r.revealAt && !r.revealedAt && r.revealAt <= new Date(),
    })),
  });
}

export async function POST(req: Request) {
  const run = new URL(req.url).searchParams.get("run");
  if (run === "due") return runDue();

  let body: { drop?: string; revealAt?: string; cancel?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const drop = body.drop?.trim();
  if (!drop) return NextResponse.json({ error: "drop is required" }, { status: 400 });

  if (body.cancel) {
    await prisma.vintageDropReveal.deleteMany({ where: { drop } });
    return NextResponse.json({ ok: true, cancelled: drop });
  }

  const at = body.revealAt ? new Date(body.revealAt) : null;
  if (body.revealAt && Number.isNaN(at?.getTime()))
    return NextResponse.json({ error: "revealAt is not a date" }, { status: 400 });

  const row = await prisma.vintageDropReveal.upsert({
    where: { drop },
    create: { drop, revealAt: at },
    // Re-scheduling clears revealedAt: saying "open it at five" after it has
    // already opened is a request to open it again, not a no-op.
    update: { revealAt: at, revealedAt: null, lastResult: null },
  });
  return NextResponse.json({ ok: true, drop: row.drop, revealAt: row.revealAt });
}

/**
 * Reveal every drop whose time has come.
 *
 * Written to be safe to call on any schedule and from anywhere: it only ever
 * acts on rows that are due and not already revealed, and it stamps
 * `revealedAt` before reporting, so two overlapping cron ticks cannot both
 * reveal the same drop.
 */
async function runDue() {
  const now = new Date();
  const due = await prisma.vintageDropReveal.findMany({
    where: { revealedAt: null, revealAt: { not: null, lte: now } },
  });
  if (!due.length) return NextResponse.json({ ok: true, revealed: 0, drops: [] });

  const results: Array<{ drop: string; revealed: number; warnings: string[] }> = [];

  for (const row of due) {
    // Claim it first. A second tick arriving mid-reveal then finds nothing due
    // rather than publishing the same drop twice.
    const claimed = await prisma.vintageDropReveal.updateMany({
      where: { drop: row.drop, revealedAt: null },
      data: { revealedAt: now },
    });
    if (!claimed.count) continue;

    const colorways = await prisma.colorway.findMany({
      where: { entries: { some: { drop: row.drop } } },
      select: {
        id: true,
        tags: true,
        publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
      },
    });
    const live = colorways.filter((c) => c.publications[0]?.externalId);

    if (!live.length) {
      await prisma.vintageDropReveal.update({
        where: { drop: row.drop },
        data: { revealedAt: null, lastResult: "Nothing on Shopify yet — left scheduled." },
      });
      results.push({ drop: row.drop, revealed: 0, warnings: ["nothing pushed yet"] });
      continue;
    }

    const r = await revealProducts(live.map((c) => c.publications[0]!.externalId!));
    await prisma.$transaction(
      live.map((c) =>
        prisma.colorway.update({
          where: { id: c.id },
          data: { tags: c.tags.filter((t) => !HIDE_TAGS.includes(t.trim().toLowerCase() as never)) },
        })
      )
    );
    await prisma.vintageDropReveal.update({
      where: { drop: row.drop },
      data: {
        lastResult:
          `untagged ${r.untagged.length}, published ${r.published.length}` +
          (r.warnings.length ? ` — ${r.warnings.length} warning(s): ${r.warnings[0]}` : ""),
      },
    });
    results.push({ drop: row.drop, revealed: r.untagged.length, warnings: r.warnings });
  }

  return NextResponse.json({ ok: true, revealed: results.length, drops: results });
}
