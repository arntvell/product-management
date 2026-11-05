import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseDraftPayload } from "@/lib/master/draft-payload";
import { DraftPushPanel } from "@/components/catalog/draft-push-panel";

export const dynamic = "force-dynamic";

export default async function DraftDonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const draft = await prisma.productDraft.findUnique({ where: { id } });
  if (!draft) notFound();

  // Several styles built together are one result: every created style's
  // colourways, published as one batch. A style that was not created is
  // listed below with a way back to it.
  const siblings =
    draft.groupId === draft.id
      ? await prisma.productDraft.findMany({
          where: { groupId: id, id: { not: id }, status: { not: "DISCARDED" } },
          orderBy: { createdAt: "asc" },
          select: { id: true, title: true, status: true, createdColorwayIds: true },
        })
      : [];
  const colorwayIds = [
    ...draft.createdColorwayIds,
    ...siblings.filter((s) => s.status === "COMPLETED").flatMap((s) => s.createdColorwayIds),
  ];
  const leftBehind = siblings.filter((s) => s.status !== "COMPLETED");

  const colorways = await prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    select: {
      id: true,
      colorwaySku: true,
      name: true,
      _count: { select: { variants: true } },
      publications: { select: { channel: true, published: true, lastPushStatus: true } },
    },
    orderBy: { colorwaySku: "asc" },
  });

  const variants = colorways.reduce((a, c) => a + c._count.variants, 0);

  // A batch can outlive the page that started it: Loom jobs run past the client's
  // polling window and leave items AWAITING_JOB. `PushBatchItem` is the queue and
  // the API can resume it — but only if the operator can find it again, so hand
  // the panel the batch rather than making a refresh strand it.
  // The season the draft was created for. Without it the batch stores null,
  // submitLoom falls back to CONTINUITY, and every colorway comes back
  // `not in season CONTINUITY` — SKIPPED, which reads as a clean batch.
  const payload = parseDraftPayload(draft.payload);
  const seasonId = payload.seasonId;
  const season = seasonId
    ? await prisma.season.findUnique({ where: { id: seasonId }, select: { code: true } })
    : null;

  const unfinished = await prisma.pushBatch.findFirst({
    where: { draftId: id, status: { in: ["pending", "running"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-page">Created</h1>
      <p className="mt-1 text-body text-muted-foreground">
        {colorways.length} colourway{colorways.length === 1 ? "" : "s"}, {variants} variants
        are in the master. Publishing is a separate, retryable step — the product exists
        whether or not a channel is reachable.
      </p>

      {leftBehind.length ? (
        <div className="mt-4 border border-ink bg-paper p-4 text-body text-ink">
          {leftBehind.length === 1 ? "One style was" : `${leftBehind.length} styles were`} not
          created:
          <ul className="mt-1.5 space-y-1">
            {leftBehind.map((s) => (
              <li key={s.id}>
                <Link href={`/catalog/products/drafts/${s.id}`} className="underline underline-offset-2">
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DraftPushPanel
        draftId={id}
        colorwayIds={colorwayIds}
        channels={draft.channels as ("SHOPIFY" | "LOOM" | "SITOO")[]}
        seasonCode={season?.code}
        // Same policy as the import screen, for the same reason: a draft that
        // came from a file has no description, photograph, swatch, care page or
        // fit guide because its seven columns carry none of them. Deciding that
        // here as well keeps one product from meeting two different gates
        // depending on which screen its operator happened to be on.
        allowIncomplete={payload.origin === "import"}
        unfinishedBatchId={unfinished?.id ?? null}
      />

      <div className="mt-6 border">
        {colorways.map((c) => (
          <div key={c.id} className="border-b px-4 py-3 text-body last:border-0">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <code className="font-mono text-fine">{c.colorwaySku}</code>
                <div className="truncate text-muted-foreground">{c.name}</div>
              </div>
              <div className="shrink-0 text-fine text-muted-foreground">
                {c._count.variants} sizes
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {c.publications.map((p) => (
                <span
                  key={p.channel}
                  className="rounded-full border px-2 py-0.5 text-fine text-muted-foreground"
                >
                  {p.channel} · {p.published ? "published" : "queued"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/catalog/products/new"
          className="border bg-foreground px-3 py-1.5 text-body text-background"
        >
          + Another product
        </Link>
        <Link
          href="/catalog/publishing"
          className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          Publishing
        </Link>
        <Link
          href="/catalog/products/drafts"
          className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          All drafts
        </Link>
      </div>
    </main>
  );
}
