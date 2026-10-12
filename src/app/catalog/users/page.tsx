import { listUsers } from "@/lib/auth/users";
import { clerkEnabled, getSessionUser } from "@/lib/auth/session";
import { UsersManager } from "@/components/auth/users-manager";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await getSessionUser();
  if (me.role !== "ADMIN")
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <h1 className="text-page">Users</h1>
        <p className="mt-2 text-body text-muted-foreground">Only an admin can manage users.</p>
      </main>
    );
  const users = await listUsers();
  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-page">Users</h1>
      <p className="mt-1 text-body text-muted-foreground">
        Who may use Origo, and as what. Adding someone emails them an invitation; they sign in
        with Google (livid.no) or a code sent to their address. Only the addresses listed here
        get in.
        {clerkEnabled()
          ? ""
          : " Sign-in is not switched on yet — the shared password still applies until Clerk is configured."}
      </p>
      <UsersManager
        initial={users.map((u) => ({ ...u, lastSeenAt: u.lastSeenAt?.toISOString() ?? null }))}
      />
    </main>
  );
}
