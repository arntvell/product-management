// Managing who may use Origo. Admin-only: the proxy maps /api/users to `admin`.

import { prisma } from "@/lib/db";
import type { UserRole } from "@/generated/prisma/client";

export class UserError extends Error {}

const ROLES: UserRole[] = ["ADMIN", "PRODUCT_MANAGER", "VINTAGE", "VIEWER"];

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: [{ active: "desc" }, { email: "asc" }],
    select: { id: true, email: true, name: true, role: true, active: true, lastSeenAt: true, clerkUserId: true },
  });
}

export async function addUser(input: { email: string; role: string; name?: string | null }) {
  const email = input.email?.trim().toLowerCase() ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError("That is not an email address.");
  if (!email.endsWith("@livid.no"))
    throw new UserError("Origo signs in with Google on @livid.no — use the person's livid.no address.");
  if (!ROLES.includes(input.role as UserRole)) throw new UserError("Choose a role.");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new UserError(`${email} is already on the list${existing.active ? "" : " (deactivated — reactivate it instead)"}.`);
  return prisma.user.create({
    data: { email, role: input.role as UserRole, name: input.name?.trim() || null },
  });
}

/**
 * Change a role or deactivate. The last active admin cannot be demoted or
 * deactivated — that would leave nobody able to manage users.
 */
export async function updateUser(id: string, input: { role?: string; active?: boolean }) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new UserError("User not found.");
  if (input.role !== undefined && !ROLES.includes(input.role as UserRole)) throw new UserError("Unknown role.");
  const losesAdmin =
    user.role === "ADMIN" &&
    user.active &&
    ((input.role !== undefined && input.role !== "ADMIN") || input.active === false);
  if (losesAdmin) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) throw new UserError("This is the last admin — add another admin first.");
  }
  return prisma.user.update({
    where: { id },
    data: {
      ...(input.role !== undefined ? { role: input.role as UserRole } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}
