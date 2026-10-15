// Apply a plan from scripts/nested-split/plan.mjs — the only step that writes.
//
//   npx dotenv -e .env.local -- npx tsx scripts/nested-split/apply.ts --plan=snapshots/…json --parent=EXT-BP
//   …same, with --apply                       to actually send it
//
// Dry by default. Without `--apply` nothing leaves the process.
//
// Goes through `pushColorwaysToLoom` rather than hand-rolling the upsert,
// because that function carries the things this operation must not lose: it
// builds the payload with the readiness and eligibility gates, waits for Loom's
// job to settle instead of trusting the 202, refuses to record anything as
// published when the job errored or is still running, and — the one that
// matters here — refuses to record success when `variantsMoveRefused > 0`,
// since a refused move skips the whole colourway in Loom's preflight and the
// products are simply not there.
//
// `allowVariantReparent` switches off Loom's guard against relocating a variant,
// and the variant row is where stock, weighted average cost and every order, PO
// and receipt line live. That is the whole point here — the variants are under
// the wrong parent and must move, with their history — but it is also why this
// re-verifies the plan against Loom immediately before sending, and aborts on
// any drift.

import { config } from "dotenv";
config({ path: ".env.local" });

interface PlanMove {
  variantSku: string;
  variantId: string;
  loomSizeLabel: string;
  onHand: number;
  from: { colorwayId: string; colorwaySku: string };
  to: { colorwayId: string; colorwaySku: string; name: string };
}
interface Plan {
  parentSku: string;
  parentName: string;
  loomColorwayId: string;
  pioProductRef: string | null;
  totals: { move: number; stay: number; refuse: number; onHandMoving: number };
  push: { colorwayIds: string[]; seasons: string[] };
  moves: PlanMove[];
  stays: { variantSku: string }[];
  refusals: { variantSku: string; reason: string }[];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const planPath = args.find((a) => a.startsWith("--plan="))?.slice("--plan=".length);
  const parentSku = args.find((a) => a.startsWith("--parent="))?.slice("--parent=".length) ?? "EXT-BP";
  if (!planPath) {
    console.error("Pass --plan=<the json written by plan.mjs>");
    process.exit(2);
  }

  const { readFileSync } = await import("node:fs");
  const file = JSON.parse(readFileSync(planPath, "utf8")) as { generatedAt: string; plans: Plan[] };
  const plan = file.plans.find((p) => p.parentSku === parentSku);
  if (!plan) {
    console.error(`No plan for ${parentSku} in ${planPath}`);
    process.exit(2);
  }
  if (plan.refusals.length) {
    console.error(`${parentSku}: the plan has ${plan.refusals.length} refusal(s). Resolve them before applying.`);
    for (const r of plan.refusals) console.error(`  ${r.variantSku}: ${r.reason}`);
    process.exit(1);
  }
  if (!plan.moves.length) {
    console.log(`${parentSku}: nothing to move. Already correct.`);
    process.exit(0);
  }
  if (plan.push.seasons.length !== 1) {
    console.error(`${parentSku}: expected exactly one season, the plan has ${JSON.stringify(plan.push.seasons)}.`);
    process.exit(1);
  }

