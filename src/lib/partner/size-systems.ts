// Size systems for Loom's Buying planner: read them, and make two narrow edits.
//
//   GET   size-systems?colorway_sku=… | ?brand=…   (size-systems:read)
//   PATCH size-systems/{id}  ops: add | reorder    (size-systems:write)
//
// A size system is GLOBAL: brands point at one only as their default
// (BrandTemplate.defaultSizeSystemId), styles and colourways not at all, and a
// variant holds its size as plain strings with no foreign key. So an edit here
// reaches every brand defaulting to the system and every colourway inferred into
// it — which is why the edits Loom may make are the two that cannot hurt a
// variant that already exists:
//
//   add       a new size, at a position. Its token is derived the way
//             size-systems.ts derives one (sizeSkuToken), never sent.
//   reorder   the live sizes in a new order. Position only orders the wizard's
//             and the importer's lists; the storefront and the till sort by
//             label (size-order.ts), so nothing customer-facing moves.
//
// Refused, and left to Origio: renaming or retiring a size (variants keep the
// old string, so coverage, the importer and colorway-sizes stop matching),
// token or dimension edits (future SKUs change and the sibling-stem rule
// breaks), kind changes, creating or archiving systems, one-size systems,
// un-retiring a size, and — without confirm_shared — any edit to a system more
// than one brand defaults to.
//
// Every edit goes through updateSizeSystem, the code /catalog/size-systems uses,
// so its rules hold: entries are reconciled by id, never deleted, labels unique.
// The ops are all or nothing. They are idempotent by content: adding a size the
// system has, or reordering into the current order, is a no-op.
import { prisma } from "@/lib/db";
import { normalizeSku, sizeSkuToken } from "@/lib/master/sku";
import { displaySizes } from "@/lib/master/size-order";
import { updateSizeSystem } from "@/lib/master/size-systems";
import { candidateSystems, sizeKey } from "./colorway-sizes";
import { matchBrand, type BrandRow } from "./brand-rules";
import { PartnerRequestError } from "./external-products";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface SystemEntry {
  id: string | null; // null = added by this call, not saved yet
  sizeLabel: string;
  dim1: string;
  dim2: string | null;
  skuToken: string;
  archived: boolean;
}

export interface SystemRow {
  id: string;
  name: string;
  kind: "ONE_D" | "TWO_D" | "ONE_SIZE";
  archived: boolean;
  /** Brands whose default this system is. */
  brands: string[];
  /** In position order. */
  entries: SystemEntry[];
}

export interface SystemView {
  id: string;
  name: string;
  kind: string;
  reason: string | null;
  brands: string[];
  sizes: Array<{
    label: string;
    token: string;
    dim1: string;
    dim2: string | null;
    position: number;
    archived: boolean;
    in_use: boolean;
  }>;
  /** Live labels in the order the storefront shows them. */
  display_order: string[];
}

export type SizeSystemOp =
  | { op: "add"; label: string; dim1?: string | null; dim2?: string | null; after?: string | null }
  | { op: "reorder"; labels: string[] };

export interface PatchResult {
  ok: boolean;
  system?: SystemView;
  applied: string[];
  noop: string[];
  warnings: string[];
  error?: string;
}

/** What a refused op is called, so it reads as a decision rather than a typo. */
const REFUSED_OPS: Record<string, string> = {
  rename: "renaming a size",
  relabel: "renaming a size",
  retire: "retiring a size",
  remove: "retiring a size",
  delete: "retiring a size",
  archive: "archiving",
  unretire: "un-retiring a size",
  restore: "un-retiring a size",
  set_token: "changing a size's SKU token",
  token: "changing a size's SKU token",
  edit: "editing a size's dimensions or token",
  update: "editing a size's dimensions or token",
  set_kind: "changing a size system's kind",
  kind: "changing a size system's kind",
  create: "creating a size system",
  create_system: "creating a size system",
  archive_system: "archiving a size system",
  rename_system: "renaming a size system",
};

