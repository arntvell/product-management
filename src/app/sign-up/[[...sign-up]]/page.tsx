import { SignUp } from "@clerk/nextjs";

export const dynamic = "force-dynamic";

/** Where a Clerk invitation lands: it carries the ticket, and SignUp redeems it. */
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ecru p-6">
      <SignUp />
    </main>
  );
}