  // --- re-verify against Loom, now ------------------------------------------
  //
  // The plan may have been written hours ago. Loom is the system being changed, so
  // it is the one that has to agree immediately before the write.
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  const res = await fetch(
    `https://loom.livid.no/api/origio/v1/products?sku=${encodeURIComponent(parentSku)}`,
    { headers: { authorization: `Bearer ${token}`, accept: "application/json" } }
  );
  if (!res.ok) {
    console.error(`Loom answered HTTP ${res.status} when re-reading ${parentSku}.`);
    process.exit(1);
  }
  const live = (await res.json()).rows?.find((r: { colorway_sku: string }) => r.colorway_sku === parentSku);
  if (!live) {
    console.error(`${parentSku}: Loom no longer holds this colourway. Re-plan.`);
    process.exit(1);
  }
  if (live.colorway_id !== plan.loomColorwayId) {
    console.error(`${parentSku}: Loom's colourway id has changed since the plan. Re-plan.`);
    process.exit(1);
  }
  const liveSkus = new Set((live.variants ?? []).map((v: { variant_sku: string }) => v.variant_sku));
  const missing = plan.moves.filter((m) => !liveSkus.has(m.variantSku));
  const extra = [...liveSkus].filter(
    (s) => !plan.moves.some((m) => m.variantSku === s) && !plan.stays.some((v) => v.variantSku === s)
  );
  if (missing.length || extra.length) {
    console.error(`${parentSku}: Loom no longer matches the plan. Re-plan before applying.`);
    for (const m of missing) console.error(`  planned to move ${m.variantSku}, Loom no longer nests it`);
    for (const s of extra) console.error(`  Loom nests ${s}, which the plan does not know`);
    process.exit(1);
  }

  const season = plan.push.seasons[0];
  console.log(`${parentSku}  "${plan.parentName}"  Pio ${plan.pioProductRef ?? "—"}`);
  console.log(`  plan written ${file.generatedAt}`);
  console.log(`  re-read from Loom just now: ${liveSkus.size} variant(s) nested — matches the plan`);
  console.log(`  moving ${plan.moves.length} variant(s) carrying ${plan.totals.onHandMoving} unit(s)`);
  console.log(`  into ${plan.push.colorwayIds.length} colourway(s), season ${season}`);
  console.log(`  parent left holding ${plan.stays.length}`);

  if (!apply) {
    console.log(`\n  DRY RUN — nothing sent. Add --apply to send it.`);
    process.exit(0);
  }

  const { pushColorwaysToLoom } = await import("../../src/lib/loom/push.ts");

  // A fresh delivery id per attempt. The content-derived default would make Loom
  // dedupe a retry into a previous failed job and hand back its stale result.
  const suffix = `nested-split-${parentSku.toLowerCase()}-${Date.now().toString(36)}`;
  console.log(`\n  sending… (event suffix ${suffix})`);

  const result = await pushColorwaysToLoom(plan.push.colorwayIds, season, {
    mode: "data",
    allowVariantReparent: true,
    eventIdSuffix: suffix,
  });

  console.log(`\n  ok: ${result.ok}  status: ${result.status}  sent: ${result.sent}  jobId: ${result.jobId ?? "—"}`);
  if (result.skipped?.length) {
    console.log(`  skipped ${result.skipped.length}:`);
    for (const s of result.skipped) console.log(`    ${s.colorwayId}: ${s.reason}`);
  }
  if (result.job) {
    const j = result.job;
    console.log(`  job ${j.status}`);
    console.log(
      `    variantsCreated=${j.variantsCreated ?? 0}  variantsUpdated=${j.variantsUpdated ?? 0}  ` +
        `variantsMoved=${j.variantsMoved ?? 0}  variantsMoveRefused=${j.variantsMoveRefused ?? 0}`
    );
    console.log(`    created=${j.created ?? 0}  updated=${j.updated ?? 0}`);
    if (j.pioReparentPending?.length) {
      console.log(`    pioReparentPending: ${j.pioReparentPending.length} — Pio has NOT caught up yet`);
    }
    if (j.itemErrors?.length) {
      console.log(`    itemErrors: ${JSON.stringify(j.itemErrors).slice(0, 600)}`);
    }
    if (j.fatalError) console.log(`    fatalError: ${j.fatalError}`);
    if ((j.variantsMoveRefused ?? 0) > 0) {
      console.log(`\n  ! Loom REFUSED ${j.variantsMoveRefused} move(s). A refused move skips the whole`);
      console.log(`    colourway in preflight, so those products are not in Loom. Nothing is marked published.`);
    }
  }
  if (!result.ok) {
    console.log(`\n  The push did not succeed. Nothing was recorded as published.`);
    process.exit(1);
  }
  console.log(`\n  Done. Re-read Loom to confirm, then retire the empty parent.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
