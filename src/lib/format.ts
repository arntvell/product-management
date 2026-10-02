// Norwegian number formatting, per PRODUCT-MASTER-DESIGN.md §4 and §10.

/** 2500 -> "2 500,- NOK" (thin-space thousands). */
export function formatNOK(value: number, withCurrency = true): string {
  const n = Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return withCurrency ? `${n},- NOK` : `${n},-`;
}

/** 0.5234 -> "52,3 %" */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits).replace(".", ",")} %`;
}

/** Dates are DD.MM.YYYY. */
export function formatDate(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Dates keep the §4 format; the time is appended where "which did I touch
 *  last" is the question being asked, as on a list of work in progress. */
export function formatDateTime(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
