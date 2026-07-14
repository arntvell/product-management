// Loom ingest client. The master ("Origo") pushes product data to Loom's
// upsert endpoint. Bearer auth; token from env.
const LOOM_UPSERT_URL =
  process.env.LOOM_URL?.replace(/\/+$/, "") ??
  "https://loom.livid.no/api/origio/v1/upsert";

export async function loomUpsert<T = unknown>(body: unknown): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  raw: string;
}> {
  const token = process.env.LOOM_LOCAL_TOKEN;
  if (!token) throw new Error("Missing LOOM_LOCAL_TOKEN env var");

  const res = await fetch(LOOM_UPSERT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const raw = await res.text();
  let data: T | null = null;
  try {
    data = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, data, raw };
}
