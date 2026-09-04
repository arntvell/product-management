// Typed client for the Threadflow External Read-Only API.
// Auth: static API key (X-API-Key). Base URL from env; the scheme is
// normalised (the env value may omit https://). Read-only — GET only.
import type {
  TFManufacturer,
  TFPaginated,
  TFProductsResponse,
  TFStyle,
} from "./types";

const API_PREFIX = "/api/external/v1";
const MAX_RETRIES = 3;

function getConfig() {
  const rawUrl = process.env.THREADFLOW_URL;
  const apiKey = process.env.THREADFLOW_API_KEY;
  if (!rawUrl || !apiKey) {
    throw new Error(
      "Missing THREADFLOW_URL or THREADFLOW_API_KEY env vars"
    );
  }
  // Normalise: ensure https:// scheme, strip trailing slash, and avoid a
  // double /api/external/v1 if the env already includes it.
  let base = rawUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
  if (!base.includes(API_PREFIX)) base = `${base}${API_PREFIX}`;
  return { base, apiKey };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a Threadflow path (relative to /api/external/v1) and parse JSON. */
async function tfGet<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const { base, apiKey } = getConfig();
  const url = new URL(`${base}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" },
      // server-only; never cache product data across syncs
      cache: "no-store",
    });

    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`Threadflow ${res.status} ${res.statusText}`);
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `Threadflow ${res.status} ${res.statusText} for ${path}`
      );
    }
    return (await res.json()) as T;
  }
  throw lastError ?? new Error("Threadflow request failed");
}

/** Fetch every page of a cursor-paginated list endpoint. */
async function tfGetAll<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {}
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await tfGet<TFPaginated<T>>(path, {
      ...params,
      limit: 1000,
      cursor,
    });
    all.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return all;
}

/** All manufacturers (name + address), for resolving colorway manufacturer_id. */
export function getManufacturers(): Promise<TFManufacturer[]> {
  return tfGetAll<TFManufacturer>("/manufacturers");
}

export interface GetProductsOptions {
  includeUnapproved?: boolean;
  includeDropped?: boolean;
}

/**
 * Trim the identifiers Threadflow hands us.
 *
 * A SKU is typed by a person, so it can arrive padded — Keri's SS27 "Japan
 * Black" came through as "  \t LIV-KR-JPN-BLCK", tab and all, on the colorway
 * and on all 21 of its variants. Whitespace is invisible in every UI but the
 * database compares it byte for byte, so the padded record read as a different
 * product from the FW26 one under the same SKU: two colorways, two SKUs, a
 * collision on the next sync and a duplicate in Loom.
 *
 * The value is an identifier, not prose, so leading and trailing whitespace can
 * never be meaningful. Normalise once, at the boundary, so nothing downstream
 * has to know. Names are trimmed for the same reason.
 */
function normaliseStyle(s: TFStyle): TFStyle {
  const t = (v: string) => v.trim();
  return {
    ...s,
    style_sku: t(s.style_sku),
    style_name: t(s.style_name),
    colorways: s.colorways.map((c) => ({
      ...c,
      colorway_sku: t(c.colorway_sku),
      name: t(c.name),
      variants: c.variants.map((v) => ({ ...v, sku: t(v.sku) })),
    })),
  };
}

/**
 * All styles (with colorways + variants) for a season. Pagination is at the
 * style level; every colorway/variant of an included style is returned in full.
 * Returns the resolved season descriptor alongside the styles.
 */
export async function getSeasonProducts(
  seasonCode: string,
  opts: GetProductsOptions = {}
): Promise<{ season: { id: string; code: string }; styles: TFStyle[] }> {
  const styles: TFStyle[] = [];
  let cursor: string | undefined;
  let season: { id: string; code: string } | null = null;

  do {
    const page = await tfGet<TFProductsResponse>("/products", {
      seasonCode,
      includeUnapproved: opts.includeUnapproved,
      includeDropped: opts.includeDropped,
      limit: 200,
      cursor,
    });
    season ??= page.season;
    styles.push(...page.data.map(normaliseStyle));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  if (!season) season = { id: "", code: seasonCode };
  return { season, styles };
}

/** Fetch raw image bytes for an API-key-authed image ref (proxy use). */
export async function fetchImage(
  ref: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  const { base, apiKey } = getConfig();
  // Refs from /products are absolute paths beginning with /api/external/v1/...
  // Build a URL from the host root, not the API prefix.
  const root = base.replace(new RegExp(`${API_PREFIX}$`), "");
  const url = ref.startsWith("http") ? ref : `${root}${ref}`;
  const res = await fetch(url, { headers: { "X-API-Key": apiKey } });
  if (!res.ok) return null;
  return {
    body: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
  };
}