// ---------------------------------------------------------------------------
// Parsing — malformed bodies are 400s, never a buyer-facing refusal
// ---------------------------------------------------------------------------

/** The ops as sent, checked for shape only. Throws PartnerRequestError (400). */
export function parseOps(raw: unknown): Array<SizeSystemOp | { op: "refused"; name: string; what: string }> {
  if (!Array.isArray(raw) || !raw.length) throw new PartnerRequestError("ops must be a non-empty array");
  return raw.map((o, i) => {
    const op = typeof o?.op === "string" ? o.op.trim().toLowerCase() : "";
    if (op === "add") {
      if (typeof o.label !== "string" || !o.label.trim()) throw new PartnerRequestError(`ops[${i}]: add needs a label`);
      for (const f of ["dim1", "dim2", "after"] as const)
        if (o[f] != null && typeof o[f] !== "string") throw new PartnerRequestError(`ops[${i}]: ${f} must be a string`);
      return { op: "add", label: o.label.trim(), dim1: o.dim1 ?? null, dim2: o.dim2 ?? null, after: o.after ?? null };
    }
    if (op === "reorder") {
      if (!Array.isArray(o.labels) || !o.labels.every((l: unknown) => typeof l === "string"))
        throw new PartnerRequestError(`ops[${i}]: reorder needs labels, a list of strings`);
      return { op: "reorder", labels: o.labels.map((l: string) => l.trim()) };
    }
    if (REFUSED_OPS[op]) return { op: "refused", name: op, what: REFUSED_OPS[op] };
    throw new PartnerRequestError(`ops[${i}]: unknown op "${o?.op ?? ""}"; Origio takes add and reorder`);
  });
}

// ---------------------------------------------------------------------------
// The planner — no database
// ---------------------------------------------------------------------------

export type OpsPlan =
  | { ok: false; error: string }
  | { ok: true; entries: SystemEntry[]; applied: string[]; noop: string[]; warnings: string[]; changed: boolean };

