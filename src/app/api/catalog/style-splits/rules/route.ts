import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { SEED_NAME_RULES } from "@/lib/master/style-name-rules";
import { normName } from "@/lib/master/style-splits";

export const dynamic = "force-dynamic";

// GET  /api/catalog/style-splits/rules   — the baseline plus what has been decided
// POST /api/catalog/style-splits/rules   { name, kind, parent?, note? }
//
// Rejecting a proposal is a decision worth keeping: without it the same
// low-confidence row comes back on every run. "Water Lily Incense" shares a
// leading word with seventeen water bottles and is not one of them — recording
// that once is what lets the next report propose "Water Bottle" cleanly.
/**
 * The table is allowed not to exist yet — the report runs on the baseline list
 * until the migration lands. Say so plainly rather than 500ing, because that is
 * the difference between "nothing to show" and "your rejection was not saved".
 */
function tableMissing(err: unknown): boolean {
  return (err as { code?: string }).code === "P2021";
}

// Two different causes, two different fixes — saying "restart the dev server"
// when the client is fine and the table is not just sends you the wrong way.
const NEEDS_MIGRATION =
  "The StyleNameRule table does not exist yet — run `npx prisma migrate deploy`. " +
  "No restart needed afterwards.";
const NEEDS_RESTART =
  "This Prisma client predates StyleNameRule — run `npx prisma generate` and " +
  "restart the dev server.";

export async function GET() {
  if (!prisma.styleNameRule) {
    return NextResponse.json({ seed: SEED_NAME_RULES, stored: [], warning: NEEDS_RESTART });
  }
  try {
    const stored = await prisma.styleNameRule.findMany({ orderBy: { name: "asc" } });
    return NextResponse.json({ seed: SEED_NAME_RULES, stored });
  } catch (err) {
    if (tableMissing(err)) {
      return NextResponse.json({ seed: SEED_NAME_RULES, stored: [], warning: NEEDS_MIGRATION });
    }
    throw err;
  }
}

const KINDS = ["COMPOUND", "PARENT_OVERRIDE", "KEEP_SEPARATE"] as const;
type Kind = (typeof KINDS)[number];

export async function POST(req: Request) {
  let body: { name?: string; kind?: Kind; parent?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = normName(body.name ?? "");
  const kind = body.kind;
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json(
      { error: `kind must be one of ${KINDS.join(" | ")}` },
      { status: 400 }
    );
  }
  if (kind === "PARENT_OVERRIDE" && !body.parent?.trim()) {
    return NextResponse.json(
      { error: "parent is required for PARENT_OVERRIDE" },
      { status: 400 }
    );
  }

  if (!prisma.styleNameRule) {
    return NextResponse.json({ error: NEEDS_RESTART }, { status: 503 });
  }

  const data = {
    kind,
    parent: body.parent?.trim() || null,
    note: body.note?.trim() || null,
  };
  try {
    const rule = await prisma.styleNameRule.upsert({
      where: { name },
      create: { name, ...data },
      update: data,
    });
    return NextResponse.json({ ok: true, rule });
  } catch (err) {
    if (tableMissing(err)) return NextResponse.json({ error: NEEDS_MIGRATION }, { status: 503 });
    throw err;
  }
}

export async function DELETE(req: Request) {
  const name = normName(new URL(req.url).searchParams.get("name") ?? "");
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    await prisma.styleNameRule.deleteMany({ where: { name } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (tableMissing(err)) return NextResponse.json({ error: NEEDS_MIGRATION }, { status: 503 });
    throw err;
  }
}
