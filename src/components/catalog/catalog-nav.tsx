"use client";

import Link from "next/link";
import { ChevronDownIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const BUTTON_CLASS =
  "rounded-md border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors hover:bg-muted";

const PRIMARY_LINKS = [
  { href: "/catalog/collections", label: "Collections" },
  { href: "/catalog/drops", label: "Drops" },
  { href: "/catalog/edit", label: "Bulk editor" },
  { href: "/catalog/publishing", label: "Publishing" },
];

const PRODUCT_SETTINGS = [
  { href: "/catalog/brands", label: "Brands" },
  { href: "/catalog/categories", label: "Categories" },
  { href: "/catalog/size-systems", label: "Size systems" },
];

const DATA_REPAIR_TOOLS = [
  { href: "/catalog/fix", label: "Fix" },
  { href: "/catalog/lookup", label: "Look up" },
  { href: "/catalog/import-gaps", label: "Import gaps" },
  { href: "/catalog/skus", label: "SKUs" },
  { href: "/catalog/duplicates", label: "Duplicates" },
  { href: "/catalog/style-splits", label: "Style splits" },
  { href: "/catalog/cutover", label: "Cutover" },
  { href: "/catalog/identity", label: "Identity" },
];

function NavMenu({
  label,
  items,
}: {
  label: string;
  items: { href: string; label: string }[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={`${BUTTON_CLASS} inline-flex items-center gap-1.5`}
      >
        {label}
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href} className="cursor-pointer">
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CatalogNav() {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {PRIMARY_LINKS.map((item) => (
        <Link key={item.href} href={item.href} className={BUTTON_CLASS}>
          {item.label}
        </Link>
      ))}
      <NavMenu label="Product Settings" items={PRODUCT_SETTINGS} />
      <NavMenu label="Data Repair Tools" items={DATA_REPAIR_TOOLS} />
      <Link
        href="/catalog/products/new"
        className="rounded-md border bg-foreground px-3 py-1.5 text-sm font-medium whitespace-nowrap text-background transition-opacity hover:opacity-90"
      >
        + New product
      </Link>
    </div>
  );
}
