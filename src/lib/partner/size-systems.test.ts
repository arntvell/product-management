// Run: ORIGO_POSTGRES_PRISMA_URL=postgresql://nobody@127.0.0.1:1/none npx tsx --test src/lib/partner/size-systems.test.ts
// (lib/db.ts insists on a URL at import; this one is never reached.)
// No database: the only one there is, is production. The calls run against an
// in-memory store.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getSizeSystems,
  parseOps,
  patchSizeSystem,
  planSizeSystemOps,
  type SizeSystemsStore,
  type SystemEntry,
  type SystemRow,
} from "./size-systems";
import { sizeKey } from "./colorway-sizes";

const entry = (l: string, i: number, archived = false): SystemEntry => ({
  id: `e${i}`,
  sizeLabel: l,
  dim1: l,
  dim2: null,
  skuToken: l.toUpperCase(),
  archived,
});

/** UK Shoes as Origio holds it: whole sizes, then the half sizes appended. */
function ukShoes(): SystemRow {
  const labels = ["7", "8", "9", "10", "11", "7.5", "8.5", "9.5", "10.5"];
  return { id: "uk", name: "UK Shoes", kind: "ONE_D", archived: false, brands: ["Paraboot"], entries: labels.map((l, i) => entry(l, i)) };
}

function fakeStore(systems: SystemRow[], opts: { inUse?: string[]; changedUnderUs?: boolean } = {}) {
  const saves: SystemEntry[][] = [];
  const store: SizeSystemsStore = {
    async system(id) {
      const s = systems.find((x) => x.id === id);
      return s ? structuredClone(s) : null;
    },
    async labelsInUse(_system, labels) {
      const used = new Set((opts.inUse ?? []).map(sizeKey));
      return new Set(labels.map(sizeKey).filter((k) => used.has(k)));
    },
    async colorway(sku) {
      return sku === "EXT-PRB-CMB-NR" ? { id: "cw1", colorwaySku: sku, sizes: ["8", "7", "7.5"] } : null;
    },
    async candidates() {
      return [{ id: "uk", reason: "Paraboot's default size system" }];
    },
    async brand(ref) {
      if (ref === "Paraboot" || ref === "b-pb") return { name: "Paraboot", defaultSizeSystemId: "uk" };
      if (ref === "Keen") return { name: "Keen", defaultSizeSystemId: null };
      return { error: `Origio has no brand "${ref}"` };
    },
    async save(id, entries) {
      if (opts.changedUnderUs) return false;
      saves.push(entries);
      const s = systems.find((x) => x.id === id)!;
      s.entries = entries.map((e, i) => ({ ...e, id: e.id ?? `new${i}` }));
      return true;
    },
  };
  return { store, saves };
}

// --- GET ---

test("GET by colourway: its candidate systems, sizes with in_use, display order, and its own sizes", async () => {
  const { store } = fakeStore([ukShoes()], { inUse: ["7", "7.5", "8"] });
  const r = await getSizeSystems({ colorway_sku: "EXT-PRB-CMB-NR" }, store);
  assert.equal(r.error, undefined);
  assert.equal(r.systems.length, 1);
  const s = r.systems[0];
  assert.deepEqual([s.id, s.name, s.kind, s.reason, s.brands], ["uk", "UK Shoes", "ONE_D", "Paraboot's default size system", ["Paraboot"]]);
  assert.deepEqual(s.sizes[5], { label: "7.5", token: "7.5", dim1: "7.5", dim2: null, position: 5, archived: false, in_use: true });
  assert.equal(s.sizes.find((x) => x.label === "11")!.in_use, false);
  assert.deepEqual(s.display_order, ["7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11"]);
  assert.deepEqual(r.colorway, { colorway_sku: "EXT-PRB-CMB-NR", sizes: ["7", "7.5", "8"] });
});

test("GET by brand: its default system", async () => {
  const { store } = fakeStore([ukShoes()]);
  const r = await getSizeSystems({ brand: "Paraboot" }, store);
  assert.equal(r.systems[0].reason, "Paraboot's default size system");
  assert.equal(r.colorway, undefined);
});

test("GET: unknown colourway or brand is systems: [] with an error, not a throw", async () => {
  const { store } = fakeStore([ukShoes()]);
  assert.deepEqual(await getSizeSystems({ colorway_sku: "EXT-NOPE" }, store), { systems: [], error: "Origio has no colourway EXT-NOPE" });
  assert.deepEqual(await getSizeSystems({ brand: "Nobody" }, store), { systems: [], error: 'Origio has no brand "Nobody"' });
  assert.deepEqual(await getSizeSystems({ brand: "Keen" }, store), { systems: [], error: "Keen has no default size system in Origio" });
});

