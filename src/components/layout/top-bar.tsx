"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PlusIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import {
  NAV_SECTIONS,
  NEW_PRODUCT_HREF,
} from "@/components/layout/nav-model";
import { activeHref } from "@/components/layout/sidebar";

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);

/**
 * 56px, hairline under it — the same height the old header had, which is what
 * keeps the nine `h-[calc(100vh-56px)]` pages measuring correctly.
 *
 * It carries where you are on the left and the one action that is available
 * from anywhere on the right. Creating a product was reachable from the
 * catalogue nav before; now it is reachable from every screen.
 */
export function TopBar() {
  const pathname = usePathname();
  const active = activeHref(pathname, ALL_ITEMS);
  const section = NAV_SECTIONS.find((s) =>
    s.items.some((i) => i.href === active)
  );
  const item = ALL_ITEMS.find((i) => i.href === active);

  return (
    <div className="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-ecru px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-meta uppercase text-muted-foreground">
        {section && <span>{section.label}</span>}
        {section && item && <span aria-hidden="true">/</span>}
        {item && <span className="text-ink">{item.label}</span>}
      </div>
      <Link
        href={NEW_PRODUCT_HREF}
        // Outline, not primary: §5 allows one primary action per view and
        // that belongs to the page header. This is the always-available route
        // to it, not the view's own call to action.
        className={buttonVariants({ variant: "outline", size: "sm" })}
      >
        <PlusIcon />
        New product
      </Link>
    </div>
  );
}
