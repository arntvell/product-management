"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { NAV_SECTIONS, type NavLink } from "@/components/layout/nav-model";
import { LividMark } from "@/components/layout/livid-mark";
import { LiveDot } from "@/components/layout/live-dot";

/**
 * The active item is the longest href the current path sits under, so a nested
 * route with no entry of its own — /catalog/brands/[id], say — still lights up
 * the section it belongs to. "/" is matched exactly; it is a prefix of
 * everything.
 */
export function activeHref(pathname: string, items: NavLink[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (item.href === "/") {
      if (pathname === "/") best = "/";
      continue;
    }
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.length) best = item.href;
    }
  }
  return best;
}

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

export function Sidebar() {
  const pathname = usePathname();
  const active = activeHref(pathname, ALL_ITEMS);

  return (
    <aside className="flex h-full w-sidebar shrink-0 flex-col border-r border-line bg-ecru">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-5">
        <LividMark className="h-3 w-auto shrink-0 text-ink" />
        <span className="font-display text-section uppercase leading-none">
          Origo
        </span>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto p-3" aria-label="Main">
        {NAV_SECTIONS.map((section) => (
          <div key={section.id} className="flex flex-col gap-0.5">
            <div className="flex flex-col gap-0.5 px-3 pb-1">
              <div className="flex items-center gap-1.5 text-meta uppercase text-muted-foreground">
                {section.label}
                {section.live && <LiveDot className="text-ink" />}
              </div>
              {section.note && (
                <div className="text-meta normal-case tracking-normal text-subtle">
                  {section.note}
                </div>
              )}
            </div>
            {section.items.map((item) => {
              const on = item.href === active;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    // The active item is an inverted ink block — the button
                    // logic applied to navigation. §6
                    "flex h-10 items-center gap-3 px-3 text-body no-underline transition-colors duration-150 ease-origo",
                    on ? "bg-ink text-offwhite" : "text-ink hover:bg-hover"
                  )}
                >
                  <Icon className="size-[18px] shrink-0" />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.count != null && (
                    <span
                      className={cn(
                        "text-meta tabular-nums",
                        on ? "text-offwhite" : "text-muted-foreground"
                      )}
                    >
                      {item.count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
