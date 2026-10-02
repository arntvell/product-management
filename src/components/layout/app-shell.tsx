"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

/** Screens that get no application chrome — you are not inside the app yet. */
const BARE_ROUTES = ["/login"];

/**
 * §5: a 232px sidebar, a 56px top bar, and a scrolling main.
 *
 * `main` scrolls rather than the document, so the sidebar stays put on a long
 * grid. The five virtualized tables each scroll their own inner container and
 * measure it by ref, so none of them is affected by the change. The top bar
 * keeps the old header's 56px exactly, which is what the nine pages sized
 * `h-[calc(100vh-56px)]` are measuring against.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (BARE_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`))) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen bg-ecru font-sans text-body text-ink">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