export function planSizeSystemOps(
  system: SystemRow,
  ops: ReturnType<typeof parseOps>,
  opts: { confirmShared?: boolean } = {}
): OpsPlan {
  const refused = ops.find((o) => o.op === "refused") as { name: string; what: string } | undefined;
  if (refused)
    return { ok: false, error: `${refused.what} is done in Origio, not from Loom (op "${refused.name}")` };
  if (system.archived) return { ok: false, error: `${system.name} is archived in Origio` };
  if (system.kind === "ONE_SIZE") return { ok: false, error: `${system.name} is a one-size system; it holds exactly one size` };
  if (system.brands.length > 1 && !opts.confirmShared)
    return {
      ok: false,
      error:
        `${system.name} is shared: it is the default size system of ${system.brands.join(", ")}, ` +
        "so this change reaches all of them. Send confirm_shared to make it anyway",
    };

  const entries = system.entries.map((e) => ({ ...e }));
  const applied: string[] = [];
  const noop: string[] = [];
  const warnings: string[] = [];
  const live = () => entries.filter((e) => !e.archived);
  const find = (label: string) => entries.find((e) => sizeKey(e.sizeLabel) === sizeKey(label));

  for (const op of ops as SizeSystemOp[]) {
    if (op.op === "add") {
      const label = op.label;
      const twoD = system.kind === "TWO_D";
      const dim1 = op.dim1?.trim() || (twoD ? "" : label);
      const dim2 = twoD ? op.dim2?.trim() || "" : null;
      if (twoD && (!dim1 || !dim2))
        return { ok: false, error: `${system.name} is sized waist × length; ${label} needs dim1 (waist) and dim2 (length)` };
      if (!twoD && op.dim2?.trim()) return { ok: false, error: `${system.name} has one dimension; ${label} cannot have a dim2` };

      const have = find(label);
      if (have?.archived)
        return { ok: false, error: `${have.sizeLabel} was retired from ${system.name}; un-retiring it is done in Origio` };
      if (have) {
        // Dims are compared only when sent: otherwise they are the label's own,
        // and "7,5" against a stored 7.5 is the same size.
        const sent = !!(op.dim1?.trim() || op.dim2?.trim());
        if (sent && (have.dim1 !== dim1 || (have.dim2 ?? null) !== dim2))
          return {
            ok: false,
            error: `${system.name} already has ${have.sizeLabel} as ${have.dim2 ? `${have.dim1} × ${have.dim2}` : have.dim1}; editing a size is done in Origio`,
          };
        noop.push(`add ${label}: ${system.name} already has ${have.sizeLabel}`);
        continue;
      }
      const token = sizeSkuToken({ dim1, dim2 }).toUpperCase();
      const clash = live().find((e) => e.skuToken.toUpperCase() === token);
      if (clash)
        return { ok: false, error: `${label} would take the SKU token ${token}, which ${clash.sizeLabel} already has in ${system.name}` };

      let at = entries.length;
      if (op.after?.trim()) {
        const anchor = find(op.after);
        if (!anchor || anchor.archived)
          return { ok: false, error: `after: ${op.after} is not a size in ${system.name}` };
        at = entries.indexOf(anchor) + 1;
      }
      entries.splice(at, 0, { id: null, sizeLabel: label, dim1, dim2, skuToken: token, archived: false });
      applied.push(op.after?.trim() ? `add ${label} after ${op.after.trim()}` : `add ${label}`);
      continue;
    }

    // reorder: every live size exactly once.
    const current = live();
    const seen = new Set<string>();
    const dupes: string[] = [];
    const unknown: string[] = [];
    for (const l of op.labels) {
      const k = sizeKey(l);
      if (seen.has(k)) dupes.push(l);
      seen.add(k);
      const e = find(l);
      if (!e || e.archived) unknown.push(l);
    }
    const missing = current.filter((e) => !seen.has(sizeKey(e.sizeLabel))).map((e) => e.sizeLabel);
    if (dupes.length || unknown.length || missing.length)
      return {
        ok: false,
        error:
          `reorder must list every size in ${system.name} exactly once` +
          (missing.length ? `; missing ${missing.join(", ")}` : "") +
          (unknown.length ? `; not in it: ${unknown.join(", ")}` : "") +
          (dupes.length ? `; listed twice: ${dupes.join(", ")}` : ""),
      };
    const wanted = op.labels.map((l) => find(l)!);
    if (wanted.every((e, i) => e === current[i])) {
      noop.push("reorder: already in that order");
      continue;
    }
    // Live sizes take the live slots in the new order; retired ones keep theirs.
    let next = 0;
    for (let i = 0; i < entries.length; i++) if (!entries[i].archived) entries[i] = wanted[next++];
    applied.push("reorder");
  }

  if (system.brands.length > 1 && applied.length)
    warnings.push(`${system.name} is also the default size system of ${system.brands.join(", ")}`);
  return { ok: true, entries, applied, noop, warnings, changed: applied.length > 0 };
}

/** The system as the partner API shows it. */
export function systemView(
  system: SystemRow,
  inUse: Set<string>,
  reason: string | null,
  entries: SystemEntry[] = system.entries
): SystemView {
  const live = entries.filter((e) => !e.archived);
  return {
    id: system.id,
    name: system.name,
    kind: system.kind,
    reason,
    brands: system.brands,
    sizes: entries.map((e, i) => ({
      label: e.sizeLabel,
      token: e.skuToken,
      dim1: e.dim1,
      dim2: e.dim2,
      position: i,
      archived: e.archived,
      in_use: inUse.has(sizeKey(e.sizeLabel)),
    })),
    display_order: displaySizes(live, (e) => e.sizeLabel).map((e) => e.sizeLabel),
  };
}

// ---------------------------------------------------------------------------
// The calls
// ---------------------------------------------------------------------------

