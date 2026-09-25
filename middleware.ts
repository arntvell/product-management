import { NextRequest, NextResponse } from "next/server";

/**
 * Shared-password gate over everything except /login.
 *
 * This used to read `if (!password) return NextResponse.next()` — it FAILED OPEN.
 * `APP_PASSWORD` is set in Production, so the deployed app was gated in practice,
 * but the variable being unset on a new environment, or rotated away, would have
 * opened every route silently. That was tolerable when the app only read; it is
 * not now that it creates product in Shopify, Sitoo and Loom.
 *
 * So: in production a missing password locks the app instead of opening it. In
 * development it still passes through, because a local checkout without the
 * variable should be usable — and a local checkout is not a deployment.
 */
export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return deny(request, "APP_PASSWORD is not configured");
  }

  const authCookie = request.cookies.get("auth");
  if (authCookie?.value === password) {
    return NextResponse.next();
  }

  // Check if this is a login attempt
  if (
    request.method === "POST" &&
    request.nextUrl.pathname === "/api/auth/login"
  ) {
    return NextResponse.next();
  }

  // Check for auth header (for API routes)
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [, token] = authHeader.split(" ");
    if (token === password) return NextResponse.next();
  }

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
    if (misconfigured) {
      return new NextResponse(`Origio is not configured: ${reason}.`, {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.json({ error: reason }, { status: misconfigured ? 503 : 401 });
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
