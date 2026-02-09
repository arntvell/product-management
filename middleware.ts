import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

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

  // For page requests, redirect to login
  if (!request.nextUrl.pathname.startsWith("/api/")) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // For API requests, return 401
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
