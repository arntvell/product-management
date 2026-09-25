// Push a re-grouped imperfect family to Loom: the colourways under their new
// "<Family>*" style, with their size-free names.
//
// All 60 colourways are already published and all sit in CONTINUITY (Loom's
// Archive), so nothing is created — Loom re-parents each colourway to the new
// style and renames it. Colourway ids are unchanged, which is what makes that a
// move rather than a delete and recreate.
//
// The Keri family also folds one duplicate colourway into another: that is a
// variant moving between colourways, so it needs allow_variant_reparent, and the
// emptied colourway is withdrawn in the SAME push.
//
// Usage: node scripts/imperfect-regroup/push.mjs --family=Barnes [--dry-run]
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const H = { Authorization: `Bearer ${process.env.LOOM_LOCAL_TOKEN}`, Accept: "application/json" };

const jobArg = args.find((a) => a.startsWith("--job="));
if (jobArg) {
  const id = jobArg.slice("--job=".length);
  const j = await (await fetch(`https://loom.livid.no/api/origio/v1/jobs/${id}`, { headers: H })).json();
  const s = j.summary ?? {};
  console.log(`job ${id}: ${j.status} — updated ${s.updated ?? 0}, moved ${s.variantsMoved ?? 0}, created ${s.variantsCreated ?? 0}`);
  for (const w of s.warnings ?? []) console.log(`  warning: ${w}`);
  const e = s.itemErrors ?? [];
  console.log(e.length ? `  itemErrors ${e.length}: ${JSON.stringify(e).slice(0, 500)}` : "  itemErrors 0");
  process.exit(0);
}

const famArg = args.find((a) => a.startsWith("--family="));
if (!famArg) { console.error("--family=<Family> is required."); process.exit(1); }
const FAMILY = famArg.slice("--family=".length);

const plan = JSON.parse(readFileSync("snapshots/imperfect-regroup-plan.json", "utf8"));
const fam = plan.families.find((f) => f.family === FAMILY);
if (!fam) { console.error(`No planned family ${FAMILY}.`); process.exit(1); }

const ids = fam.colorways.map((c) => c.colorwayId);
const merges = plan.merges.filter((m) => ids.includes(m.intoColorwayId));
const archiveIds = merges.map((m) => m.mergeColorwayId);

const BASE = process.env.ORIGIO_BASE_URL ?? "http://localhost:3000";
const body = {
  colorwayIds: [...ids, ...archiveIds],
  archiveColorwayIds: archiveIds,
  seasonCode: "CONTINUITY",
  mode: "data",
  allowVariantReparent: true,
  eventId: `imperfect-regroup-${FAMILY}-${Date.now()}`,
  dryRun: DRY,
  skipJobWait: !DRY,
};

console.log(`${DRY ? "DRY RUN — " : ""}pushing ${fam.newStyleName}:`);
console.log(`  ${ids.length} colourways${archiveIds.length ? ` + ${archiveIds.length} withdrawal` : ""}`);
console.log(`  POSTing to ${BASE}/api/catalog/push/loom …`);

const res = await fetch(`${BASE}/api/catalog/push/loom`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const out = await res.json();
console.log(`\nHTTP ${res.status}  jobId ${out.jobId ?? "(none)"}  sent ${out.sent ?? 0}/${out.requested ?? 0}`);
if (!out.jobId) { console.log(JSON.stringify(out.preview ?? out, null, 2).slice(0, 1200)); process.exit(out.ok ? 0 : 1); }

const began = Date.now();
let job = null;
for (let i = 0; i < 160; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  let j;
  try { j = await (await fetch(`https://loom.livid.no/api/origio/v1/jobs/${out.jobId}`, { headers: H })).json(); }
  catch (e) { console.log(`  poll failed (${e.message}) — retrying`); continue; }
  const pr = j.progress ?? {};
  console.log(`  [${((Date.now() - began) / 1000).toFixed(0)}s] ${j.status} — colourways ${pr.colorwaysDone ?? 0}/${pr.colorwaysTotal ?? "?"}, errors ${pr.errors ?? 0}`);
  if (j.status !== "running" && j.status !== "queued") { job = { ...(j.summary ?? {}), status: j.status }; break; }
}
if (!job) {
  console.log(`\n  Still running. Do NOT push again — re-read with:\n    node scripts/imperfect-regroup/push.mjs --job=${out.jobId}`);
  process.exit(1);
}

console.log(`\ngot status ${job.status} — updated ${job.updated ?? 0}, created ${job.created ?? 0},` +
  ` variantsMoved ${job.variantsMoved ?? 0}, variantsCreated ${job.variantsCreated ?? 0}, refused ${job.variantsMoveRefused ?? 0}`);
for (const w of job.warnings ?? []) console.log(`  warning: ${w}`);
const errs = job.itemErrors ?? [];
console.log(errs.length ? `  itemErrors ${errs.length} — act on these: ${JSON.stringify(errs).slice(0, 500)}` : "  itemErrors 0");
