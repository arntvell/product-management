// Sitoo half of the vintage cleanup: new categories, then renames, category
// moves and deactivations on the existing products.
//
// DRY RUN BY DEFAULT. --apply writes to Sitoo PRODUCTION.
//
//   node scripts/vintage-cleanup/sitoo.mjs categories [--apply]
//   node scripts/vintage-cleanup/sitoo.mjs products   [--apply]
//
// Run `categories` before apply-origio.mjs, so the new Origio Category rows can
// carry their Sitoo ids, and `products` after it.
//
// The three writes used here — POST /categories, PUT /products/{id} with
// {title, defaultcategoryid, categories}, and PUT {active, activepos} — were
// proved on the sandbox by sitoo-sandbox-check.mjs: each patches only the fields
// it sends. "Archive" in Sitoo means active=false + activepos=false: the product
// leaves the web shop and the till, drops out of default listings, and keeps its
// history. Nothing is deleted.
//
// Every product's full before-state is written to snapshots/ before any write,
// so each change can be reverted from the file.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

const phase = process.argv[2];
const APPLY = process.argv.includes("--apply");
const PLAN = "snapshots/vintage-cleanup-plan.json";
const CATS = "snapshots/vintage-cleanup-sitoo-categories.json";
if (!["categories", "products"].includes(phase)) {
  console.error("Usage: sitoo.mjs categories|products [--apply]");
  process.exit(1);
}
const plan = JSON.parse(readFileSync(PLAN, "utf8"));

const base = process.env.SITOO_BASE_URL.replace(/\/+$/, "");
const auth =
  "Basic " + Buffer.from(`${process.env.SITOO_API_ID}:${process.env.SITOO_API_KEY}`).toString("base64");