export interface SizeSystemsStore {
  system(id: string): Promise<SystemRow | null>;
  /**
   * sizeKey of the asked labels that a variant holds. Variants have no link to a
   * size system, so "in use" is read through the brands that default to the
   * system; a system no brand defaults to is checked across the catalogue.
   */
  labelsInUse(system: SystemRow, labels: string[]): Promise<Set<string>>;
  colorway(sku: string): Promise<{ id: string; colorwaySku: string; sizes: string[] } | null>;
  candidates(colorwayId: string): Promise<Array<{ id: string; reason: string }>>;
  brand(ref: string): Promise<{ name: string; defaultSizeSystemId: string | null } | { error: string }>;
  /**
   * Save the full ordered entry list (updateSizeSystem). False, and nothing
   * written, when the system's entries are no longer the ones planned on:
   * updateSizeSystem archives every entry the list leaves out, so a size added
   * in Origio meanwhile would be retired by a stale list.
   */
  save(systemId: string, entries: SystemEntry[]): Promise<boolean>;
}

export interface GetResult {
  systems: SystemView[];
  colorway?: { colorway_sku: string; sizes: string[] };
  error?: string;
}

export async function getSizeSystems(
  q: { colorway_sku?: string | null; brand?: string | null },
  store: SizeSystemsStore = prismaSizeSystemsStore
): Promise<GetResult> {
  const sku = q.colorway_sku?.trim();
  const brandRef = q.brand?.trim();
  if (!sku && !brandRef) throw new PartnerRequestError("send colorway_sku or brand");

  let picks: Array<{ id: string; reason: string }>;
  let colorway: GetResult["colorway"];
  if (sku) {
    const cw = await store.colorway(sku);
    if (!cw) return { systems: [], error: `Origio has no colourway ${sku}` };
    colorway = { colorway_sku: cw.colorwaySku, sizes: displaySizes(cw.sizes, (l) => l) };
    picks = await store.candidates(cw.id);
    if (!picks.length)
      return { systems: [], colorway, error: `no Origio size system fits ${cw.colorwaySku}` };
  } else {
    const b = await store.brand(brandRef!);
    if ("error" in b) return { systems: [], error: b.error };
    if (!b.defaultSizeSystemId) return { systems: [], error: `${b.name} has no default size system in Origio` };
    picks = [{ id: b.defaultSizeSystemId, reason: `${b.name}'s default size system` }];
  }

  const rows = (await Promise.all(picks.map((p) => store.system(p.id)))).filter((r): r is SystemRow => !!r);
  const inUse = await Promise.all(rows.map((r) => store.labelsInUse(r, r.entries.map((e) => e.sizeLabel))));
  return {
    systems: rows.map((r, i) => systemView(r, inUse[i], picks.find((p) => p.id === r.id)!.reason)),
    ...(colorway ? { colorway } : {}),
  };
}

