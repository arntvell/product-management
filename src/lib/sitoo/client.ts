// Sitoo REST client — read for linking, write for identity corrections.
//
// Two things about this API cost time when they are rediscovered:
//
//  - It is site-scoped. The path is /sites/{siteid}/products and siteid is the
//    NUMERIC id (1), not the GUID that GET /sites returns. Using the GUID gives
//    an empty result rather than an error.
//  - Page size goes up to 1000, and paging is start/num rather than a cursor.

const BASE = () => (process.env.SITOO_BASE_URL ?? "").replace(/\/+$/, "");
const SITE = process.env.SITOO_SITE_ID ?? "1";

function authHeader(): string {
  const id = process.env.SITOO_API_ID;
  const key = process.env.SITOO_API_KEY;
  if (!id || !key) throw new Error("SITOO_API_ID and SITOO_API_KEY must be set");
  return "Basic " + Buffer.from(`${id}:${key}`).toString("base64");
}

export interface SitooProduct {
  productid: number;
  sku: string;
  barcode: string | null;
  title: string | null;
  active?: boolean;
  activepos?: boolean;
  variantparentid?: number | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE()}/sites/${SITE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
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
export async function listProducts(): Promise<SitooProduct[]> {
  const out: SitooProduct[] = [];
  for (let start = 0; ; start += 1000) {
    const page = await call<{ items: SitooProduct[]; totalcount?: number }>(
      `/products?start=${start}&num=1000`
    );
    const items = page.items ?? [];
    out.push(...items);
    if (items.length < 1000) break;
  }
  return out;
}

export async function getProduct(productId: number): Promise<SitooProduct> {
  return call<SitooProduct>(`/products/${productId}`);
}

/**
 * Write a barcode.
 *
 * Sitoo holds no duplicate barcodes anywhere in its 14,714 products, which
 * strongly suggests the field is unique-constrained — so a colliding write fails
 * here rather than corrupting anything, and the rotation handling in push.ts
 * exists precisely because of that.
 *
 * VERIFY BEFORE THE FIRST SANDBOX RUN — two things this code assumes and which
 * have not been confirmed against developer.sitoo.com:
 *
 *  1. That PUT /products/{id} *patches*. If it replaces the resource instead,
 *     sending { barcode } alone would blank every other field on the product.
 *     If the reference says replace, switch to PATCH, or GET-merge-PUT.
 *  2. That `barcode: null` is accepted for the unwind phase. Some APIs want an
 *     empty string, and a rejected null would strand the unwound products
 *     without a barcode until the run is repeated.
 *
 * Both are cheap to check against one sandbox product and expensive to get
 * wrong against 14,714 live ones.
 */
export async function updateBarcode(productId: number, barcode: string | null): Promise<void> {
  await call(`/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify({ barcode }),
  });
}