async function call(method, path, body) {
  const res = await fetch(`${base}/sites/1${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
async function all(path) {
  const out = [];
  for (let start = 0; ; start += 1000) {
    const page = await call("GET", `${path}${path.includes("?") ? "&" : "?"}start=${start}&num=1000`);
    out.push(...(page.items ?? []));
    if ((page.items ?? []).length < 1000) break;
  }
  return out;
}

// Where each new category sits in Sitoo's tree, following the existing layout:
// shirts under Tops (25), footwear under Shoes (27), store buckets top-level
// beside MARKET and POPUP.
const PARENT = {
  "Shirt Long Sleeve": 25,
  "Shirt Short Sleeve": 25,
  Footwear: 27,
  Selected: null,
  Mix: null,
};
// Membership in these is a merchandising tag, not a product type — keep it.
const KEEP_EXTRA = new Set([83]); // POPUP

const stamp = new Date().toISOString().replace(/[:.]/g, "-");

if (phase === "categories") {
  const existing = await all("/categories");
  const byTitle = new Map(existing.map((c) => [c.title.toLowerCase(), c]));
  const result = {};
  for (const c of plan.newCategories) {
    const hit = byTitle.get(c.name.toLowerCase());
    if (hit) {
      result[c.name] = hit.categoryid;
      console.log(`exists   ${c.name} → ${hit.categoryid}`);
      continue;
    }
    if (!(c.name in PARENT)) throw new Error(`No Sitoo parent decided for "${c.name}"`);
    if (!APPLY) {
      console.log(`would create ${c.name} (parent ${PARENT[c.name] ?? "none"})`);
      continue;
    }
    const body = { title: c.name, visible: true };
    if (PARENT[c.name] != null) body.categoryparentid = PARENT[c.name];
    const id = await call("POST", "/categories", body);
    const got = await call("GET", `/categories/${id}`);
    if (got.title !== c.name) throw new Error(`Created ${id} reads back as "${got.title}"`);
    result[c.name] = id;
    console.log(`created  ${c.name} → ${id} (parent ${got.categoryparentid ?? "none"})`);
  }
  if (APPLY) writeFileSync(CATS, JSON.stringify(result, null, 2));
  process.exit(0);
}

// ---- products --------------------------------------------------------------
if (!existsSync(CATS)) throw new Error(`Run "categories --apply" first (${CATS} missing)`);
const newCatIds = JSON.parse(readFileSync(CATS, "utf8"));
const catId = (p) => {
  const id = p.to.sitooCategoryId ?? newCatIds[p.to.category];
  return id == null ? null : Number(id);
};

const work = [];
for (const p of plan.plan) {
  for (const v of p.variants) {
    if (!v.sitooProductId) continue;
    work.push({ p, v });
  }
}

// Fresh read of every product: the plan's snapshot may be hours old.
const before = {};
for (const { v } of work) before[v.sitooProductId] = await call("GET", `/products/${v.sitooProductId}`);
const snap = `snapshots/vintage-cleanup-sitoo-before-${stamp}.json`;
writeFileSync(snap, JSON.stringify(before, null, 2));

const ops = [];
for (const { p, v } of work) {
  const cur = before[v.sitooProductId];
  if (cur.sku.toUpperCase() !== v.sku.toUpperCase())
    throw new Error(`Sitoo ${v.sitooProductId} is ${cur.sku}, plan says ${v.sku} — refusing`);
  const body = {};
  // Title: only where the master's name changed. Sitoo titles that already
  // differ for other reasons (the Levis size-range names) are left alone.
  if (p.changes.name && cur.title !== p.to.name) body.title = p.to.name;
  const cid = catId(p);
  if (cid != null) {
    const cats = [cid, ...(cur.categories ?? []).filter((c) => KEEP_EXTRA.has(c) && c !== cid)];
    const same =
      cur.defaultcategoryid === cid &&
      JSON.stringify([...(cur.categories ?? [])].sort()) === JSON.stringify([...cats].sort());
    if (!same) Object.assign(body, { defaultcategoryid: cid, categories: cats });
  }
  if (p.action === "archive" && (cur.active || cur.activepos)) Object.assign(body, { active: false, activepos: false });
  if (Object.keys(body).length) ops.push({ id: v.sitooProductId, sku: v.sku, action: p.action, from: { title: cur.title, defaultcategoryid: cur.defaultcategoryid, categories: cur.categories, active: cur.active, activepos: cur.activepos }, body });
}

const tally = {
  products: work.length,
  writes: ops.length,
  titles: ops.filter((o) => "title" in o.body).length,
  categories: ops.filter((o) => "defaultcategoryid" in o.body).length,
  deactivations: ops.filter((o) => "active" in o.body).length,
};
console.log(JSON.stringify(tally));
console.log(`Before-state → ${snap}`);

if (!APPLY) {
  for (const o of ops.slice(0, 12)) console.log(o.sku, JSON.stringify(o.from.title), "→", JSON.stringify(o.body));
  writeFileSync(`snapshots/vintage-cleanup-sitoo-ops-dryrun.json`, JSON.stringify(ops, null, 2));
  console.log("DRY RUN — pass --apply to write.");
  process.exit(0);
}

const done = [];
const failed = [];
for (const o of ops) {
  try {
    await call("PUT", `/products/${o.id}`, o.body);
    const after = await call("GET", `/products/${o.id}`);
    const bad = Object.entries(o.body).filter(([k, val]) =>
      Array.isArray(val)
        ? JSON.stringify([...after[k]].sort()) !== JSON.stringify([...val].sort())
        : after[k] !== val
    );
    if (bad.length) failed.push({ ...o, readBack: Object.fromEntries(bad.map(([k]) => [k, after[k]])) });
    else done.push(o);
  } catch (e) {
    failed.push({ ...o, error: e.message });
  }
}
const out = `snapshots/vintage-cleanup-sitoo-result-${stamp}.json`;
writeFileSync(out, JSON.stringify({ tally, done: done.length, failed }, null, 2));
console.log(`written ${done.length}, failed ${failed.length} → ${out}`);
for (const f of failed) console.log("  FAIL", f.sku, f.error ?? JSON.stringify(f.readBack));
process.exit(failed.length ? 1 : 0);
