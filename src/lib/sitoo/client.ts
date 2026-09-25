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

// ---------------------------------------------------------------------------
// Creating product
// ---------------------------------------------------------------------------
//
// Every call here is SEQUENTIAL by construction. Sitoo permits no concurrent
// requests — two in flight returns `429: Too many connections` — and this
// codebase has already hit that once by parallelising two reads.

export interface SitooProductCreate {
  sku: string;
  title?: string;
  descriptionshort?: string;
  moneyprice?: string;
  moneypricein?: string;
  vatid?: number;
  defaultcategoryid?: number;
  manufacturerid?: number;
  barcode?: string;
  activepos?: boolean;
  stockcountenable?: boolean;
}

/** One batch create. Sitoo's own guide recommends ~200 SKUs per request. */
export async function createProducts(
  products: SitooProductCreate[],
  target?: SitooTarget
): Promise<Array<{ statuscode: number; return?: number; errortext?: string }>> {
  if (!products.length) return [];
  if (products.length > 200)
    throw new Error(
      `Sitoo recommends batches of 200 SKUs; ${products.length} were passed. Chunk first.`
    );
  // A batch returns HTTP 200 even when individual items fail, so the caller MUST
  // read each item's own statuscode. That is why this returns the raw array.
  return call<Array<{ statuscode: number; return?: number; errortext?: string }>>(
    "/products",
    { method: "POST", body: JSON.stringify(products) },
    target
  );
}

export interface SitooVariantGroup {
  name: string;
  options: string[];
}

export interface SitooVariantRow {
  /** 0 creates a new child. The main variant carries its own productid. */
  productid: number;
  sku: string;
  /**
   * DEPRECATED on the product schema, and REQUIRED here.
   *
   * Sending the variants PUT without it returns
   * `400: Missing required field 'active'.` — measured, not guessed. This is
   * the documented "all fields always need to be sent, including deprecated
   * ones, or they reset to defaults" hazard arriving in person.
   */
  active: boolean;
  activepos: boolean;
  /**
   * Deprecated, required, and a STRING despite reading like a status code —
   * sending a number returns `Invalid field value 'deliverystatus' should be
   * string.` Each of these three facts cost a round trip to discover.
   */
  deliverystatus: string;
  title: string;
  /** One value per group, positionally matched against that group's options. */
  attributes: string[];
  /**
   * The price fields are all REQUIRED on this endpoint even though the spec
   * marks moneypriceorg and moneyofferprice as optional or deprecated on the
   * product schema. "All fields for the Set Product Variants endpoint always
   * need to be sent, otherwise they will be overwritten with default values" is
   * the documented behaviour, and it is enforced as a 400 rather than a silent
   * reset.
   */
  moneyprice: string;
  moneypriceorg: string;
  moneyofferprice: string;
  moneypricein?: string;
  /** Required here. Empty string clears it; null is rejected outright. */
  barcode: string;
  barcodealiases?: string[];
  /** Deprecated, but the guide says to keep sending it, uniquely. The SKU is
   *  what it recommends using. */
  friendly: string;
}

export interface SitooVariants {
  groups: SitooVariantGroup[];
  variants: SitooVariantRow[];
}

export async function getProductVariants(
  productId: number,
  target?: SitooTarget
): Promise<SitooVariants | null> {
  try {
    return await call<SitooVariants>(`/products/${productId}/productvariants`, undefined, target);
  } catch {
    return null;
  }
}

/**
 * Set a product's whole variant family.
 *
 * FULL REPLACEMENT: "any variants omitted from the payload will be deleted."
 * Callers must GET the current set and merge — never send a partial family.
 *
 * Returns `true` and nothing else, so new child productids have to be learned by
 * re-reading the product.
 */
export async function setProductVariants(
  productId: number,
  variants: SitooVariants,
  target?: SitooTarget
): Promise<boolean> {
  const res = await call<boolean>(
    `/products/${productId}/productvariants`,
    { method: "PUT", body: JSON.stringify(variants) },
    target
  );
  return res === true || res === null;
}

/** Products matching a set of SKUs. Used to prove nothing exists before creating. */
export async function findProductsBySku(
  skus: string[],
  target?: SitooTarget
): Promise<SitooProduct[]> {
  const out: SitooProduct[] = [];
  // COMMA-SEPARATED, and this is not a style choice.
  //
  // Repeated `sku=a&sku=b&sku=c` returns HTTP 200 with only the LAST value's
  // product — measured against the sandbox: three real SKUs, one row back, no
  // error. A create path built on that would conclude two of the three did not
  // exist and duplicate them. `sku=a,b,c` returns all three, and so does
  // `sku[]=`; the comma form is what the product-catalogue guide shows.
  //
  // Chunked and sequential: no concurrency, and a URL has a length limit.
  for (let i = 0; i < skus.length; i += 50) {
    const chunk = skus.slice(i, i + 50);
    const q = `sku=${encodeURIComponent(chunk.join(","))}`;
    const res = await call<{ items: SitooProduct[] }>(
      `/products?${q}&fields=productid,sku,barcode,title,variantparentid&start=0&num=1000`,
      undefined,
      target
    );
    out.push(...(res?.items ?? []));
  }
  return out;
}

/** Total product count on the site. The tripwire for the 12 September incident. */
export async function productCount(target?: SitooTarget): Promise<number | null> {
  try {
    const res = await call<{ totalcount?: number }>(
      "/products?start=0&num=1&fields=productid",
      undefined,
      target
    );
    return res?.totalcount ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove a product. Used only to clean up after a sandbox rehearsal.
 *
 * There is no caller in any production path, and there should not be: thirteen
 * products disappeared from Sitoo unexplained on 12 September, and this codebase
 * should never be a candidate explanation for the next thirteen.
 */
export async function deleteProduct(productId: number, target?: SitooTarget): Promise<void> {
  const resolved = resolveTarget(target);
  if (resolved !== "sandbox")
    throw new Error(
      `Refusing to delete Sitoo product ${productId} outside the sandbox. ` +
        `Nothing in Origio deletes production product.`
    );
  await call(`/products/${productId}`, { method: "DELETE" }, resolved);
}
