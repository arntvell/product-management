// Correcting variant barcodes from the editor, and carrying the correction out
// to every channel the garment is already live in.
//
// Nothing here is a new write path. Each step is an existing plan/apply pair —
// apply-barcodes.ts for the master, push-barcodes.ts for Shopify, sitoo/push.ts
// for Sitoo, and the Loom registry push — and this module only decides the scope
// for each and runs them in order. The guards those modules carry (check digit,
// one code per garment, rotations, store labels, wrong-product ids) all still
// apply; the editor just makes them visible per row.
//
// Order matters. The master is written first, so the channels read the value
// they are being brought into line with. Loom is last and is driven by the
// client through /api/catalog/push/loom: a Loom job may take longer than one
// request is allowed to run, and its registry falls back to barcode where it has
// no inventory-id link, so it should re-read after Shopify and Sitoo agree.
//
// "Already live" is decided by link rows, not by intent. A variant with no
// Shopify or Sitoo link, or a colourway never pushed to Loom, has nothing to
// correct there — its next publish will carry the corrected value — and the
// report says so per row rather than folding it into a count.

import { prisma } from "@/lib/db";
import {
  applyBarcodeCorrections,
  planBarcodeCorrections,
  type BarcodeApplyPlan,
  type BarcodeCorrection,
} from "./apply-barcodes";
import { canonical } from "./barcode";
import { fetchShopifyVariants, type ShopifyVariantRow } from "@/lib/shopify/link";
import {
  planShopifyBarcodePush,
  pushBarcodesToShopify,
  type ShopifyBarcodePlan,
} from "@/lib/shopify/push-barcodes";
import { getProduct, listProducts, type SitooProduct } from "@/lib/sitoo/client";
import { planSitooPush, pushBarcodesToSitoo, type SitooPushPlan } from "@/lib/sitoo/push";
import { pushColorwaysToLoom } from "@/lib/loom/push";

/** Recorded on FieldOwner for every barcode the editor writes. */
export const EDITOR_AUTHORITY = "manual:variant-editor";

/**
 * Always Sitoo production. `.env.local` carries SITOO_TARGET=sandbox, and the
 * sandbox's product ids are unrelated to ours, so inheriting it would refuse
 * every row as wrongProduct and report "nothing to do".
 */
const SITOO_TARGET = "production" as const;

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

export interface VariantEditorRow {
  id: string;
  variantSku: string;
  sizeLabel: string;
  barcode: string | null;
  colorwayId: string;
  colorwaySku: string;
  name: string;
  status: string;
  seasons: string[];
  /** Linked to a Shopify variant — a correction will be written there. */
  shopify: boolean;
  /** Linked to a Sitoo product. */
  sitoo: boolean;
  /** The colourway has been pushed to Loom. */
  loom: boolean;
  /** The barcode was set by hand, so a Threadflow sync will leave it alone. */
  barcodeManual: boolean;
}

export interface ListVariantsOptions {
  q?: string;
  season?: string;
  /** Exact SKUs — how pasted corrections pull their rows onto the page. */
  skus?: string[];
  limit?: number;
}

