import { SignOutButton } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

/** Signed in with Google, but not added to Origo (or deactivated). */
export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ecru p-6">
      <div className="max-w-md space-y-3 border border-ink bg-paper p-6">
        <h1 className="text-page">No access yet</h1>
        <p className="text-body text-muted-foreground">
          You are signed in, but your account has not been added to Origo. Ask an admin to add
          your email on the Users page, then sign in again.
        </p>
        <SignOutButton>
          <button className="text-fine underline underline-offset-4">Sign out</button>
        </SignOutButton>
      </div>
    </main>
  );
}
