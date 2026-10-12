// The signed-in person, as Origo knows them.
//
// Two modes, switched by whether Clerk's keys exist:
//
//   Clerk   the proxy resolved a User row and passed its id and role on the
//           request (x-origo-user-*). Route handlers and pages read those.
//   Shared  no Clerk keys yet: the old shared password. Everyone is one
//           anonymous admin, exactly as before — so deploying this cannot lock
//           anyone out before the keys are added.
//
// The x-origo-user-* headers are trusted only because the proxy deletes any a
// client sent before setting its own.

import { headers } from "next/headers";
import type { UserRole } from "@/generated/prisma/client";
import { can, refusal, type Permission } from "./permissions";

export const USER_ID_HEADER = "x-origo-user-id";
export const USER_ROLE_HEADER = "x-origo-user-role";
export const USER_EMAIL_HEADER = "x-origo-user-email";

/**
 * Clerk mode needs the keys AND an explicit ORIGO_AUTH=clerk. Installing Clerk
 * from the Vercel Marketplace provisions the keys to Production on its own; with
 * keys alone, the next deploy for any reason would switch sign-in on before the
 * team is added and Google is configured. The switch is a decision, not a side
 * effect.
 */
export function clerkEnabled(): boolean {
  return (
    process.env.ORIGO_AUTH === "clerk" &&
    !!process.env.CLERK_SECRET_KEY &&
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  );
}

export interface SessionUser {
  /** Null for the shared-password session and for service tokens. */
  id: string | null;
  email: string | null;
  role: UserRole;
}

const SHARED: SessionUser = { id: null, email: null, role: "ADMIN" };

export async function getSessionUser(): Promise<SessionUser> {
  if (!clerkEnabled()) return SHARED;
  const h = await headers();
  const role = h.get(USER_ROLE_HEADER) as UserRole | null;
  // The proxy only lets a request through with a role set (or as a service
  // call, which carries ADMIN); a missing role means a path the proxy does not
  // match, and that is treated as the most restricted role.
  return {
    id: h.get(USER_ID_HEADER),
    email: h.get(USER_EMAIL_HEADER),
    role: role ?? "VIEWER",
  };
}

export class ForbiddenError extends Error {}

/** For route handlers that check beyond the proxy's path rule. */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!can(user.role, permission)) throw new ForbiddenError(refusal(user.role, permission));
  return user;
}

/**
 * A Vintage user reaches the shared push routes only for vintage garments.
 * Returns the refusal to send, or null when the request may go ahead. Every
 * other role passes — the proxy has already checked them.
 */
export async function vintageOnlyRefusal(colorwayIds: string[]): Promise<string | null> {
  const user = await getSessionUser();
  if (user.role !== "VINTAGE") return null;
  const { prisma } = await import("@/lib/db");
  const { isVintageBrand } = await import("@/lib/master/vintage");
  const rows = await prisma.colorway.findMany({
    where: { id: { in: colorwayIds } },
    select: { colorwaySku: true, brand: { select: { name: true } } },
  });
  const other = rows.filter((r) => !isVintageBrand(r.brand?.name));
  if (rows.length !== new Set(colorwayIds).size || other.length)
    return `Your role (Vintage) can push vintage garments only${
      other.length ? ` — not ${other.slice(0, 3).map((o) => o.colorwaySku).join(", ")}` : ""
    }.`;
  return null;
}

/**
 * The signed-in user's id, for recording who changed something. Null outside a
 * request (scripts, syncs, cron) and in shared-password mode, where there is
 * no person to name.
 */
export async function currentUserId(): Promise<string | null> {
  try {
    return (await getSessionUser()).id;
  } catch {
    return null;
  }
}