export async function patchSizeSystem(
  systemId: string,
  body: { dry_run?: unknown; confirm_shared?: unknown; ops?: unknown },
  store: SizeSystemsStore = prismaSizeSystemsStore
): Promise<PatchResult & { dryRun: boolean }> {
  const dryRun = body.dry_run !== false;
  const ops = parseOps(body.ops);
  const refuse = (error: string) => ({ ok: false, dryRun, applied: [], noop: [], warnings: [], error });

  const system = await store.system(systemId);
  if (!system) return refuse(`Origio has no size system ${systemId}`);
  const plan = planSizeSystemOps(system, ops, { confirmShared: body.confirm_shared === true });
  if (!plan.ok) return refuse(plan.error);

  const labels = plan.entries.map((e) => e.sizeLabel);
  if (dryRun || !plan.changed) {
    const inUse = await store.labelsInUse(system, labels);
    return {
      ok: true,
      dryRun,
      system: systemView(system, inUse, null, plan.entries),
      applied: plan.applied,
      noop: plan.noop,
      warnings: plan.warnings,
    };
  }

  if (!(await store.save(system.id, plan.entries)))
    return refuse(`${system.name} was changed in Origio while this ran; nothing was saved, send it again`);
  const after = (await store.system(system.id))!;
  const inUse = await store.labelsInUse(after, after.entries.map((e) => e.sizeLabel));
  return { ok: true, dryRun, system: systemView(after, inUse, null), applied: plan.applied, noop: plan.noop, warnings: plan.warnings };
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

export const prismaSizeSystemsStore: SizeSystemsStore = {
  async system(id) {
    const r = await prisma.sizeSystem.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kind: true,
        archived: true,
        entries: {
          orderBy: { position: "asc" },
          select: { id: true, sizeLabel: true, dim1: true, dim2: true, skuToken: true, archived: true },
        },
        templates: { select: { brand: { select: { name: true } } } },
      },
    });
    if (!r) return null;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      archived: r.archived,
      brands: r.templates.map((t) => t.brand.name).sort(),
      entries: r.entries,
    };
  },

  async labelsInUse(system, labels) {
    if (!labels.length) return new Set();
    // Exact spellings plus the case variants a label is commonly stored in;
    // variant labels are plain strings with no link to the system.
    const spellings = [...new Set(labels.flatMap((l) => [l, l.toUpperCase(), l.toLowerCase(), l.replace(/\./g, ",")]))];
    const rows = await prisma.variant.findMany({
      where: {
        sizeLabel: { in: spellings },
        ...(system.brands.length ? { colorway: { brand: { template: { defaultSizeSystemId: system.id } } } } : {}),
      },
      distinct: ["sizeLabel"],
      select: { sizeLabel: true },
    });
    return new Set(rows.map((r) => sizeKey(r.sizeLabel)));
  },

  async colorway(asked) {
    const select = { id: true, colorwaySku: true, variants: { select: { sizeLabel: true } } } as const;
    const r =
      (await prisma.colorway.findUnique({ where: { colorwaySku: asked }, select })) ??
      (await prisma.colorway.findUnique({ where: { colorwaySku: normalizeSku(asked) }, select }));
    return r ? { id: r.id, colorwaySku: r.colorwaySku, sizes: r.variants.map((v) => v.sizeLabel) } : null;
  },

  async candidates(colorwayId) {
    return candidateSystems(colorwayId);
  },

  async brand(ref) {
    const select = { id: true, name: true, mergedIntoId: true, template: { select: { defaultSizeSystemId: true } } } as const;
    let row = await prisma.brand.findUnique({ where: { id: ref }, select });
    if (!row) {
      const all: BrandRow[] = await prisma.brand.findMany({
        select: { id: true, name: true, isLivid: true, skuToken: true, loomBrandId: true, archived: true, mergedIntoId: true },
      });
      const m = matchBrand({ name: ref }, all);
      if (m.kind === "refuse") return { error: m.error };
      if (m.kind === "none") return { error: `Origio has no brand "${ref}"` };
      row = await prisma.brand.findUnique({ where: { id: m.brand.id }, select });
    } else if (row.mergedIntoId) {
      row = await prisma.brand.findUnique({ where: { id: row.mergedIntoId }, select });
    }
    if (!row) return { error: `Origio has no brand "${ref}"` };
    return { name: row.name, defaultSizeSystemId: row.template?.defaultSizeSystemId ?? null };
  },

  async save(systemId, entries) {
    const now = await prisma.sizeSystemEntry.findMany({ where: { sizeSystemId: systemId }, select: { id: true } });
    const planned = new Set(entries.flatMap((e) => (e.id ? [e.id] : [])));
    if (now.length !== planned.size || now.some((e) => !planned.has(e.id))) return false;
    await updateSizeSystem(systemId, {
      entries: entries.map((e) => ({
        ...(e.id ? { id: e.id } : {}),
        sizeLabel: e.sizeLabel,
        dim1: e.dim1,
        dim2: e.dim2,
        skuToken: e.skuToken,
        archived: e.archived,
      })),
    });
    return true;
  },
};
