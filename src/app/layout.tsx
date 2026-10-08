import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClerkProvider } from "@clerk/nextjs";
import { CurrentUserProvider } from "@/components/auth/current-user";
import { clerkEnabled, getSessionUser } from "@/lib/auth/session";
import "./globals.css";

// Two families, one weight (400). Display carries page and panel titles in
// caps; Text carries everything else. See PRODUCT-MASTER-DESIGN.md §4.
const formaDisplay = localFont({
  src: "./fonts/FormaDJRLivid-Regular.woff2",
  variable: "--font-forma-display",
  weight: "400",
  style: "normal",
  display: "swap",
});

const formaText = localFont({
  src: "./fonts/FormaDJRLividText-Regular.woff2",
  variable: "--font-forma-text",
  weight: "400",
  style: "normal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Origo",
  description: "Livid product master — import, enrich, price and publish every product",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Clerk only once its keys exist; until then the shared password, and every
  // visitor is the one anonymous admin they always were.
  const withClerk = clerkEnabled();
  const user = await getSessionUser();
  const app = (
    <CurrentUserProvider user={{ email: user.email, role: user.role, signedIn: withClerk && !!user.id }}>
      <QueryProvider>
        <TooltipProvider>
          <AppShell>{children}</AppShell>
          <Toaster />
        </TooltipProvider>
      </QueryProvider>
    </CurrentUserProvider>
  );
  return (
    <html lang="en">
      <body
        className={`${formaDisplay.variable} ${formaText.variable} antialiased`}
      >
        {withClerk ? <ClerkProvider>{app}</ClerkProvider> : app}
      </body>
    </html>
  );
}