test("GET with neither parameter is a 400", async () => {
  const { store } = fakeStore([]);
  await assert.rejects(getSizeSystems({}, store), /send colorway_sku or brand/);
});

// --- PATCH: add ---

test("dry run add: the system as it would be, nothing saved", async () => {
  const { store, saves } = fakeStore([ukShoes()]);
  const r = await patchSizeSystem("uk", { dry_run: true, ops: [{ op: "add", label: "12", after: "11" }] }, store);
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.applied, ["add 12 after 11"]);
  assert.equal(saves.length, 0);
  const s = r.system!;
  assert.deepEqual(s.sizes.map((x) => x.label), ["7", "8", "9", "10", "11", "12", "7.5", "8.5", "9.5", "10.5"]);
  assert.deepEqual(s.sizes[5], { label: "12", token: "12", dim1: "12", dim2: null, position: 5, archived: false, in_use: false });
  assert.equal(s.display_order.at(-1), "12");
});

test("anything but dry_run: false is a dry run", async () => {
  const { store, saves } = fakeStore([ukShoes()]);
  await patchSizeSystem("uk", { ops: [{ op: "add", label: "12" }] }, store);
  await patchSizeSystem("uk", { dry_run: "false", ops: [{ op: "add", label: "12" }] }, store);
  assert.equal(saves.length, 0);
});

test("real add saves the full list, existing ids kept, new one appended", async () => {
  const sys = ukShoes();
  const { store, saves } = fakeStore([sys]);
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }] }, store);
  assert.equal(r.ok, true);
  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].map((e) => e.id), ["e0", "e1", "e2", "e3", "e4", "e5", "e6", "e7", "e8", null]);
  assert.equal(r.system!.sizes.at(-1)!.label, "12");
});

test("idempotent: adding a size the system has is a no-op, and nothing is saved", async () => {
  const { store, saves } = fakeStore([ukShoes()]);
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "7,5" }] }, store);
  assert.equal(r.ok, true);
  assert.deepEqual(r.applied, []);
  assert.deepEqual(r.noop, ["add 7,5: UK Shoes already has 7.5"]);
  assert.equal(saves.length, 0);
  // A repeat of a real add likewise.
  await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }] }, store);
  const again = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }] }, store);
  assert.deepEqual(again.applied, []);
  assert.equal(saves.length, 1);
});

test("add refusals: retired size, different dims, token clash, unknown after, 2-D without dims", () => {
  const sys = ukShoes();
  sys.entries.push(entry("6", 99, true));
  const plan = (ops: unknown[]) => planSizeSystemOps(sys, parseOps(ops));
  assert.match((plan([{ op: "add", label: "6" }]) as { error: string }).error, /6 was retired from UK Shoes; un-retiring it is done in Origio/);
  assert.match((plan([{ op: "add", label: "8", dim1: "41" }]) as { error: string }).error, /already has 8 as 8/);
  assert.match((plan([{ op: "add", label: "Eight", dim1: "8" }]) as { error: string }).error, /SKU token 8, which 8 already has/);
  assert.match((plan([{ op: "add", label: "12", after: "13" }]) as { error: string }).error, /after: 13 is not a size in UK Shoes/);
  const wl: SystemRow = { id: "wl", name: "W/L", kind: "TWO_D", archived: false, brands: [], entries: [] };
  assert.match((planSizeSystemOps(wl, parseOps([{ op: "add", label: "W33/L32" }])) as { error: string }).error, /needs dim1 \(waist\) and dim2 \(length\)/);
  const ok = planSizeSystemOps(wl, parseOps([{ op: "add", label: "W33/L32", dim1: "33", dim2: "32" }]));
  assert.ok(ok.ok && ok.entries[0].skuToken === "3332");
});

// --- PATCH: reorder ---

test("reorder: every live size once; retired sizes keep their slots", async () => {
  const sys = ukShoes();
  sys.entries.splice(2, 0, entry("6", 99, true));
  const natural = ["7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11"];
  const { store, saves } = fakeStore([sys]);
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "reorder", labels: natural }] }, store);
  assert.equal(r.ok, true);
  assert.deepEqual(r.applied, ["reorder"]);
  assert.deepEqual(saves[0].map((e) => e.sizeLabel), ["7", "7.5", "6", "8", "8.5", "9", "9.5", "10", "10.5", "11"]);
  assert.equal(saves[0][2].archived, true);
  const again = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "reorder", labels: natural }] }, store);
  assert.deepEqual(again.noop, ["reorder: already in that order"]);
  assert.equal(saves.length, 1);
});

