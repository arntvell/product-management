"use client";

import { createContext, useContext } from "react";
import type { UserRole } from "@/generated/prisma/client";
import { can, type Permission } from "@/lib/auth/permissions";

export interface CurrentUser {
  email: string | null;
  role: UserRole;
  /** False in shared-password mode — no person to show. */
  signedIn: boolean;
}

const Ctx = createContext<CurrentUser>({ email: null, role: "ADMIN", signedIn: false });

export function CurrentUserProvider({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return <Ctx.Provider value={user}>{children}</Ctx.Provider>;
}

export function useCurrentUser(): CurrentUser {
  return useContext(Ctx);
}

/** Whether the signed-in role may do this — for showing or hiding a control. */
export function useCan(permission: Permission): boolean {
  return can(useContext(Ctx).role, permission);
}
