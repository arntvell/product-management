// Cin7 Core (formerly DEAR) External API v2 client.
// Auth is via two headers (account id + application key). We only READ here —
// the master pulls the legacy catalogue; nothing is written back to Cin7.
import type { Cin7Product, Cin7AvailabilityRow } from "./types";

const BASE = "https://inventory.dearsystems.com/ExternalApi/v2";
const PAGE_LIMIT = 1000; // Cin7 Core max page size

function authHeaders(): Record<string, string> {
  const accountId = process.env.CIN7_ACCOUNT_ID;
  const appKey = process.env.CIN7_API_KEY;
  if (!accountId || !appKey)
    throw new Error("Missing CIN7_ACCOUNT_ID or CIN7_API_KEY env vars");
  return {
    "api-auth-accountid": accountId,
    "api-auth-applicationkey": appKey,
    "Content-Type": "application/json",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// GET with retry on rate-limit (429) and transient 5xx. Cin7 Core throttles
// hard, so we back off on 429 (honouring Retry-After when present).
async function cin7Get<T>(path: string): Promise<T> {
  const headers = authHeaders();
  const MAX = 5;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const res = await fetch(`${BASE}${path}`, { headers, cache: "no-store" });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("Retry-After")) || 0;
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
      continue;
    }
    if (res.status >= 500) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Cin7 ${res.status} on ${path}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
  throw new Error(`Cin7 request failed after ${MAX} attempts: ${path}`);
}

interface ProductPage {
  Total: number;
  Page: number;
  Products: Cin7Product[];
}
interface AvailabilityPage {
  Total: number;
  Page: number;
  ProductAvailabilityList: Cin7AvailabilityRow[];
}

// Page through every product in the Cin7 catalogue.
export async function fetchAllProducts(
  onProgress?: (fetched: number, total: number) => void
): Promise<Cin7Product[]> {
  const all: Cin7Product[] = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const data = await cin7Get<ProductPage>(
      `/product?Page=${page}&Limit=${PAGE_LIMIT}`
    );
    total = data.Total;
    all.push(...(data.Products ?? []));
    onProgress?.(all.length, total);
    if (!data.Products?.length) break;
    page++;
  }
  return all;
}

// Page through all stock-availability rows (one per SKU × location).
export async function fetchAllAvailability(
  onProgress?: (fetched: number, total: number) => void
): Promise<Cin7AvailabilityRow[]> {
  const all: Cin7AvailabilityRow[] = [];
  let page = 1;
  let total = Infinity;
  while (all.length < total) {
    const data = await cin7Get<AvailabilityPage>(
      `/ref/productavailability?Page=${page}&Limit=${PAGE_LIMIT}`
    );
    total = data.Total;
    all.push(...(data.ProductAvailabilityList ?? []));
    onProgress?.(all.length, total);
    if (!data.ProductAvailabilityList?.length) break;
    page++;
  }
  return all;
}
