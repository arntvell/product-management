import { cn } from "@/lib/utils";

// Kept out of tabs.tsx, which is a client component: several of our filters
// are <Link>s in server components, because the filter lives in the URL. A
// client module's exports cannot be called from the server, and a tab that
// looks different depending on who rendered it is a tab that will drift.

export const tabListClass = "flex gap-6 overflow-x-auto border-b border-line";

export function tabItemClass(active: boolean, className?: string) {
  return cn(
    "-mb-px flex h-10 shrink-0 items-center gap-2 border-b-2 text-meta uppercase no-underline transition-colors duration-150 ease-origo",
    active
      ? "border-ink text-ink"
      : "border-transparent text-muted-foreground hover:text-ink",
    className
  );
}
