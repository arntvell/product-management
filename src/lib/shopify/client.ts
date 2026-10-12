import type { GraphQLResponse } from "./types";

// 2026-07 since 2026-10-12. 2025-10 silently left 15 of the store's 200
// collections out (Men FW26, Men/Women clothing, the brand collections…) —
// from the collections editor and from every collection picker. Every
// GraphQL document in src/ was validated against the 2026-07 schema before
// the switch, and the selective-update previews compared identical on both.
const SHOPIFY_API_VERSION = "2026-07";
const MAX_RETRIES = 3;
const THROTTLE_WAIT_MS = 1000;

function getConfig() {
  const storeUrl = process.env.SHOPIFY_STORE_URL;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!storeUrl || !token) {
    throw new Error(
      "Missing SHOPIFY_STORE_URL or SHOPIFY_ACCESS_TOKEN env vars"
    );
  }
  // Strip protocol if provided (e.g. "https://foo.myshopify.com" → "foo.myshopify.com")
  const store = storeUrl.replace(/^https?:\/\//, "");
  return { store, token };
}

/** One Admin GraphQL call. `apiVersion` overrides the app-wide version. */
export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>,
  opts: { apiVersion?: string } = {}
): Promise<T> {
  const { store, token } = getConfig();
  const url = `https://${store}/admin/api/${opts.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseFloat(retryAfter) * 1000
        : THROTTLE_WAIT_MS * (attempt + 1);
      await sleep(waitMs);
      continue;
    }

    if (!response.ok) {
      lastError = new Error(
        `Shopify API error: ${response.status} ${response.statusText}`
      );
      if (response.status >= 500) {
        await sleep(THROTTLE_WAIT_MS * (attempt + 1));
        continue;
      }
      throw lastError;
    }

    const json = (await response.json()) as GraphQLResponse<T>;

    if (json.errors?.length) {
      const throttled = json.errors.some(
        (e) => e.extensions?.code === "THROTTLED"
      );
      if (throttled) {
        const cost = json.extensions?.cost?.throttleStatus;
        const waitMs = cost
          ? ((cost.maximumAvailable - cost.currentlyAvailable) /
              cost.restoreRate) *
            1000
          : THROTTLE_WAIT_MS * (attempt + 1);
        await sleep(Math.min(waitMs, 10000));
        continue;
      }
      throw new Error(
        `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
      );
    }

    return json.data;
  }

  throw lastError || new Error("Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
