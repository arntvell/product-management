// Push a swapped twin to Loom: the live record un-archives with the stock, and
// the shell is archived. Run AFTER scripts/twin-pin/swap-ids.ts.
//
//   npx tsx scripts/twin-pin/loom-push.ts --only=LIV-SRN-JPN-BLCK-DSK            dry run, sends nothing
//   npx tsx scripts/twin-pin/loom-push.ts --only=LIV-SRN-JPN-BLCK-DSK --apply    sends to Loom
//
// One `data` push of both records, WITHOUT allow_variant_reparent. After the
// swap every size sent already sits on the Loom record it is sent under, so the
// push should update in place and move nothing. The dry run proves that before
// anything is sent: any size whose Loom parent differs from the one it is sent
// under is a MOVE, and the script refuses.
//
// --allow-move=<variantId,…> admits named sizes that Loom holds on the shell
// with 0 units: the ML-WHT case, where the stock-bearing identity was only ever
// one size and the other sizes' Loom identities live on the shell. Only then is
// allow_variant_reparent sent.
//
// Expected Loom outcome: the live record un-archived under the business SKU,
// 0 variantsCreated, variantsMoved = the allowed moves; the shell archived. Pio may report
// kept_has_stock for the shell if it holds a unit under the Threadflow
// spelling. That is a Pio count, not a push to retry.

import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
// Sizes allowed to MOVE from the shell to the live record, by our variant id.
// Only for sizes Loom holds on the shell with 0 units everywhere; anything else
// refuses. Turns on allow_variant_reparent for this push.
const ALLOW_MOVE = new Set((process.argv.find((a) => a.startsWith("--allow-move="))?.slice(13) ?? "").split(",").filter(Boolean));
const SEASON = process.argv.find((a) => a.startsWith("--season="))?.slice(9) ?? "FW26";
const LOOM = "https://loom.livid.no/api/origio/v1";

