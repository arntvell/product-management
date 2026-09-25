// Prove, on the Sitoo SANDBOX, the three writes the vintage cleanup needs before
// they touch production:
//
//   POST /categories                          create a category
//   PUT  /products/{id} {title, defaultcategoryid, categories}
//   PUT  /products/{id} {active:false, activepos:false}
//
// updateBarcode (src/lib/sitoo/client.ts) established that PUT /products/{id}
// patches for `barcode`. That is one field; this checks the others, and that
// every other field on the product survives each write. The product is restored
// and the test category deleted at the end.
//
//   node scripts/vintage-cleanup/sitoo-sandbox-check.mjs
import { config } from "dotenv";

config({ path: ".env.local" });

const base = process.env.SITOO_SBBASE_URL.replace(/\/+$/, "");
const auth =
  "Basic " + Buffer.from(`${process.env.SITOO_SBAPI_ID}:${process.env.SITOO_SBAPI_KEY}`).toString("base64");
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

// Every field except the ones we meant to change must read back identical.
const IGNORE = new Set(["datemodified"]);
function drift(before, after, changed) {
  return Object.keys(before).filter(
    (k) => !IGNORE.has(k) && !changed.includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k])
  );
}

const page = await call("GET", "/products?start=0&num=50");
const target = page.items.find((p) => p.variantparentid === p.productid) ?? page.items[0];
const id = target.productid;
const original = await call("GET", `/products/${id}`);
console.log(`Sandbox product ${id} ${original.sku} "${original.title}" cat=${original.defaultcategoryid} ${JSON.stringify(original.categories)} active=${original.active}/${original.activepos}`);

const results = [];
let catId = null;
try {
  // 1. category create
  const created = await call("POST", "/categories", { title: "ZZ Origio test category", visible: true });
  catId = typeof created === "number" ? created : created?.categoryid ?? created;
  const cat = await call("GET", `/categories/${catId}`);
  results.push(["create category", cat.title === "ZZ Origio test category", `id=${catId}`]);

  // 2. title + category
  const cats = [catId, ...(original.categories ?? []).filter((c) => c !== original.defaultcategoryid)];
  await call("PUT", `/products/${id}`, { title: "ZZ Origio test title", defaultcategoryid: catId, categories: cats });
  const a = await call("GET", `/products/${id}`);
  const d1 = drift(original, a, ["title", "defaultcategoryid", "categories"]);
  results.push([
    "title + category",
    a.title === "ZZ Origio test title" && a.defaultcategoryid === catId && JSON.stringify(a.categories.sort()) === JSON.stringify(cats.sort()) && d1.length === 0,
    `title=${a.title} cat=${a.defaultcategoryid} ${JSON.stringify(a.categories)} drift=${JSON.stringify(d1)}`,
  ]);

  // 3. deactivate
  await call("PUT", `/products/${id}`, { active: false, activepos: false });
  const b = await call("GET", `/products/${id}`);
  const d2 = drift(a, b, ["active", "activepos"]);
  const listed = (await call("GET", `/products?sku=${encodeURIComponent(original.sku)}`)).items ?? [];
  const listedInactive = (await call("GET", `/products?sku=${encodeURIComponent(original.sku)}&includeinactive=true`)).items ?? [];
  results.push([
    "deactivate",
    b.active === false && b.activepos === false && d2.length === 0,
    `active=${b.active}/${b.activepos} drift=${JSON.stringify(d2)} listedDefault=${listed.length} listedInactive=${listedInactive.length}`,
  ]);
} finally {
  // restore
  await call("PUT", `/products/${id}`, {
    title: original.title,
    defaultcategoryid: original.defaultcategoryid,
    categories: original.categories,
    active: original.active,
    activepos: original.activepos,
  });
  const r = await call("GET", `/products/${id}`);
  const d3 = drift(original, r, []);
  results.push(["restore", d3.length === 0, `drift=${JSON.stringify(d3)}`]);
  if (catId != null) {
    await call("DELETE", `/categories/${catId}`).then(
      () => results.push(["delete test category", true, ""]),
      (e) => results.push(["delete test category", false, e.message])
    );
  }
}
for (const [step, ok, note] of results) console.log(`${ok ? "PASS" : "FAIL"}  ${step}  ${note}`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
