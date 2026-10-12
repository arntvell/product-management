// Clerk invitations, sent from Origo's Users page.
//
// Clerk runs Invite-only (the allowlist is a paid feature), so nobody can sign
// up without an invitation — including livid.no staff on Google. Adding a person
// in Origo sends it, so who-may-sign-in (Clerk) and with-what-role (the User
// table) are decided in one place.

import { clerkClient } from "@clerk/nextjs/server";
import { clerkEnabled } from "./session";

export type InviteResult =
  | { sent: true }
  | { sent: false; reason: string };

/**
 * Invite an address to sign up. The link lands on Origo's /sign-up, which takes
 * Clerk's invitation ticket and lets them finish with Google or an emailed code.
 */
export async function sendInvitation(email: string, origin: string): Promise<InviteResult> {
  if (!clerkEnabled())
    return { sent: false, reason: "sign-in is not switched on yet, so no invitation was sent" };
  try {
    await (await clerkClient()).invitations.createInvitation({
      emailAddress: email,
      redirectUrl: `${origin}/sign-up`,
      notify: true,
      // A resend replaces a pending invitation rather than failing on it.
      ignoreExisting: true,
    });
    return { sent: true };
  } catch (err) {
    const text = JSON.stringify((err as { errors?: unknown }).errors ?? String(err));
    if (/identifier_exists|already exists/i.test(text))
      return { sent: false, reason: "they already have a login — they can sign in directly" };
    return { sent: false, reason: `Clerk refused the invitation: ${text.slice(0, 200)}` };
  }
}
