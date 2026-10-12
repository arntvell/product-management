"use client";

import { useCan, useCurrentUser } from "./current-user";
import { ROLE_LABELS, type Permission } from "@/lib/auth/permissions";

/**
 * Read-only for a role that cannot change what this page shows.
 *
 * A disabled <fieldset> switches off every input, select, textarea and button
 * inside it at once, so a page does not need each control checked by hand —
 * and a control added later is covered without anyone remembering to. Links
 * still work, so the page can be read and navigated. The server refuses the
 * writes regardless (proxy.ts); this is the screen agreeing with it.
 */
export function EditGate({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const allowed = useCan(permission);
  const { role } = useCurrentUser();
  if (allowed) return <>{children}</>;
  return (
    <>
      <p className="mx-auto max-w-6xl px-6 pt-4 text-fine text-muted-foreground">
        Read-only — your role ({ROLE_LABELS[role]}) can view this page but not change it.
      </p>
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </>
  );
}
