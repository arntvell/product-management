// Push a split parent's results to Loom: the new one-of-one colourways AND the
// withdrawal of the colourway they came out of, in a single push.
//
// Both halves must travel together. New colourways without the withdrawal leave
// the old parent still claiming those variants in Loom; the withdrawal without
// the new colourways strands the stock. One push, one job.
//
// Loom refuses to re-parent a variant by default — the variant row carries
// stock, cost and order history — so this sets allow_variant_reparent. The
// variant ids are unchanged, which is what lets Loom follow the move instead of
// deleting and recreating.
//
// Usage: node scripts/vintage-split/push.mjs --parent=EXT-VN-NW [--dry-run]
import { readFileSync } from "node:fs";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
// A big push can outrun our 600 s polling budget. The job still finishes on
// Loom's side, so re-read it by id rather than pushing again.
const jobArg = args.find((a) => a.startsWith("--job="));
if (jobArg) {
  const id = jobArg.slice("--job=".length);
  const res = await fetch(`https://loom.livid.no/api/origio/v1/jobs/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}`, Accept: "application/json" },
  });
  const j = await res.json();
  const sum = j.summary ?? {};
  console.log(`job ${id}: status ${j.status}`);
  console.log(`  moved ${sum.variantsMoved ?? 0}, created ${sum.variantsCreated ?? 0}, refused ${sum.variantsMoveRefused ?? 0}`);
  console.log(`  pioReparentPending ${(sum.pioReparentPending ?? []).length}`);
  for (const w of sum.warnings ?? []) console.log(`  warning: ${w}`);
  const errs = sum.itemErrors ?? [];
  console.log(errs.length ? `  itemErrors ${errs.length}: ${JSON.stringify(errs).slice(0, 400)}` : "  itemErrors 0");
  process.exit(0);
}

const parentArg = args.find((a) => a.startsWith("--parent="));
if (!parentArg) {
  console.error("--parent=<colorwaySku> is required.");
  process.exit(1);
}
const PARENT = parentArg.slice("--parent=".length);
const BASE = process.env.ORIGIO_BASE_URL ?? "http://localhost:3000";

// --plan lets another split (the Red Wing care products) reuse this pusher.
const planArg = args.find((a) => a.startsWith("--plan="));
const PLAN = planArg ? planArg.slice("--plan=".length) : "snapshots/vintage-split-plan.json";
const plan = JSON.parse(readFileSync(PLAN, "utf8"));
const rows = plan.plan.filter((p) => p.fromColorwaySku === PARENT);
if (!rows.length) {
  console.error(`No planned rows for parent ${PARENT}.`);
  process.exit(1);
}
const oldColorwayId = rows[0].fromColorwayId;
const newSkus = rows.map((r) => r.newColorwaySku);

const client = new pg.Client({
  connectionString: process.env.ORIGO_DATABASE_URL_UNPOOLED || process.env.ORIGO_DATABASE_URL,
});
await client.connect();

const found = await client.query(
  `SELECT id, "colorwaySku", "styleId" FROM "Colorway" WHERE "colorwaySku" = ANY($1::text[])`,
  [newSkus]
);
// The withdrawal must be the LAST thing in the batch: archiving cascades to
// Pio deletes for any zero-stock SKU still under the parent, so every move has
// to land first. The payload groups by style in first-seen order, so a new
// colourway that stays in the parent's style (Saphir's Spreading brush) would
// pull the parent's style block — withdrawal included — ahead of the styles
// after it. Send those colourways last so the parent's style is the last block.
const parentStyle = await client.query(`SELECT "styleId" FROM "Colorway" WHERE id = $1`, [oldColorwayId]);
const parentStyleId = parentStyle.rows[0]?.styleId;
found.rows.sort((a, b) => (a.styleId === parentStyleId) - (b.styleId === parentStyleId));
const missing = newSkus.filter((s) => !found.rows.some((r) => r.colorwaySku === s));

// Check the move actually happened before telling Loom about it.
const stillOld = await client.query(
  `SELECT count(*)::int n FROM "Variant" WHERE id = ANY($1::text[]) AND "colorwayId" = $2`,
  [rows.map((r) => r.variantId), oldColorwayId]
);
await client.end();

if (missing.length || stillOld.rows[0].n > 0) {
  console.error(
    `Not ready to push: ${missing.length} colourway(s) not created, ` +
      `${stillOld.rows[0].n} variant(s) still under ${PARENT}. Run apply.mjs --apply first.`
  );
  process.exit(1);
}

