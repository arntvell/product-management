// Partner access to /api/partner/v1/*: Loom first.
//
// Not CRON_SECRET. That Bearer is ADMIN on every Origio route (proxy.ts), far
// more than a partner should hold. A partner gets its own token, which works
// only under /api/partner/v1/ and only for the scopes it was minted with:
//
//   products:create      POST external-products
//                        POST colorway-sizes
//   categories:read      GET  categories
//   master-data:write    PATCH variants/master-data
//   brands:create        POST brands
//   seasons:write        POST season-assignments
//   size-systems:read    GET  size-systems
//   size-systems:write   PATCH size-systems/{id}
//
// Only the SHA-256 of a token is stored. It is minted, and shown once, by
// scripts/partner-token.ts. Revoking is setting revokedAt.
//
// The proxy lets /api/partner/v1/* past both of its gates untouched (proxy.ts,
// WEBHOOK_PATHS), so THIS is the whole of the authentication: every route
// there must call authenticatePartner first.
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const PARTNER_SCOPES = [
  "products:create",
  "categories:read",
  "master-data:write",
  "brands:create",
  "seasons:write",
  "size-systems:read",
  "size-systems:write",
] as const;
export type PartnerScope = (typeof PARTNER_SCOPES)[number];

export function hashPartnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface Partner {
  name: string;
}

/** The partner behind the request's Bearer, or the response to send instead. */
export async function authenticatePartner(
  req: Request,
  scope: PartnerScope
): Promise<{ partner: Partner } | { response: NextResponse }> {
  const [kind, token] = (req.headers.get("authorization") ?? "").split(" ");
  if (kind?.toLowerCase() !== "bearer" || !token)
    return { response: NextResponse.json({ error: "missing Bearer token" }, { status: 401 }) };
  // Looked up by hash: the stored value is never compared with the token itself.
  const row = await prisma.partnerToken.findUnique({ where: { tokenHash: hashPartnerToken(token) } });
  if (!row || row.revokedAt)
    return { response: NextResponse.json({ error: "unknown or revoked token" }, { status: 401 }) };
  if (!row.scopes.includes(scope))
    return { response: NextResponse.json({ error: `this token lacks the ${scope} scope` }, { status: 403 }) };
  await prisma.partnerToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return { partner: { name: row.name } };
}

/** One line in the call log. Never throws: a failed log must not fail the call. */
export async function logPartnerCall(entry: {
  tokenName: string;
  req: Request;
  status: number;
  started: number;
  items?: number;
  ok?: number;
  dryRun?: boolean;
  error?: string;
}) {
  try {
    await prisma.partnerCall.create({
      data: {
        tokenName: entry.tokenName,
        method: entry.req.method,
        path: new URL(entry.req.url).pathname,
        status: entry.status,
        items: entry.items,
        ok: entry.ok,
        dryRun: entry.dryRun ?? false,
        ms: Date.now() - entry.started,
        error: entry.error?.slice(0, 1000),
      },
    });
  } catch (err) {
    console.error("partner call log:", err);
  }
}
