// Telling Loom about a channel id the moment we learn it.
//
// Loom's stock registry joins Shopify on the InventoryItem id and Sitoo on the
// SKU, and it only holds what our feed asserts. Both ids are minted by the
// channel: Shopify returns the InventoryItem from productSet, Sitoo returns its
// product on create. So a colourway already in Loom that is then pushed to
// Shopify (or created in Sitoo) is invisible to the registry for that channel
// until something re-sends it — and nothing did. Stock stopped syncing
// Pio -> Shopify -> Loom -> Sitoo for exactly those products: Norda 001A,
// pushed to Shopify on 2026-09-28 five days after its last Loom push, and the
// vintage drop sheet, whose "Push to Loom" button came before "Push to Shopify".
//
// This is the follow-up every channel write calls. It sends only what is
// ALREADY live in Loom: a product never pushed there goes out with its first
// publish, which reads the ids itself; an archived one is left alone, because
// the registry push sends loom:true and would un-archive it.
//
// One send per colourway, under one season it is entered in. Identity is
// season-free — the season only picks which prices ride along, and pushing
// under one season never strips the others. The job is not waited on: the
// callers sit inside a 300 s function, and Loom's job wait budgets 600 s.

import { pushColorwaysToLoom } from "@/lib/loom/push";
import { loomScope } from "./variant-barcodes";

export interface LoomFollowUpSend {
  seasonCode: string;
  colorwayIds: string[];
  ok: boolean;
  eventId?: string;
  jobId?: string;
  skipped: Array<{ colorwayId: string; reason: string }>;
  error?: string;
}

export interface LoomFollowUp {
  sends: LoomFollowUpSend[];
  /** Never pushed to Loom — their first publish carries the ids. */
  notInLoom: string[];
  /** Archived in the master; re-sending would un-archive them in Loom. */
  archived: string[];
}

/** Loom's upsert takes this many colourways comfortably in one delivery. */
const CHUNK = 250;

export async function sendChannelIdsToLoom(
  colorwayIds: string[],
  opts: {
    /** The season the triggering push ran under — used when the colourway is
     *  entered in it, so the prices that ride along match what was pushed. */
    preferSeason?: string | null;
  } = {}
): Promise<LoomFollowUp> {
  const ids = [...new Set(colorwayIds)];
  const out: LoomFollowUp = { sends: [], notInLoom: [], archived: [] };
  if (!ids.length) return out;

  const scope = await loomScope(ids);
  out.archived = ids.filter((id) => scope.archived.has(id));
  out.notInLoom = ids.filter((id) => !scope.live.has(id) && !scope.archived.has(id));

  // loomScope lists each colourway under every season it is entered in, in
  // season order. Pick one: the triggering push's season, else CONTINUITY (the
  // shelf a carry-over lives on), else the latest.
  const seasonsOf = new Map<string, string[]>();
  for (const g of scope.groups)
    for (const id of g.colorwayIds) seasonsOf.set(id, [...(seasonsOf.get(id) ?? []), g.seasonCode]);

  const bySeason = new Map<string, string[]>();
  for (const id of ids) {
    const seasons = seasonsOf.get(id);
    if (!scope.live.has(id) || !seasons?.length) continue;
    const season =
      (opts.preferSeason && seasons.includes(opts.preferSeason) && opts.preferSeason) ||
      (seasons.includes("CONTINUITY") ? "CONTINUITY" : seasons[seasons.length - 1]);
    bySeason.set(season, [...(bySeason.get(season) ?? []), id]);
  }

  for (const [seasonCode, list] of bySeason)
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      try {
        // The delivery id is derived from the contents, so a re-push that
        // changed nothing Loom holds is deduped there rather than re-applied.
        const res = await pushColorwaysToLoom(chunk, seasonCode, { mode: "data", skipJobWait: true });
        out.sends.push({
          seasonCode,
          colorwayIds: chunk,
          ok: res.ok,
          eventId: res.eventId,
          jobId: res.jobId,
          skipped: res.skipped,
          ...(res.ok ? {} : { error: (res.raw ?? "Loom refused the delivery").slice(0, 500) }),
        });
      } catch (err) {
        out.sends.push({
          seasonCode,
          colorwayIds: chunk,
          ok: false,
          skipped: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

  return out;
}

/** One line for a push result's warnings, or null when there is nothing to say. */
export function describeLoomFollowUp(f: LoomFollowUp): string | null {
  const failed = f.sends.filter((s) => !s.ok);
  const skipped = f.sends.flatMap((s) => s.skipped);
  if (!failed.length && !skipped.length) return null;
  return [
    ...failed.map((s) => `Loom did not take the channel ids (${s.seasonCode}): ${s.error}`),
    ...skipped.map((s) => `Loom skipped ${s.colorwayId}: ${s.reason}`),
  ].join(" · ");
}
