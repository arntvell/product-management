import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  BadgeCheck,
  Barcode,
  Boxes,
  CalendarRange,
  Copy,
  FilePen,
  FolderTree,
  Image,
  Layers,
  LayoutGrid,
  Package,
  PencilLine,
  Rows3,
  Ruler,
  ScanSearch,
  Search,
  Share2,
  Shirt,
  Signature,
  Split,
  Tag,
  User,
  Wrench,
} from "lucide-react";

// Every destination the old horizontal header and the catalogue nav could
// reach, in one place. The catalogue nav's own grouping is kept — it was
// already the right division of the work — and the header's five top-level
// pages fold in beside it.
//
// `count` is reserved for work waiting (missing data, errors); §6 says a
// number on a nav item means something needs doing, so leave it undefined
// until there is a real figure behind it.
export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export interface NavSection {
  id: string;
  label: string;
  /** One line under the section label. Used to say what a section touches. */
  note?: string;
  /** Marks a section whose screens write to a live external system. */
  live?: boolean;
  items: NavLink[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "work",
    label: "Catalogue",
    items: [
      { href: "/catalog", label: "Overview", icon: LayoutGrid },
      { href: "/catalog/collections", label: "Collections", icon: Layers },
      { href: "/catalog/drops", label: "Drops", icon: CalendarRange },
      { href: "/catalog/vintage", label: "Vintage", icon: Shirt },
      { href: "/catalog/edit", label: "Bulk editor", icon: PencilLine },
      { href: "/catalog/variants", label: "Variant editor", icon: Rows3 },
      { href: "/catalog/products/drafts", label: "Drafts", icon: FilePen },
      { href: "/catalog/publishing", label: "Publishing", icon: Share2 },
    ],
  },
  {
    id: "settings",
    label: "Product settings",
    items: [
      { href: "/catalog/brands", label: "Brands", icon: Tag },
      {
        href: "/catalog/brands/identity",
        label: "Brand identity",
        icon: Signature,
      },
      { href: "/catalog/categories", label: "Categories", icon: FolderTree },
      { href: "/catalog/size-systems", label: "Size systems", icon: Ruler },
    ],
  },
  {
    id: "repair",
    label: "Data repair",
    items: [
      { href: "/catalog/fix", label: "Fix", icon: Wrench },
      { href: "/catalog/lookup", label: "Look up", icon: Search },
      { href: "/catalog/import-gaps", label: "Import gaps", icon: ScanSearch },
      { href: "/catalog/skus", label: "SKUs", icon: Barcode },
      { href: "/catalog/duplicates", label: "Duplicates", icon: Copy },
      { href: "/catalog/style-splits", label: "Style splits", icon: Split },
      { href: "/catalog/cutover", label: "Cutover", icon: ArrowRightLeft },
      { href: "/catalog/identity", label: "Identity", icon: BadgeCheck },
    ],
  },
  {
    id: "shopify",
    label: "Shopify",
    note: "Writes to the live store",
    live: true,
    // What the product master replaced: the metafield manager this app grew
    // out of. These screens are still useful, but they read and write the
    // Shopify store directly rather than the master — editing here changes
    // the live store immediately, with no push step in between.
    //
    // That includes Models. It writes metaobjects rather than products, so it
    // changes reference data instead of a listing, but it is a live write all
    // the same.
    items: [
      { href: "/", label: "Products", icon: Package },
      { href: "/groups", label: "Groups", icon: Boxes },
      { href: "/media", label: "Media", icon: Image },
      { href: "/models", label: "Models", icon: User },
    ],
  },
];

/** The one action that is always available, wherever you are. */
export const NEW_PRODUCT_HREF = "/catalog/products/new";
