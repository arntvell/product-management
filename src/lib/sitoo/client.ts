// Sitoo REST client — read for linking, write for identity corrections.
//
// Two things about this API cost time when they are rediscovered:
//
//  - It is site-scoped. The path is /sites/{siteid}/products and siteid is the
//    NUMERIC id (1), not the GUID that GET /sites returns. Using the GUID gives
//    an empty result rather than an error.
//  - Page size goes up to 1000, and paging is start/num rather than a cursor.

/**
 * Which Sitoo to talk to.
 *
 * The sandbox is a SEPARATE ACCOUNT (91624) from production (91622), so its
 * product ids are unrelated. That makes it right for verifying API behaviour and
 * wrong for rehearsing a real write set — a production product id sent to the
 * sandbox addresses some other garment entirely. pushBarcodesToSitoo guards
 * against that by checking the SKU before it writes.
 */
export type SitooTarget = "production" | "sandbox";

export function resolveTarget(target?: SitooTarget): SitooTarget {
  return target ?? (process.env.SITOO_TARGET === "sandbox" ? "sandbox" : "production");
}

function env(target: SitooTarget) {
  const cfg =
    target === "sandbox"
      ? {
          base: process.env.SITOO_SBBASE_URL,
          id: process.env.SITOO_SBAPI_ID,
          key: process.env.SITOO_SBAPI_KEY,
        }
      : {
          base: process.env.SITOO_BASE_URL,
          id: process.env.SITOO_API_ID,
          key: process.env.SITOO_API_KEY,
        };
  if (!cfg.base || !cfg.id || !cfg.key) {
    throw new Error(`Sitoo ${target} credentials are not configured`);
  }
  return {
    base: cfg.base.replace(/\/+$/, ""),
    auth: "Basic " + Buffer.from(`${cfg.id}:${cfg.key}`).toString("base64"),
  };
}

/** Numeric site id. NOT the GUID that GET /sites returns — that yields nothing. */
const SITE = process.env.SITOO_SITE_ID ?? "1";

export interface SitooProduct {
  productid: number;
  sku: string;
  barcode: string | null;
  title: string | null;
  active?: boolean;
  activepos?: boolean;
  variantparentid?: number | null;
}

