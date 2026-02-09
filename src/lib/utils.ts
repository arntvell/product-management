import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract numeric ID from a Shopify GID like "gid://shopify/Product/123" */
export function extractId(gid: string): string {
  return gid.split("/").pop() || gid;
}

/** Build a Shopify GID from a numeric ID */
export function toProductGid(id: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/Product/${id}`;
}

/** Parse a JSON array of GIDs, returning empty array on failure */
export function parseGidList(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Serialize a list of GIDs to JSON */
export function serializeGidList(gids: string[]): string {
  return JSON.stringify(gids);
}
