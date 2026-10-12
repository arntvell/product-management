// Who may do what. One table, read by the proxy (every API write) and by pages
// (which controls to show) — so the screen and the server cannot disagree.
//
// Reading is open to every signed-in role. Writes are grouped by what they touch:
//
//   vintage   the vintage drop sheet and its routes        ADMIN, PM, VINTAGE
//   catalog   Livid and external products, imports,        ADMIN, PM
//             brands, categories, size systems, pushes
//   admin     merges, splits, deletes, bulk repairs,       ADMIN
//             user management
//
// An API write that is not listed falls to `catalog`: a new route is closed to
// Vintage and Viewer until someone decides otherwise, never open by omission.

import type { UserRole } from "@/generated/prisma/client";

export type Permission = "read" | "vintage" | "catalog" | "admin";

const ALLOWED: Record<Permission, readonly UserRole[]> = {
  read: ["ADMIN", "PRODUCT_MANAGER", "VINTAGE", "VIEWER"],
  vintage: ["ADMIN", "PRODUCT_MANAGER", "VINTAGE"],
  catalog: ["ADMIN", "PRODUCT_MANAGER"],
  admin: ["ADMIN"],
};

export function can(role: UserRole, permission: Permission): boolean {
  return ALLOWED[permission].includes(role);
}

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Admin",
  PRODUCT_MANAGER: "Product manager",
  VINTAGE: "Vintage",
  VIEWER: "Viewer",
};

/**
 * Routes whose POST only reads — a lookup that needs a body. Open to every role.
 */
const READ_ONLY_POSTS = [
  /^\/api\/catalog\/brands\/check-name$/,
  /^\/api\/catalog\/drafts\/[^/]+\/preflight$/,
  /^\/api\/catalog\/skus\/validate$/,
  /^\/api\/catalog\/style-splits\/verify$/,
  /^\/api\/files\/nodes$/,
];

/** Admin-only writes: merges, splits, deletes and bulk repairs. */
const ADMIN_ROUTES = [
  /^\/api\/users(\/|$)/,
  /^\/api\/catalog\/brands\/merge$/,
  /^\/api\/catalog\/categories\/merge$/,
  /^\/api\/catalog\/colorways\/merge$/,
  /^\/api\/catalog\/style-splits\//,
  /^\/api\/catalog\/cleanup-orphans$/,
  /^\/api\/catalog\/import\/shopify\/remove$/,
  /^\/api\/catalog\/import\/cin7$/,
  /^\/api\/catalog\/enrich\//,
  /^\/api\/catalog\/normalize(\/|$)/,
  /^\/api\/catalog\/classify(-kind)?$/,
  /^\/api\/catalog\/channels\/reconcile$/,
  /^\/api\/catalog\/barcodes\/ledger$/,
  /^\/api\/catalog\/sync$/,
  /^\/api\/catalog\/lock$/,
];

/**
 * Routes the vintage drop sheet calls. The two general push routes are listed
 * because the sheet publishes through them; their handlers additionally refuse
 * a VINTAGE caller anything that is not a vintage garment (assertVintageOnly).
 */
const VINTAGE_ROUTES = [
  /^\/api\/vintage\//,
  /^\/api\/catalog\/push\/loom$/,
  /^\/api\/catalog\/push\/shopify\/bulk$/,
];

/** What an API request needs. Pages are reads; their controls ask `can()`. */
export function permissionFor(pathname: string, method: string): Permission {
  // Who has access is itself private: even reading the user list is admin-only.
  if (/^\/api\/users(\/|$)/.test(pathname)) return "admin";
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return "read";
  if (READ_ONLY_POSTS.some((r) => r.test(pathname))) return "read";
  // Deleting a product is admin-only. Deleting an image or discarding a draft
  // is everyday product work and stays with `catalog`.
  if (method === "DELETE" && /^\/api\/catalog\/colorways\/[^/]+$/.test(pathname)) return "admin";
  if (ADMIN_ROUTES.some((r) => r.test(pathname))) return "admin";
  if (VINTAGE_ROUTES.some((r) => r.test(pathname))) return "vintage";
  return "catalog";
}

/** "Your role (Vintage) can't …" — what a refused request says. */
export function refusal(role: UserRole, permission: Permission): string {
  const what: Record<Permission, string> = {
    read: "view this",
    vintage: "change vintage drops",
    catalog: "change the catalogue",
    admin: "do this — it is admin-only",
  };
  return `Your role (${ROLE_LABELS[role]}) can't ${what[permission]}.`;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** Pages that are purely for changing things — no use to a role that cannot. */
const PAGE_RULES: Array<[RegExp, Permission]> = [
  [/^\/catalog\/users(\/|$)/, "admin"],
  // Data repair: bulk tools over the whole master.
  [/^\/catalog\/(fix|import-gaps|skus|duplicates|style-splits|cutover|identity)(\/|$)/, "admin"],
  // Creating, importing, publishing, and the variant and season-drop editors.
  [/^\/catalog\/products(\/|$)/, "catalog"],
  [/^\/catalog\/(publishing|variants|drops)(\/|$)/, "catalog"],
  [/^\/catalog\/colorways\/[^/]+\/media(\/|$)/, "catalog"],
  // The original Shopify screens write to the live store directly.
  [/^\/(groups|media|models|collections)?$/, "catalog"],
  [/^\/(groups|media|models|collections)\//, "catalog"],
];

/** What opening a page needs. Everything not listed is readable by every role. */
export function pagePermission(pathname: string): Permission {
  for (const [re, p] of PAGE_RULES) if (re.test(pathname)) return p;
  return "read";
}

/** Where a role lands when it opens a page it cannot use. */
export function roleHome(role: UserRole): string {
  if (role === "VINTAGE") return "/catalog/vintage";
  if (role === "VIEWER") return "/catalog";
  return "/";
}