const body = {
  colorwayIds: [...found.rows.map((r) => r.id), oldColorwayId],
  archiveColorwayIds: [oldColorwayId],
  seasonCode: "CONTINUITY", // Loom calls it Archive
  mode: "data", // stock registry: identity only, no readiness gate
  allowVariantReparent: true,
  // A repeated event_id returns 200 {deduped:true} and applies nothing, so a
  // retry after a half-failure needs a fresh one — date granularity is not enough.
  eventId: `${PLAN.replace(/-plan\.json$/, "").replace(/^.*\//, "")}-${PARENT}-${Date.now()}`,
  dryRun: DRY,
  // Take the job id back immediately and poll it here. The route's built-in wait
  // prints nothing for up to ten minutes and discards the job id if it times
  // out, which makes a slow push indistinguishable from a hung one.
  skipJobWait: !DRY,
};

console.log(`${DRY ? "DRY RUN — " : ""}pushing ${PARENT}:`);
console.log(`  ${found.rowCount} new colourways + 1 withdrawal (${PARENT})`);
console.log(`  eventId ${body.eventId}`);

console.log(`  POSTing to ${BASE}/api/catalog/push/loom …`);
const res = await fetch(`${BASE}/api/catalog/push/loom`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const out = await res.json();
console.log(`\nHTTP ${res.status}  jobId ${out.jobId ?? "(none)"}  sent ${out.sent ?? 0}/${out.requested ?? 0}`);
if (!out.jobId) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}

// Poll the job ourselves so a long run shows progress instead of silence.
const JOB_URL = `https://loom.livid.no/api/origio/v1/jobs/${out.jobId}`;
const H = { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}`, Accept: "application/json" };
const began = Date.now();
let job = null;
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 15_000));
  let j;
  try {
    j = await (await fetch(JOB_URL, { headers: H })).json();
  } catch (e) {
    console.log(`  [${((Date.now() - began) / 1000).toFixed(0)}s] poll failed (${e.message}) — retrying`);
    continue;
  }
  const s2 = j.summary ?? {};
  // Live counters live in `progress`; `summary` stays null until the job ends,
  // so reading it mid-flight shows zeroes and looks like a stalled job.
  const pr = j.progress ?? {};
  console.log(
    `  [${((Date.now() - began) / 1000).toFixed(0)}s] ${j.status}` +
      ` — colourways ${pr.colorwaysDone ?? 0}/${pr.colorwaysTotal ?? "?"},` +
      ` variants ${pr.variantsDone ?? 0}, prices ${pr.pricesDone ?? 0}, errors ${pr.errors ?? 0}`
  );
  if (j.status !== "running" && j.status !== "queued") { job = { ...s2, status: j.status }; break; }
}
if (!job) {
  console.log(`\n  Still running after an hour. Do NOT push again — re-read it with:`);
  console.log(`    node scripts/vintage-split/push.mjs --job=${out.jobId}`);
  process.exit(1);
}

{
  console.log(
    `\nexpect status done, variantsMoved ${rows.length}, variantsCreated 0, pioReparentPending []`
  );
  console.log(
    `got    status ${job.status}, moved ${job.variantsMoved ?? 0}, ` +
      `created ${job.variantsCreated ?? 0}, refused ${job.variantsMoveRefused ?? 0}`
  );
  // pioReparentPending is the warehouse answer: empty means every move reached
  // Pio and the picker sees the real garment name.
  const pending = job.pioReparentPending ?? [];
  console.log(`       pioReparentPending ${pending.length}${pending.length ? `: ${pending.join(", ")}` : " (all reached the warehouse)"}`);
  // Warnings must never be read as failure — Loom moved the Pio lines here on
  // 2026-09-17 precisely because a clean re-parent batch was reading as an error.
  for (const w of job.warnings ?? []) console.log(`       warning: ${w}`);
  const errs = job.itemErrors ?? [];
  if (errs.length) console.log(`       itemErrors ${errs.length} — THIS is the one to act on:`, JSON.stringify(errs).slice(0, 400));
  if (job.unconfirmed || job.status === "running" || job.status === "queued") {
    console.log(`\n  Job did not settle inside our polling budget — it is still running on Loom.`);
    console.log(`  Do NOT push again. Re-read it with:`);
    console.log(`    node scripts/vintage-split/push.mjs --job=${out.jobId}`);
  }
}