export async function listVariantsForEditor(
  opts: ListVariantsOptions = {}
): Promise<{ rows: VariantEditorRow[]; truncated: boolean }> {
  const limit = opts.limit ?? 500;
  const q = opts.q?.trim();
  if (!q && !opts.skus?.length && !opts.season) return { rows: [], truncated: false };

  const variants = await prisma.variant.findMany({
    where: {
      ...(opts.skus?.length ? { variantSku: { in: opts.skus } } : {}),
      ...(q
        ? {
            OR: [
              { variantSku: { contains: q, mode: "insensitive" } },
              { barcode: { contains: q } },
              { colorway: { colorwaySku: { contains: q, mode: "insensitive" } } },
              { colorway: { name: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
      ...(opts.season
        ? { colorway: { entries: { some: { season: { code: opts.season } } } } }
        : {}),
    },
    orderBy: [{ colorway: { colorwaySku: "asc" } }, { variantSku: "asc" }],
    take: limit + 1,
    select: {
      id: true,
      variantSku: true,
      sizeLabel: true,
      barcode: true,
      channelRefs: { select: { channel: true } },
      colorway: {
        select: {
          id: true,
          colorwaySku: true,
          name: true,
          status: true,
          entries: { select: { season: { select: { code: true } } } },
          publications: {
            where: { channel: "LOOM" },
            select: { published: true, lastPushedAt: true },
          },
        },
      },
    },
  });

  const truncated = variants.length > limit;
  const page = variants.slice(0, limit);
  const manual = await manualBarcodeIds(page.map((v) => v.id));

  return {
    truncated,
    rows: page.map((v) => ({
      id: v.id,
      variantSku: v.variantSku,
      sizeLabel: v.sizeLabel,
      barcode: v.barcode,
      colorwayId: v.colorway.id,
      colorwaySku: v.colorway.colorwaySku,
      name: v.colorway.name,
      status: v.colorway.status,
      seasons: v.colorway.entries.map((e) => e.season.code),
      shopify: v.channelRefs.some((r) => r.channel === "SHOPIFY"),
      sitoo: v.channelRefs.some((r) => r.channel === "SITOO"),
      loom: v.colorway.publications.some((p) => p.published && p.lastPushedAt),
      barcodeManual: manual.has(v.id),
    })),
  };
}

async function manualBarcodeIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await prisma.fieldOwner.findMany({
    where: { entityType: "variant", field: "barcode", owner: "MANUAL", entityId: { in: ids } },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId));
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface VariantBarcodeEdit {
  variantSku: string;
  barcode: string;
}

export type MasterOutcome = "fill" | "change" | "unchanged" | "rejected" | "collision" | "unknown";

export interface ChannelOutcome {
  state:
    | "write" // will be / was written
    | "written"
    | "failed"
    | "agrees" // the channel already holds the target
    | "not-live" // no link, or never pushed — nothing to correct there
    | "refused" // a guard stopped it; see note
    | "n/a"; // the master did not accept the edit
  from?: string | null;
  note?: string;
}

export interface RowPlan {
  variantId: string | null;
  variantSku: string;
  colorwayId: string | null;
  from: string | null;
  to: string | null;
  master: MasterOutcome;
  note?: string;
  shopify: ChannelOutcome;
  sitoo: ChannelOutcome;
  loom: ChannelOutcome;
}

export interface LoomGroup {
  seasonCode: string;
  colorwayIds: string[];
}

export interface VariantBarcodeReport {
  dryRun: boolean;
  rows: RowPlan[];
  /** The Loom pushes still to run, one per season, mode "data". */
  loomGroups: LoomGroup[];
  /** A channel that could not be read or written at all, e.g. credentials. */
  channelErrors: { shopify?: string; sitoo?: string; loom?: string };
  master: { applied: number; ledgerRecorded: number };
  unwound: string[];
}

interface Scoped {
  id: string;
  variantSku: string;
  barcode: string | null;
  colorwayId: string;
  colorwayStatus: string;
  hasShopify: boolean;
  hasSitoo: boolean;
  sitooIds: number[];
  shopifyProductGid: string | null;
}

async function loadScoped(skus: string[]): Promise<Map<string, Scoped>> {
  const rows = await prisma.variant.findMany({
    where: { variantSku: { in: skus } },
    select: {
      id: true,
      variantSku: true,
      barcode: true,
      channelRefs: { select: { channel: true, externalId: true } },
      colorway: {
        select: {
          id: true,
          status: true,
          publications: { where: { channel: "SHOPIFY" }, select: { externalId: true } },
        },
      },
    },
  });
  return new Map(
    rows.map((v) => [
      v.variantSku,
      {
        id: v.id,
        variantSku: v.variantSku,
        barcode: v.barcode,
        colorwayId: v.colorway.id,
        colorwayStatus: v.colorway.status,
        hasShopify: v.channelRefs.some((r) => r.channel === "SHOPIFY"),
        hasSitoo: v.channelRefs.some((r) => r.channel === "SITOO"),
        sitooIds: v.channelRefs
          .filter((r) => r.channel === "SITOO")
          .map((r) => Number(r.externalId))
          .filter((n) => Number.isFinite(n)),
        shopifyProductGid: v.colorway.publications[0]?.externalId ?? null,
      },
    ])
  );
}

/**
 * Shopify's live state for just these products, plus any product already
 * holding one of the target codes — which is all the duplicate guard in
 * planShopifyBarcodePush needs. Reading the whole store would take minutes.
 */
async function fetchShopifyRowsFor(scoped: Scoped[], targets: string[]): Promise<ShopifyVariantRow[]> {
  const terms = new Set<string>();
  for (const s of scoped) {
    if (!s.hasShopify) continue;
    const numeric = s.shopifyProductGid?.split("/").pop();
    terms.add(numeric ? `id:${numeric}` : `sku:${JSON.stringify(s.variantSku)}`);
  }
  if (!terms.size) return [];
  for (const t of targets) terms.add(`barcode:${t}`);

  const list = [...terms];
  const byGid = new Map<string, ShopifyVariantRow>();
  const CHUNK = 25;
  for (let i = 0; i < list.length; i += CHUNK) {
    const rows = await fetchShopifyVariants(list.slice(i, i + CHUNK).join(" OR "));
    for (const r of rows) byGid.set(r.variantGid, r);
  }
  return [...byGid.values()];
}

/** Sitoo's live state for just the linked products. */
async function fetchSitooProductsFor(scoped: Scoped[]): Promise<SitooProduct[]> {
  const ids = [...new Set(scoped.flatMap((s) => s.sitooIds))];
  if (!ids.length) return [];
  // Past a few hundred, one paged read of the whole site is cheaper.
  if (ids.length > 300) return listProducts(SITOO_TARGET);
  const out: SitooProduct[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const got = await Promise.all(ids.slice(i, i + CONCURRENCY).map(getSitooProduct));
    for (const p of got) if (p) out.push(p);
  }
  return out;
}

/**
 * One product, or null when Sitoo says it does not exist — the planner then
 * reports the link as wrongProduct. Anything else is retried and then thrown:
 * swallowing it would report a live product as a stale link, which is what a
 * first version of this did.
 */
async function getSitooProduct(id: number): Promise<SitooProduct | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getProduct(id, SITOO_TARGET);
    } catch (e) {
      const msg = (e as Error).message;
      if (/→ 404\b/.test(msg)) return null;
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
}

/**
 * Colourways live in Loom, grouped by the seasons they are entered in. Loom's
 * push loads a colourway per season, so the wrong season reports it
 * "not in season" and the push still says ok. Pushing under every season it is
 * entered in is what the membership push did on 2026-09-18.
 *
 * Archived colourways are left out: the registry push sends loom:true unless
 * told to archive, so re-sending one would un-archive it in Loom.
 */
async function loomScope(colorwayIds: string[]): Promise<{
  groups: LoomGroup[];
  live: Set<string>;
  archived: Set<string>;
}> {
  const cws = await prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    select: {
      id: true,
      status: true,
      publications: { where: { channel: "LOOM" }, select: { published: true, lastPushedAt: true } },
      entries: { select: { season: { select: { code: true, sortOrder: true } } } },
    },
  });
  const live = new Set<string>();
  const archived = new Set<string>();
  const bySeason = new Map<string, { sortOrder: number; ids: string[] }>();
  for (const c of cws) {
    if (!c.publications.some((p) => p.published && p.lastPushedAt)) continue;
    if (c.status === "ARCHIVED") {
      archived.add(c.id);
      continue;
    }
    live.add(c.id);
    for (const e of c.entries) {
      const g = bySeason.get(e.season.code) ?? { sortOrder: e.season.sortOrder, ids: [] };
      g.ids.push(c.id);
      bySeason.set(e.season.code, g);
    }
  }
  const groups = [...bySeason.entries()]
    .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[0].localeCompare(b[0]))
    .map(([seasonCode, g]) => ({ seasonCode, colorwayIds: g.ids }));
  return { groups, live, archived };
}

function masterOutcomes(
  edits: VariantBarcodeEdit[],
  plan: BarcodeApplyPlan
): Map<string, { outcome: MasterOutcome; to: string | null; note?: string }> {
  const out = new Map<string, { outcome: MasterOutcome; to: string | null; note?: string }>();
  for (const f of plan.fill) out.set(f.variantSku, { outcome: "fill", to: f.to });
  for (const c of plan.change) out.set(c.variantSku, { outcome: "change", to: c.to });
  for (const r of plan.rejected) {
    out.set(r.variantSku, {
      outcome: "rejected",
      to: null,
      note: r.barcode.trim() ? `${r.barcode} ${r.reason}` : "a barcode cannot be cleared, only replaced",
    });
  }
  for (const c of plan.collisions) {
    out.set(c.variantSku, {
      outcome: "collision",
      to: null,
      note: `${c.barcode} already belongs to ${c.heldBy}`,
    });
  }
  for (const sku of plan.unknownSku) {
    out.set(sku, { outcome: "unknown", to: null, note: "no variant with this SKU" });
  }
  for (const e of edits) {
    if (!out.has(e.variantSku)) {
      out.set(e.variantSku, { outcome: "unchanged", to: canonical(e.barcode) });
    }
  }
  return out;
}

function shopifyOutcomes(plan: ShopifyBarcodePlan) {
  const m = new Map<string, ChannelOutcome>();
  for (const w of plan.writes) m.set(w.variantSku, { state: "write", from: w.from });
  for (const b of plan.blocked) {
    m.set(b.variantSku, { state: "refused", note: `${b.barcode} is on ${b.heldBy} in Shopify` });
  }
  for (const sku of plan.locked) m.set(sku, { state: "refused", note: "barcode is locked (disputed)" });
  for (const sku of plan.missingProductLink) {
    m.set(sku, { state: "refused", note: "variant linked but its Shopify product is unknown" });
  }
  return m;
}

function sitooOutcomes(plan: SitooPushPlan) {
  const m = new Map<string, ChannelOutcome>();
  for (const w of plan.writes) m.set(w.variantSku, { state: "write", from: w.from });
  for (const s of plan.storeLabel) {
    m.set(s.variantSku, {
      state: "refused",
      from: s.keeping,
      note: `keeping ${s.keeping} — a store-printed label that scans; change it in Sitoo if it is wrong`,
    });
  }
  for (const l of plan.locked) m.set(l.variantSku, { state: "refused", note: "barcode is locked (disputed)" });
  for (const w of plan.wrongProduct) {
    m.set(w.variantSku, {
      state: "refused",
      note: `Sitoo product ${w.productId} is ${w.theirSku ?? "missing"} — link is stale`,
    });
  }
  return m;
}

const ACCEPTED: MasterOutcome[] = ["fill", "change", "unchanged"];

/**
 * Preview everything an apply would do, without writing anywhere.
 *
 * The channel plans are computed against the barcode the master is ABOUT to
 * hold, so a row reads "Shopify: 7072… → 7072…" before anything has changed.
 */
export async function planVariantBarcodeEdits(
  edits: VariantBarcodeEdit[]
): Promise<VariantBarcodeReport> {
  return run(edits, { dryRun: true });
}

/**
 * Write the master, then Shopify and Sitoo. Returns the Loom groups for the
 * caller to push — see the note at the top of the file.
 */
export async function applyVariantBarcodeEdits(
  edits: VariantBarcodeEdit[],
  opts: { evidence?: string | null } = {}
): Promise<VariantBarcodeReport> {
  return run(edits, { dryRun: false, evidence: opts.evidence ?? null });
}

async function run(
  edits: VariantBarcodeEdit[],
  opts: { dryRun: boolean; evidence?: string | null }
): Promise<VariantBarcodeReport> {
  // One edit per SKU; the last one typed wins.
  const bySku = new Map<string, VariantBarcodeEdit>();
  for (const e of edits) {
    const sku = e.variantSku.trim();
    if (sku) bySku.set(sku, { variantSku: sku, barcode: String(e.barcode ?? "") });
  }
  const unique = [...bySku.values()];
  const corrections: BarcodeCorrection[] = unique.map((e) => ({
    variantSku: e.variantSku,
    barcode: e.barcode,
  }));

  const report: VariantBarcodeReport = {
    dryRun: opts.dryRun,
    rows: [],
    loomGroups: [],
    channelErrors: {},
    master: { applied: 0, ledgerRecorded: 0 },
    unwound: [],
  };

  // 1. Master. The editor exists to change codes that are already set, so
  //    overwrite is always on; attribution is what makes that defensible.
  let masterPlan: BarcodeApplyPlan;
  if (opts.dryRun) {
    masterPlan = await planBarcodeCorrections(corrections, { overwrite: true });
  } else {
    const res = await applyBarcodeCorrections(corrections, {
      authority: EDITOR_AUTHORITY,
      evidence: opts.evidence,
      owner: "MANUAL",
      overwrite: true,
    });
    masterPlan = res;
    report.master = { applied: res.applied, ledgerRecorded: res.ledgerRecorded };
  }
  report.unwound = masterPlan.unwind.map((u) => u.variantSku);
  const master = masterOutcomes(unique, masterPlan);

  const scoped = await loadScoped(unique.map((e) => e.variantSku));
  const accepted = [...master.entries()]
    .filter(([sku, m]) => ACCEPTED.includes(m.outcome) && scoped.has(sku))
    .map(([sku, m]) => ({ s: scoped.get(sku)!, to: m.to }));
  // After an apply the master already holds these; for a preview they are the
  // values it is about to hold.
  const targets = opts.dryRun
    ? new Map(accepted.filter((a) => a.to).map((a) => [a.s.id, a.to!]))
    : undefined;
  const targetCodes = [...new Set(accepted.map((a) => a.to).filter((t): t is string => !!t))];

  // 2. Shopify and Sitoo, independently: one channel being down must not stop
  //    the other.
  let shopify = new Map<string, ChannelOutcome>();
  let shopifyAgrees = new Set<string>();
  let sitoo = new Map<string, ChannelOutcome>();
  let sitooAgrees = new Set<string>();

  const shopifyScope = accepted.filter((a) => a.s.hasShopify);
  if (shopifyScope.length) {
    try {
      const rows = await fetchShopifyRowsFor(shopifyScope.map((a) => a.s), targetCodes);
      const ids = shopifyScope.map((a) => a.s.id);
      const base = { variantIds: ids, rows, targets };
      if (opts.dryRun) {
        const plan = await planShopifyBarcodePush(base);
        shopify = shopifyOutcomes(plan);
      } else {
        const res = await pushBarcodesToShopify(base);
        shopify = shopifyOutcomes(res);
        const failedProducts = new Map(res.failures.map((f) => [f.productGid, f.error]));
        for (const w of res.writes) {
          const err = failedProducts.get(w.productGid);
          shopify.set(
            w.variantSku,
            err ? { state: "failed", from: w.from, note: err } : { state: "written", from: w.from }
          );
        }
      }
      shopifyAgrees = new Set(
        shopifyScope.map((a) => a.s.variantSku).filter((sku) => !shopify.has(sku))
      );
    } catch (e) {
      report.channelErrors.shopify = (e as Error).message;
    }
  }

  const sitooScope = accepted.filter((a) => a.s.hasSitoo);
  if (sitooScope.length) {
    try {
      const products = await fetchSitooProductsFor(sitooScope.map((a) => a.s));
      const base = {
        variantIds: sitooScope.map((a) => a.s.id),
        target: SITOO_TARGET,
        products,
        targets,
      };
      if (opts.dryRun) {
        sitoo = sitooOutcomes(await planSitooPush(base));
      } else {
        const res = await pushBarcodesToSitoo(base);
        sitoo = sitooOutcomes(res);
        const failed = new Map(res.failures.map((f) => [f.variantSku, f.error]));
        for (const w of res.writes) {
          const err = failed.get(w.variantSku);
          sitoo.set(
            w.variantSku,
            err ? { state: "failed", from: w.from, note: err } : { state: "written", from: w.from }
          );
        }
        // An unwind failure stops the run before any write; say so on every row.
        if (!res.applied && res.failures.some((f) => f.error.startsWith("unwind failed"))) {
          for (const w of res.writes) {
            if (!failed.has(w.variantSku)) {
              sitoo.set(w.variantSku, { state: "failed", from: w.from, note: "not attempted — an unwind failed" });
            }
          }
        }
      }
      sitooAgrees = new Set(sitooScope.map((a) => a.s.variantSku).filter((sku) => !sitoo.has(sku)));
    } catch (e) {
      report.channelErrors.sitoo = (e as Error).message;
    }
  }

  // 3. Loom. Planned here, pushed by the caller.
  const colorwayIds = [...new Set(accepted.map((a) => a.s.colorwayId))];
  const loom = await loomScope(colorwayIds);
  report.loomGroups = loom.groups;
  const loomSkipped = new Map<string, string>();
  if (opts.dryRun && loom.groups.length) {
    // Dry-run each group so "not in season" shows before anything is sent.
    try {
      for (const g of loom.groups) {
        const res = await pushColorwaysToLoom(g.colorwayIds, g.seasonCode, { dryRun: true, mode: "data" });
        for (const s of res.skipped) loomSkipped.set(s.colorwayId, `${g.seasonCode}: ${s.reason}`);
      }
    } catch (e) {
      report.channelErrors.loom = (e as Error).message;
    }
  }

  // 4. One row per edit.
  for (const e of unique) {
    const m = master.get(e.variantSku)!;
    const s = scoped.get(e.variantSku);
    const ok = ACCEPTED.includes(m.outcome) && !!s;
    const na: ChannelOutcome = { state: "n/a" };

    const channel = (
      has: boolean | undefined,
      plan: Map<string, ChannelOutcome>,
      agrees: Set<string>,
      error: string | undefined,
      what: string
    ): ChannelOutcome => {
      if (!ok) return na;
      if (!has) return { state: "not-live", note: `not linked to ${what}` };
      if (error) return { state: "failed", note: error };
      return plan.get(e.variantSku) ?? (agrees.has(e.variantSku) ? { state: "agrees" } : na);
    };

    let loomOutcome: ChannelOutcome = na;
    if (ok) {
      if (loom.archived.has(s!.colorwayId)) {
        loomOutcome = { state: "refused", note: "colourway is archived — re-pushing would un-archive it in Loom" };
      } else if (!loom.live.has(s!.colorwayId)) {
        loomOutcome = { state: "not-live", note: "never pushed to Loom" };
      } else if (loomSkipped.has(s!.colorwayId)) {
        loomOutcome = { state: "refused", note: loomSkipped.get(s!.colorwayId) };
      } else if (report.channelErrors.loom) {
        loomOutcome = { state: "failed", note: report.channelErrors.loom };
      } else {
        loomOutcome = { state: "write", note: "re-sent with its colourway" };
      }
    }

    report.rows.push({
      variantId: s?.id ?? null,
      variantSku: e.variantSku,
      colorwayId: s?.colorwayId ?? null,
      from: s ? (opts.dryRun ? canonical(s.barcode) : null) : null,
      to: m.to,
      master: m.outcome,
      note: m.note,
      shopify: channel(s?.hasShopify, shopify, shopifyAgrees, report.channelErrors.shopify, "Shopify"),
      sitoo: channel(s?.hasSitoo, sitoo, sitooAgrees, report.channelErrors.sitoo, "Sitoo"),
      loom: loomOutcome,
    });
  }

  // After an apply `from` is the pre-apply master value, which the master plan
  // carries for changes; fills had none.
  if (!opts.dryRun) {
    const prior = new Map(masterPlan.change.map((c) => [c.variantSku, c.from]));
    for (const r of report.rows) r.from = prior.get(r.variantSku) ?? (r.master === "unchanged" ? r.to : null);
  }

  // Loom groups only for colourways that are not skipped.
  report.loomGroups = loom.groups
    .map((g) => ({ ...g, colorwayIds: g.colorwayIds.filter((id) => !loomSkipped.has(id)) }))
    .filter((g) => g.colorwayIds.length);
  return report;
}
