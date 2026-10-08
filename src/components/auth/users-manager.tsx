"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { UserRole } from "@/generated/prisma/client";

const ROLES: UserRole[] = ["ADMIN", "PRODUCT_MANAGER", "VINTAGE", "VIEWER"];

const ROLE_HINTS: Record<UserRole, string> = {
  ADMIN: "Everything, including merges, splits, deletes and users",
  PRODUCT_MANAGER: "Products, imports, brands, categories, pushes",
  VINTAGE: "Vintage drops: garments, photos, prices, reveal, push",
  VIEWER: "Read-only",
};

interface Row {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  active: boolean;
  lastSeenAt: string | null;
  clerkUserId: string | null;
}

export function UsersManager({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("PRODUCT_MANAGER");
  const [busy, setBusy] = useState(false);

  async function send(url: string, method: string, body: object, ok: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed");
      toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <form
        className="flex flex-wrap items-end gap-2 border p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send("/api/users", "POST", { email, role }, `Added ${email}`)) setEmail("");
        }}
      >
        <div className="min-w-[16rem] flex-1">
          <label className="text-fine text-muted-foreground" htmlFor="u-email">
            Email (@livid.no)
          </label>
          <Input id="u-email" className="mt-1" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@livid.no" />
        </div>
        <div>
          <label className="text-fine text-muted-foreground" htmlFor="u-role">
            Role
          </label>
          <select
            id="u-role"
            className="mt-1 h-9 border bg-transparent px-3 text-body"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={busy || !email.trim()}>
          Add user
        </Button>
        <p className="w-full text-fine text-muted-foreground">{ROLE_HINTS[role]}.</p>
      </form>

      <div className="border">
        {initial.map((u) => (
          <div
            key={u.id}
            className={"flex flex-wrap items-center gap-3 border-b px-4 py-2 last:border-0 " + (u.active ? "" : "opacity-50")}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-body">{u.name ?? u.email}</div>
              <div className="truncate text-fine text-muted-foreground">
                {u.email} ·{" "}
                {u.clerkUserId
                  ? u.lastSeenAt
                    ? `last seen ${new Date(u.lastSeenAt).toLocaleString("nb-NO")}`
                    : "signed in"
                  : "not signed in yet"}
              </div>
            </div>
            <select
              className="h-8 border bg-transparent px-2 text-fine"
              defaultValue={u.role}
              disabled={busy}
              onChange={(e) => void send(`/api/users/${u.id}`, "PUT", { role: e.target.value }, `${u.email} is now ${ROLE_LABELS[e.target.value as UserRole]}`)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <button
              className="text-fine underline underline-offset-4"
              disabled={busy}
              onClick={() =>
                void send(`/api/users/${u.id}`, "PUT", { active: !u.active }, u.active ? `${u.email} deactivated` : `${u.email} reactivated`)
              }
            >
              {u.active ? "Deactivate" : "Reactivate"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
