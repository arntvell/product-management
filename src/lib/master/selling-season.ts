// Which of a product's seasons it is SELLING in now — the season whose price
// the shop and the till should carry, and the season a push files under.
//
// Every product sits in several seasons (Kai Japan Black: CONTINUITY 2300,
// FW26 2300, SS27 2400). Picking "the first one" read whichever row the database
// returned first: the Sitoo update took SS27's 2400 for a product the shop sells
// at 2300 in FW26 (2026-11-23). This is the one rule every push uses instead.
//
//   1. the current selling season, if the product is in it
//   2. else CONTINUITY — carry-over: an older product still selling at its
//      carried-over price
//   3. else the newest REGULAR season before the current one
//   4. else the earliest upcoming season (not launched yet)
//
// The current selling season follows the calendar — SS January–June, FW
// July–December — unless SELLING_SEASON is set (e.g. "SS27") to switch early or late.
import { seasonSortValue } from "./classify";

export function currentSellingSeason(now: Date = new Date()): string {
  const override = process.env.SELLING_SEASON?.trim().toUpperCase();
  if (override && seasonSortValue(override) != null) return override;
  const yy = String(now.getFullYear() % 100).padStart(2, "0");
  return `${now.getMonth() < 6 ? "SS" : "FW"}${yy}`;
}

/** Pick the selling season from a product's season codes. Null when it has none. */
export function sellingSeasonOf(codes: string[], now: Date = new Date()): string | null {
  const unique = [...new Set(codes.map((c) => c.toUpperCase()))];
  if (!unique.length) return null;
  const current = currentSellingSeason(now);
  const currentVal = seasonSortValue(current)!;
  if (unique.includes(current)) return current;

  const regular = unique
    .map((c) => ({ c, v: seasonSortValue(c) }))
    .filter((x): x is { c: string; v: number } => x.v != null);
  if (unique.includes("CONTINUITY")) return "CONTINUITY";
  const past = regular.filter((x) => x.v < currentVal).sort((a, b) => b.v - a.v);
  if (past.length) return past[0].c;
  const upcoming = regular.filter((x) => x.v > currentVal).sort((a, b) => a.v - b.v);
  if (upcoming.length) return upcoming[0].c;
  return unique[0];
}