async function call<T>(
  path: string,
  init?: RequestInit,
  target?: SitooTarget
): Promise<T> {
  const { base, auth } = env(resolveTarget(target));
  const url = `${base}/sites/${SITE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Sitoo ${init?.method ?? "GET"} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

/** Every product on the site. 14,714 rows at last count, so ~15 requests. */
export async function listProducts(target?: SitooTarget): Promise<SitooProduct[]> {
  const out: SitooProduct[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await call<{ items: SitooProduct[]; totalcount?: number }>(
      `/products?start=${start}&num=1000`,
      undefined,
      target
    );
    const items = page.items ?? [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

export async function getProduct(
  productId: number,
  target?: SitooTarget
): Promise<SitooProduct> {
  return call<SitooProduct>(`/products/${productId}`, undefined, target);
}

/**
 * Write a barcode.
 *
 * Both of these were verified against the sandbox on 2026-09-12, because getting
 * either wrong is expensive against 14,714 live products:
 *
 *   PUT /products/{id} PATCHES.  Sending { barcode } alone left all 25 populated
 *   fields intact — title, price, sku, VAT, SEO — on a real value change, not
 *   just a no-op. So a targeted barcode write is safe.
 *
 *   `barcode: null` is REJECTED with HTTP 400 ("Invalid value"). The empty
 *   string clears it and reads back as null. This matters: the unwind phase
 *   clears a code before rewriting it, and null would have failed mid-run and
 *   stranded those products.
 *
 * Sitoo also holds `barcodealiases`, a list of additional codes that scan — see
 * addBarcodeAlias.
 */
export async function updateBarcode(
  productId: number,
  barcode: string | null,
  target?: SitooTarget
): Promise<void> {
  await call(
    `/products/${productId}`,
    { method: "PUT", body: JSON.stringify({ barcode: barcode ?? "" }) },
    target
  );
}

/**
 * Write a SKU.
 *
 * Needed because a merge can change the master's spelling while the channel keeps
 * the old one, and our linker cannot see it: `normalizeSku` uppercases before
 * comparing, so LIV-Needle-W-L and LIV-NEEDLE-W-L look identical to us and differ
 * to anything joining on raw text — Pio and the shop stocktake both do.
 *
 * Verified against the sandbox on 2026-09-15, same way the barcode write was:
 *
 *   PUT /products/{id} with { sku } PATCHES. No populated field was lost.
 *
 *   A CASE-ONLY change is accepted — Sitoo does not treat it as a no-op, which
 *   is the whole point here.
 *
 *   `sku: ""` is REJECTED with HTTP 400. A SKU cannot be blanked, only replaced.
 */
export async function updateSku(
  productId: number,
  sku: string,
  target?: SitooTarget
): Promise<void> {
  if (!sku.trim()) throw new Error("refusing to blank a SKU — Sitoo rejects it anyway");
  await call(
    `/products/${productId}`,
    { method: "PUT", body: JSON.stringify({ sku }) },
    target
  );
}

/**
 * Additional codes that also scan to this product.
 *
 * This is the answer to the store-label problem. Sitoo holds shop-printed codes
 * on GS1's restricted 99* range for products whose manufacturer EAN is known —
 * Norda is 0990497800682 in the POS and 0872236017271 everywhere else. Both are
 * correct, for different questions, and the master has one slot for them.
 *
 * With aliases neither has to be discarded: whichever scans stays primary and
 * the other becomes an alias, so both resolve at the till.
 *
 * Verified against the sandbox: the field takes a list of plain strings. A list
 * of objects is rejected with "Invalid value in barcodealiases (Not string)".
 */
export async function setBarcodeAliases(
  productId: number,
  aliases: string[],
  target?: SitooTarget
): Promise<void> {
  await call(
    `/products/${productId}`,
    { method: "PUT", body: JSON.stringify({ barcodealiases: aliases }) },
    target
  );
}

// ---------------------------------------------------------------------------
// Reference data: categories and manufacturers
// ---------------------------------------------------------------------------
//
// Both endpoints are documented (developer.sitoo.com), and neither has ever been
// called from this repo — the client only ever touched /products. So both
// readers fall back: on any failure they derive the same information from the
// product list, which scripts/reconcile/fetch.py has proven works by pulling
// `defaultcategoryid` and `manufacturerid` into snapshots for months.
//
// Sitoo is the only one of the three channels with real category ids and a
// hierarchy, which is why it is worth asking properly before falling back.

export interface SitooCategory {
  categoryid: number;
  title: string | null;
  categoryparentid?: number | null;
  visible?: boolean;
}

export interface SitooManufacturer {
  externalcompanyid: number;
  name: string;
  countryid?: string | null;
}

export interface SitooReferenceResult<T> {
  items: T[];
  /** "endpoint" when the documented route answered; "derived" when we fell back. */
  source: "endpoint" | "derived";
  note?: string;
}

export async function listCategories(
  target?: SitooTarget
): Promise<SitooReferenceResult<SitooCategory>> {
  try {
    const items = await page<SitooCategory>("/categories", target);
    return { items, source: "endpoint" };
  } catch (err) {
    return {
      items: [],
      source: "derived",
      note: `GET /categories failed (${err instanceof Error ? err.message.slice(0, 160) : "unknown"}). Category ids can still be read from products.`,
    };
  }
}

export async function listManufacturers(
  target?: SitooTarget
): Promise<SitooReferenceResult<SitooManufacturer>> {
  try {
    const items = await page<SitooManufacturer>("/manufacturers", target);
    return { items, source: "endpoint" };
  } catch (err) {
    return {
      items: [],
      source: "derived",
      note: `GET /manufacturers failed (${err instanceof Error ? err.message.slice(0, 160) : "unknown"}). Manufacturer ids can still be read from products.`,
    };
  }
}

/**
 * Products with the reference fields attached, for the fallback path and for
 * counting how many products carry each value.
 *
 * `fields=` is used deliberately: the introduction warns that some fields are
 * calculated and asking for everything makes the request unnecessarily long.
 */
export interface SitooProductRefs {
  productid: number;
  sku: string;
  defaultcategoryid?: number | null;
  manufacturerid?: number | null;
}

export async function listProductRefs(target?: SitooTarget): Promise<SitooProductRefs[]> {
  return page<SitooProductRefs>(
    "/products?fields=productid,sku,defaultcategoryid,manufacturerid",
    target
  );
}

/** Shared pager. Sitoo answers `start`/`num` with a max page of 1000. */
async function page<T>(path: string, target?: SitooTarget): Promise<T[]> {
  const out: T[] = [];
  const join = path.includes("?") ? "&" : "?";
  for (let start = 0; ; start += 1000) {
    const res = await call<{ items: T[] }>(
      `${path}${join}start=${start}&num=1000`,
      undefined,
      target
    );
    const items = res?.items ?? [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}
