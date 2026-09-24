// Push the vintage cleanup to Loom's stock registry (season CONTINUITY = Loom's
// "Archive"): the renamed and recategorised colourways as updates, and the
// archived ones as withdrawals, in one job.
//
// Withdrawals go LAST: archiving cascades to Pio deletes for zero-stock SKUs,
// and the payload keeps style blocks in first-seen order
// (scripts/vintage-split/push.mjs). A SKU that still holds stock comes back as
// kept_has_stock rather than being deleted.
//
// Needs `npm run dev` running (ORIGIO_BASE_URL, default http://localhost:3000),
// and must run AFTER apply-origio.mjs --apply — the payload is built from the
// master, so it sends whatever the master says.
//
//   node scripts/vintage-cleanup/push-loom.mjs --dry-run
//   node scripts/vintage-cleanup/push-loom.mjs
//   node scripts/vintage-cleanup/push-loom.mjs --ids=<file.json>   re-send only these colourways (no withdrawals)
//   node scripts/vintage-cleanup/push-loom.mjs --job=<id>     re-read a job
import { readFileSync, writeFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const DRY = process.argv.includes("--dry-run");
const BASE = process.env.ORIGIO_BASE_URL ?? "http://localhost:3000";
const TOKEN = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
const JOBS = "https://loom.livid.no/api/origio/v1/jobs/";

async function readJob(id) {
  const res = await fetch(JOBS + encodeURIComponent(id), {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
  });
  return res.json();
}
function report(j) {
  const sum = j.summary ?? {};
  console.log(`job status ${j.status}`);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(sum).filter(([, v]) => typeof v === "number"))));
  for (const w of sum.warnings ?? []) console.log(`  warning: ${w}`);
  const errs = sum.itemErrors ?? [];
  console.log(errs.length ? `  itemErrors ${errs.length}:\n${errs.map((e) => "    " + JSON.stringify(e)).join("\n")}` : "  itemErrors 0");
}

const jobArg = process.argv.find((a) => a.startsWith("--job="));
if (jobArg) {
  report(await readJob(jobArg.slice(6)));
  process.exit(0);
}

const plan = JSON.parse(readFileSync("snapshots/vintage-cleanup-plan.json", "utf8"));
const changed = plan.plan.filter(
  (p) => p.changes.name || p.changes.styleName || p.changes.category || p.action === "archive"
);
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const only = idsArg ? new Set(JSON.parse(readFileSync(idsArg.slice(6), "utf8"))) : null;
const archived = only ? [] : changed.filter((p) => p.action === "archive");
const updates = only
  ? plan.plan.filter((p) => only.has(p.colorwayId) && p.action !== "archive")
  : changed.filter((p) => p.action !== "archive");

const body = {
  colorwayIds: [...updates, ...archived].map((p) => p.colorwayId),
  archiveColorwayIds: archived.map((p) => p.colorwayId),
  seasonCode: "CONTINUITY",
  mode: "data",
  // A repeated event_id is deduped by Loom and applies nothing — make it unique.
  eventId: `vintage-cleanup-2026-09-24-${Date.now()}`,
  dryRun: DRY,
  skipJobWait: !DRY,
};
console.log(`${DRY ? "DRY RUN — " : ""}${updates.length} updates + ${archived.length} withdrawals, eventId ${body.eventId}`);

const res = await fetch(`${BASE}/api/catalog/push/loom`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.APP_PASSWORD}` },
  body: JSON.stringify(body),
});
const out = await res.json();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(`snapshots/vintage-cleanup-loom-${DRY ? "dryrun" : "push"}-${stamp}.json`, JSON.stringify(out, null, 2));
console.log(`HTTP ${res.status} ok=${out.ok} sent ${out.sent ?? 0}/${out.requested ?? 0} styles ${out.styles ?? 0} jobId ${out.jobId ?? "(none)"}`);
for (const s of out.skipped ?? []) console.log(`  skipped ${s.colorwayId}: ${s.reason}`);
if (out.error) console.log(`  error: ${out.error}`);
if (DRY || !out.jobId) process.exit(out.ok ? 0 : 1);

// Poll the job ourselves; the route's own wait is silent and drops the id on timeout.
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const j = await readJob(out.jobId).catch(() => null);
  if (!j) continue;
  // Loom reports queued → running → a terminal status (push.ts treats anything else as settled).
  if (!["queued", "running"].includes(String(j.status))) {
    report(j);
    writeFileSync(`snapshots/vintage-cleanup-loom-job-${out.jobId}.json`, JSON.stringify(j, null, 2));
    process.exit(0);
  }
  if (i % 3 === 0) console.log(`  [${(i + 1) * 10}s] ${j.status}`);
}
console.log(`Still running — re-read with --job=${out.jobId}`);
