"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Products" },
  { href: "/groups", label: "Groups" },
  { href: "/models", label: "Models" },
  { href: "/media", label: "Media" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background sticky top-0 z-50">
      <div className="flex h-14 items-center px-6 gap-6">
        <h1 className="text-lg font-semibold">Metafield Manager</h1>
        <nav className="flex gap-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "text-sm font-medium transition-colors hover:text-foreground",
                pathname === item.href
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
