import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { Header } from "@/components/layout/header";
import { TooltipProvider } from "@/components/ui/tooltip";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${formaDisplay.variable} ${formaText.variable} antialiased`}
      >
        <QueryProvider>
          <TooltipProvider>
            <Header />
            {children}
            <Toaster />
          </TooltipProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
