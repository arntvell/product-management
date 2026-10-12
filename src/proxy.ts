import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { clerkClient, clerkMiddleware } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { can, pagePermission, permissionFor, refusal, roleHome } from "@/lib/auth/permissions";
import {
  clerkEnabled,
  USER_EMAIL_HEADER,
  USER_ID_HEADER,
  USER_ROLE_HEADER,
} from "@/lib/auth/session";

/**
 * The gate in front of everything. (Next 16 calls this file proxy.ts; it was
 * middleware.ts. A proxy always runs on Node, which is what lets it read the
 * User table.)
 *
 * Two modes, chosen by whether Clerk's keys are configured:
 *
 *   Shared password  unchanged from middleware.ts — the cookie or a Bearer of
 *                    APP_PASSWORD. Stays the behaviour until the keys exist, so
 *                    deploying this cannot lock anyone out.
 *   Clerk            Google sign-in (@livid.no, set in Clerk). The User table is
 *                    the real gate: a signed-in person with no active row is
 *                    refused, and every API write is checked against the role
 *                    (lib/auth/permissions.ts).
 *
 * In both modes a Bearer of CRON_SECRET or APP_PASSWORD is a service call —
 * Vercel Cron's vintage reveal and the canary scripts use it.
 *
 * Fail-closed in production: no APP_PASSWORD and no Clerk keys locks the app
 * rather than opening it (the reason middleware.ts stopped failing open).
 */
const ORIGO_HEADERS = [USER_ID_HEADER, USER_ROLE_HEADER, USER_EMAIL_HEADER];

/** Headers a client may NOT set: only this file asserts who someone is. */
function cleanHeaders(request: NextRequest): Headers {
  const h = new Headers(request.headers);
  for (const k of ORIGO_HEADERS) h.delete(k);
  return h;
}

/**
 * A machine caller. In password mode the shared password also counts, as it
 * always did. In Clerk mode only CRON_SECRET does: the shared password was known
 * to everyone, and must not stay an admin key once people sign in as themselves.
 */
function serviceCall(request: NextRequest, mode: "password" | "clerk"): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const [, token] = auth.split(" ");
  const accepted = (
    mode === "clerk" ? [process.env.CRON_SECRET] : [process.env.CRON_SECRET, process.env.APP_PASSWORD]
  ).filter(Boolean);
  return !!token && accepted.includes(token);
}

function asService(request: NextRequest): NextResponse {
  const h = cleanHeaders(request);
  h.set(USER_ROLE_HEADER, "ADMIN");
  return NextResponse.next({ request: { headers: h } });
}

// ---------------------------------------------------------------------------
// Shared-password mode (unchanged behaviour)
// ---------------------------------------------------------------------------

function passwordGate(request: NextRequest): NextResponse {
  const password = process.env.APP_PASSWORD;
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/login/")) return NextResponse.next();

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return deny(request, "APP_PASSWORD is not configured");
  }
  if (request.cookies.get("auth")?.value === password) return NextResponse.next();
  if (request.method === "POST" && path === "/api/auth/login") return NextResponse.next();
  if (serviceCall(request, "password")) return asService(request);
  return deny(request, "Unauthorized");
}

/**
 * Pages redirect to the login screen; API routes get a 401. A missing
 * APP_PASSWORD reports 503 rather than 401 — nobody can log in past it, so
 * "unauthorized" would send an operator hunting for the wrong problem.
 */
function deny(request: NextRequest, reason: string) {
  const misconfigured = reason !== "Unauthorized";
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    if (misconfigured)
      return new NextResponse(`Origio is not configured: ${reason}.`, {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.json({ error: reason }, { status: misconfigured ? 503 : 401 });
}

// ---------------------------------------------------------------------------
// Clerk mode
// ---------------------------------------------------------------------------

const PUBLIC_PATHS = [/^\/sign-in(\/|$)/, /^\/no-access$/];

const clerkGate = clerkMiddleware(async (auth, request) => {
  const path = request.nextUrl.pathname;
  if (PUBLIC_PATHS.some((r) => r.test(path)))
    return NextResponse.next({ request: { headers: cleanHeaders(request) } });
  if (serviceCall(request, "clerk")) return asService(request);

  const isApi = path.startsWith("/api/");
  const { userId } = await auth();
  if (!userId) {
    if (isApi) return NextResponse.json({ error: "Sign in to Origo first." }, { status: 401 });
    const to = new URL("/sign-in", request.url);
    to.searchParams.set("redirect_url", request.url);
    return NextResponse.redirect(to);
  }

  // The Clerk id resolves straight to a User once it has been seen. Otherwise
  // match on the verified email an admin added, and remember the id. That
  // includes a user already linked to ANOTHER Clerk id: Clerk's development
  // and production instances give one person two ids, and the same database
  // serves both, so someone who signed in locally would otherwise be locked
  // out of production. The email is verified by Clerk (Google, or a code), so
  // it is the identity; the id is only a shortcut to it.
  let user = await prisma.user.findUnique({ where: { clerkUserId: userId } });
  if (!user) {
    const cu = await (await clerkClient()).users.getUser(userId);
    const email = cu.primaryEmailAddress?.emailAddress?.toLowerCase();
    const verified = cu.primaryEmailAddress?.verification?.status === "verified";
    if (email && verified) {
      const invited = await prisma.user.findUnique({ where: { email } });
      if (invited)
        user = await prisma.user.update({
          where: { id: invited.id },
          data: {
            clerkUserId: userId,
            name: invited.name ?? ([cu.firstName, cu.lastName].filter(Boolean).join(" ") || null),
          },
        });
    }
  }
  if (!user || !user.active) {
    if (isApi)
      return NextResponse.json(
        { error: "You are signed in, but have no access to Origo. Ask an admin to add you." },
        { status: 403 }
      );
    return NextResponse.redirect(new URL("/no-access", request.url));
  }

  if (isApi) {
    const needed = permissionFor(path, request.method);
    if (!can(user.role, needed))
      return NextResponse.json({ error: refusal(user.role, needed) }, { status: 403 });
  } else if (!can(user.role, pagePermission(path))) {
    // A page the role cannot use at all goes to that role's own start page.
    return NextResponse.redirect(new URL(roleHome(user.role), request.url));
  }

  // Seen-at, at most once an hour: the users page shows who is active.
  if (!user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > 3600_000)
    await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });

  const h = cleanHeaders(request);
  h.set(USER_ID_HEADER, user.id);
  h.set(USER_ROLE_HEADER, user.role);
  h.set(USER_EMAIL_HEADER, user.email);
  return NextResponse.next({ request: { headers: h } });
});

export function proxy(request: NextRequest, event: NextFetchEvent) {
  if (clerkEnabled()) return clerkGate(request, event);
  return passwordGate(request);
}

export const config = {
  // Everything but Next's static assets. /login is let through inside the
  // password gate rather than excluded here, because in Clerk mode it must be
  // gated like any other page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
