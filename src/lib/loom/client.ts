// Loom ingest client. The master ("Origo") pushes product data to Loom's
// upsert endpoint. Bearer auth; token from env.
const LOOM_UPSERT_URL =
  process.env.LOOM_URL?.replace(/\/+$/, "") ??
  "https://loom.livid.no/api/origio/v1/upsert";

/** The API root, derived from the upsert URL, for sibling endpoints. */
const LOOM_API_BASE = LOOM_UPSERT_URL.replace(/\/upsert\/?$/, "");

function loomToken(): string {
  // Local dev uses LOOM_LOCAL_TOKEN; the deployed environments were set up
  // with LOOM_TOKEN. Accept either rather than have the push throw depending
  // on where it runs.
  const token = process.env.LOOM_LOCAL_TOKEN ?? process.env.LOOM_TOKEN;
  if (!token) throw new Error("Missing LOOM_LOCAL_TOKEN / LOOM_TOKEN env var");
  return token;
}

/**
 * An upsert returns a job id as soon as the payload is ACCEPTED — not when it
 * has been written. A job can fail afterwards (Loom's database being briefly
 * unreachable, for one real example) and the push would still look like a
 * success. Poll the job so "sent" means "finished".
 */
export interface LoomJob {
  status: string; // "done" | "error" | "running" | …
  progress?: {
    stylesDone?: number;
    stylesTotal?: number;
    colorwaysDone?: number;
    colorwaysTotal?: number;
    errors?: number;
  };
  summary?: {
    created?: number;
    updated?: number;
    archived?: number;
    fatalError?: string;
    /** Loom warns when a style looks like a colorway modelled as its own style. */
    shapeWarnings?: string[];
  };
}

export async function getLoomJob(jobId: string): Promise<LoomJob | null> {
  const res = await fetch(`${LOOM_API_BASE}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${loomToken()}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as LoomJob;
  } catch {
    return null;
  }
}

/** Poll until the job settles, or the budget runs out. */
export async function waitForLoomJob(
  jobId: string,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<LoomJob | null> {
  // A 217-colorway push took 128 s of Loom-side work, so a two-minute budget
  // times out on a routine full-season delivery and reports it as unconfirmed.
  const timeout = opts.timeoutMs ?? 600_000;
  const interval = opts.intervalMs ?? 3_000;
  const deadline = Date.now() + timeout;
  let last: LoomJob | null = null;
  while (Date.now() < deadline) {
    last = await getLoomJob(jobId);
    if (last && last.status !== "running" && last.status !== "queued") return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last; // still unsettled — the caller reports it as unconfirmed
}

export async function loomUpsert<T = unknown>(body: unknown): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
  raw: string;
}> {
  const token = loomToken();

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