test("reorder refusals name what is missing, unknown or doubled", () => {
  const r = planSizeSystemOps(ukShoes(), parseOps([{ op: "reorder", labels: ["7", "7", "8", "99"] }]));
  assert.equal(r.ok, false);
  const e = (r as { error: string }).error;
  assert.match(e, /^reorder must list every size in UK Shoes exactly once; missing 9, 10, 11, 7.5, 8.5, 9.5, 10.5; not in it: 99; listed twice: 7$/);
});

test("ops are all or nothing: a bad op after a good one saves nothing", async () => {
  const { store, saves } = fakeStore([ukShoes()]);
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }, { op: "add", label: "13", after: "99" }] }, store);
  assert.equal(r.ok, false);
  assert.deepEqual(r.applied, []);
  assert.equal(saves.length, 0);
});

test("add then reorder in one call places the new size", () => {
  const p = planSizeSystemOps(
    ukShoes(),
    parseOps([{ op: "add", label: "6.5" }, { op: "reorder", labels: ["6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11"] }])
  );
  assert.ok(p.ok);
  assert.deepEqual(p.applied, ["add 6.5", "reorder"]);
  assert.equal(p.entries[0].sizeLabel, "6.5");
});

// --- PATCH: refusals and malformed ---

test("refused ops come back as ok:false for a buyer, not a 400", async () => {
  const { store, saves } = fakeStore([ukShoes()]);
  for (const op of ["rename", "retire", "set_token", "set_kind", "create", "archive", "unretire", "edit"]) {
    const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op }] }, store);
    assert.equal(r.ok, false, op);
    assert.match(r.error!, /is done in Origio, not from Loom/);
  }
  assert.equal(saves.length, 0);
});

test("shared system needs confirm_shared; the error says it is shared", async () => {
  const sys = { ...ukShoes(), brands: ["Converse", "Eyyts"] };
  const { store, saves } = fakeStore([sys]);
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }] }, store);
  assert.equal(r.ok, false);
  assert.match(r.error!, /UK Shoes is shared: it is the default size system of Converse, Eyyts/);
  assert.equal(saves.length, 0);
  const ok = await patchSizeSystem("uk", { dry_run: false, confirm_shared: true, ops: [{ op: "add", label: "12" }] }, store);
  assert.equal(ok.ok, true);
  assert.match(ok.warnings.join(" "), /also the default size system of Converse, Eyyts/);
});

test("one-size and archived systems, and unknown ids, are refused", async () => {
  const os: SystemRow = { id: "os", name: "One size", kind: "ONE_SIZE", archived: false, brands: [], entries: [entry("One size", 0)] };
  const old: SystemRow = { ...ukShoes(), id: "old", archived: true };
  const { store } = fakeStore([os, old]);
  assert.match((await patchSizeSystem("os", { ops: [{ op: "add", label: "M" }] }, store)).error!, /one-size system/);
  assert.match((await patchSizeSystem("old", { ops: [{ op: "add", label: "12" }] }, store)).error!, /archived in Origio/);
  assert.equal((await patchSizeSystem("zzz", { ops: [{ op: "add", label: "12" }] }, store)).error, "Origio has no size system zzz");
});

test("a system changed in Origio meanwhile is not overwritten", async () => {
  const { store } = fakeStore([ukShoes()], { changedUnderUs: true });
  const r = await patchSizeSystem("uk", { dry_run: false, ops: [{ op: "add", label: "12" }] }, store);
  assert.equal(r.ok, false);
  assert.match(r.error!, /was changed in Origio while this ran; nothing was saved/);
});

test("malformed bodies are 400s", async () => {
  const { store } = fakeStore([ukShoes()]);
  await assert.rejects(patchSizeSystem("uk", { ops: [] }, store), /ops must be a non-empty array/);
  await assert.rejects(patchSizeSystem("uk", {}, store), /ops must be a non-empty array/);
  await assert.rejects(patchSizeSystem("uk", { ops: [{ op: "add" }] }, store), /add needs a label/);
  await assert.rejects(patchSizeSystem("uk", { ops: [{ op: "reorder", labels: "7,8" }] }, store), /reorder needs labels/);
  await assert.rejects(patchSizeSystem("uk", { ops: [{ op: "frobnicate" }] }, store), /unknown op "frobnicate"/);
});