async function main() {
  if (!ONLY) throw new Error("Pass --only=<business colorway SKU>");
  const { prisma } = await import("../../src/lib/db.ts");
  const { pushColorwaysToLoom } = await import("../../src/lib/loom/push.ts");
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;

  const live = await prisma.colorway.findUnique({ where: { colorwaySku: ONLY }, select: { id: true, archived: true } });
  const tomb = await prisma.colorway.findFirst({
    where: { colorwaySku: { startsWith: `${ONLY}--merged-into-` } }, select: { id: true, colorwaySku: true, archived: true },
  });
  if (!live || !tomb) throw new Error(`${ONLY}: live or tombstone missing`);
  if (!tomb.colorwaySku.endsWith(live.id.slice(0, 8))) throw new Error("tombstone does not point at the live record");

  // Where Loom has each size right now, by our variant id.
  const loomParent = new Map<string, string>();
  const loomOnHand = new Map<string, number>();
  const loomRecs: Record<string, any> = {};
  const { rows: all } = await sweepFor([live.id, tomb.id], token!);
  for (const r of all) {
    loomRecs[r.colorway_id] = r;
    for (const v of r.variants ?? []) {
      loomParent.set(v.variant_id, r.colorway_id);
      loomOnHand.set(v.variant_id, (v.stock ?? []).reduce((a: number, s: any) => a + Math.abs(s.on_hand ?? 0), 0));
    }
  }
  // Loom binds a size SKU to one variant id. Sending the SKU under another id is
  // the "owned by stable variant" refusal of 2026-09-15.
  const ownerOfSku = async (sku: string): Promise<string | null> => {
    const base = sku.replace(/-[^-]+$/, "");
    const rows: any[] = ((await (await fetch(`${LOOM}/products?sku=${encodeURIComponent(base)}`, {
      headers: { authorization: `Bearer ${token}` },
    })).json()) as any).rows ?? [];
    for (const r of [...rows, ...all]) for (const v of r.variants ?? []) if (v.variant_sku === sku) return v.variant_id;
    return null;
  };

  const res = await pushColorwaysToLoom([live.id, tomb.id], SEASON, { mode: "data", dryRun: true });
  if (!res.preview) { console.log("Nothing to send:", res.raw, JSON.stringify(res.skipped)); process.exit(1); }
  const cws = res.preview.payload.styles.flatMap((s: any) => s.colorways);

  let moves = 0, creates = 0, owned = 0;
  const allowedMoves = new Set<string>();
  for (const c of cws) {
    const was = loomRecs[c.colorway_id];
    console.log(`${c.colorway_id.slice(0, 8)}  ${c.colorway_sku}  loom=${c.channels.loom}  sizes ${c.variants.length}` +
      `   (Loom now: ${was ? `${was.colorway_sku}, archived=${was.archived}` : "not held"})`);
    for (const v of c.variants) {
      const parent = loomParent.get(v.variant_id);
      const owner = await ownerOfSku(v.variant_sku);
      const tag = !parent ? "CREATE" : parent !== c.colorway_id ? "MOVE"
        : owner && owner !== v.variant_id ? "SKU-OWNED-ELSEWHERE" : "update";
      if (tag === "MOVE") {
        const okMove = ALLOW_MOVE.has(v.variant_id) && parent === tomb.id && c.colorway_id === live.id &&
          loomOnHand.get(v.variant_id) === 0 && !(owner && owner !== v.variant_id);
        if (okMove) { allowedMoves.add(v.variant_id); console.log(`    move (allowed, 0 units, from the shell) ${v.variant_sku} ${v.variant_id}`); continue; }
        moves++;
      }
      if (tag === "CREATE") creates++;
      if (tag === "SKU-OWNED-ELSEWHERE") owned++;
      if (tag !== "update") console.log(`    ${tag} ${v.variant_sku} ${v.variant_id}${owner && owner !== v.variant_id ? ` (Loom: ${owner})` : ""}`);
    }
  }
  for (const s of res.skipped ?? []) console.log(`  skipped ${s.colorwayId}: ${s.reason}`);
  const unused = [...ALLOW_MOVE].filter((id) => !allowedMoves.has(id));
  if (unused.length) console.log(`  --allow-move names size(s) that are not a clean zero-stock move: ${unused.join(", ")}`);
  console.log(`\nsizes that would move: ${moves} unallowed + ${allowedMoves.size} allowed, be created: ${creates}, collide with another id's SKU: ${owned}`);
  if (moves || creates || owned || unused.length) { console.log("REFUSING: this push would not be a clean in-place update."); process.exit(1); }

  if (!APPLY) { console.log("DRY RUN — nothing sent. Add --apply to send."); await prisma.$disconnect(); return; }

  const sent = await pushColorwaysToLoom([live.id, tomb.id], SEASON, {
    mode: "data", ...(allowedMoves.size ? { allowVariantReparent: true } : {}), eventIdSuffix: `twin-swap-${ONLY.toLowerCase()}-${Date.now().toString(36)}`,
  });
  const j = sent.job;
  console.log(`ok ${sent.ok} status ${sent.status} job ${sent.jobId ?? "—"} ${j?.status ?? ""}`);
  if (j) console.log(`  created ${j.created ?? 0} updated ${j.updated ?? 0} archived ${j.archived ?? 0} ` +
    `variantsCreated ${j.variantsCreated ?? 0} variantsUpdated ${j.variantsUpdated ?? 0} variantsMoved ${j.variantsMoved ?? 0} ` +
    `moveRefused ${j.variantsMoveRefused ?? 0}`);
  if (j?.itemErrors?.length) console.log(`  itemErrors ${JSON.stringify(j.itemErrors).slice(0, 800)}`);
  if (j?.fatalError) console.log(`  fatalError ${j.fatalError}`);

  const after = (await sweepFor([live.id, tomb.id], token!)).rows;
  for (const r of after) {
    const units = (r.variants ?? []).reduce((a: number, v: any) => a + (v.stock ?? []).reduce((b: number, s: any) => b + (s.on_hand ?? 0), 0), 0);
    console.log(`  read back ${r.colorway_id.slice(0, 8)} ${r.colorway_sku} archived=${r.archived} sizes ${r.variants?.length} units ${units}`);
  }
  await prisma.$disconnect();
  process.exit(sent.ok ? 0 : 1);
}

/** Loom reads by SKU only, so find records by id with a full sweep. */
async function sweepFor(ids: string[], token: string): Promise<{ rows: any[] }> {
  const want = new Set(ids);
  const rows: any[] = [];
  let cursor: string | null = null;
  do {
    const r: any = await (await fetch(`${LOOM}/products${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { authorization: `Bearer ${token}` },
    })).json();
    for (const x of r.rows ?? []) if (want.has(x.colorway_id)) rows.push(x);
    cursor = r.nextCursor ?? null;
  } while (cursor && rows.length < ids.length);
  return { rows };
}

main().catch((e) => { console.error(e); process.exit(1); });
