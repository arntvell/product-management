// The shoot planner's rules, shared by the server read (lib/master/shoot.ts)
// and the screen, which re-derives a row after an upload or a status change.

import type { ShootStatus } from "@/generated/prisma/client";

export type ShootBucket =
  /** No media, in stock — shoot these. */
  | "shoot"
  /** No media, no stock — waiting on something; the row's reason says what. */
  | "waiting"
  /** Media, but nothing to sell yet. */
  | "early"
  /** Media and stock. */
  | "done";

export const BUCKET_LABELS: Record<ShootBucket, string> = {
  shoot: "Ready to shoot",
  waiting: "Waiting",
  early: "Shot, no stock",
  done: "Done",
};

export const PLAN_LABELS: Record<ShootStatus, string> = {
  SHOOT: "Shoot",
  BOOKED: "Booked",
  SHOT: "Shot, uploading",
  SKIP: "Skip",
};

export function bucketFor(hasMedia: boolean, stock: number | null, cancelled: boolean): ShootBucket {
  const inStock = (stock ?? 0) > 0;
  if (hasMedia) return inStock ? "done" : "early";
  return inStock && !cancelled ? "shoot" : "waiting";
}

/** A person's status wins; without one, a product with no images and stock is on the list. */
export function isOnShotList(plan: ShootStatus | null, bucket: ShootBucket): boolean {
  if (plan === "SHOOT" || plan === "BOOKED") return true;
  if (plan === "SHOT" || plan === "SKIP") return false;
  return bucket === "shoot";
}
