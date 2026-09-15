// Resolving a colorway's customs block, and shaping it for Shopify.
//
// Shopify has never received any of this. The only `inventoryItem` sub-field
// written anywhere in this codebase is `sku`; HS code, country of origin and
// weight exist in the master and go to Loom alone. Two rules make adding them
// safe on a channel with 4,584 live colorways:
//
//   Never emit null. Omission means "leave what Shopify holds alone" — the same
//   policy clearEmptied already applies to metafields. productSet is
//   declarative, so a null would blank a value a merchant may have set.
//
//   Never guess a country. `countryCodeOfOrigin` is an ISO-3166-1 alpha-2 ENUM,
//   and a bad value makes Shopify reject the entire mutation — it would take the
//   whole product push down, not just the customs field. An unresolved country
//   is omitted and warned about.

export interface CustomsSource {
  hsCodeOverride?: string | null;
  customsDescriptionOverride?: string | null;
  weightKgOverride?: { toString(): string } | null;
  fiberCompositionOverride?: string | null;
  countryOfOrigin?: string | null;
  style?: {
    hsCode?: string | null;
    customsDescription?: string | null;
    weightKg?: { toString(): string } | null;
    fiberComposition?: string | null;
  } | null;
}

export interface CustomsBlock {
  hsCode: string | null;
  customsDescription: string | null;
  weightKg: number | null;
  fiberComposition: string | null;
  countryCode: string | null;
  /** The raw country we could not resolve, so the caller can warn rather than guess. */
  countryUnresolved: string | null;
}

function has(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

/** Colorway override -> style, the same precedence loom/payload.ts uses. */
export function resolveCustoms(cw: CustomsSource): CustomsBlock {
  const weightRaw = cw.weightKgOverride ?? cw.style?.weightKg ?? null;
  const weight = weightRaw ? Number(weightRaw.toString()) : null;
  const rawCountry = has(cw.countryOfOrigin);
  const code = normalizeCountryCode(rawCountry);
  return {
    hsCode: has(cw.hsCodeOverride) ?? has(cw.style?.hsCode),
    customsDescription:
      has(cw.customsDescriptionOverride) ?? has(cw.style?.customsDescription),
    weightKg: weight !== null && Number.isFinite(weight) && weight > 0 ? weight : null,
    fiberComposition:
      has(cw.fiberCompositionOverride) ?? has(cw.style?.fiberComposition),
    countryCode: code,
    countryUnresolved: rawCountry && !code ? rawCountry : null,
  };
}

/**
 * Free text -> ISO-3166-1 alpha-2.
 *
 * Deliberately small and exact. A fuzzy matcher here would eventually send
 * Shopify a wrong-but-valid country, which is worse than sending none: the
 * product would publish with a customs declaration nobody checked.
 */
const COUNTRY_CODES: Record<string, string> = {
  norway: "NO", norge: "NO", no: "NO",
  sweden: "SE", sverige: "SE", se: "SE",
  denmark: "DK", danmark: "DK", dk: "DK",
  finland: "FI", fi: "FI",
  italy: "IT", italia: "IT", it: "IT",
  portugal: "PT", pt: "PT",
  spain: "ES", espana: "ES", es: "ES",
  france: "FR", fr: "FR",
  germany: "DE", deutschland: "DE", de: "DE",
  netherlands: "NL", holland: "NL", nl: "NL",
  belgium: "BE", be: "BE",
  austria: "AT", at: "AT",
  switzerland: "CH", ch: "CH",
  poland: "PL", pl: "PL",
  romania: "RO", ro: "RO",
  bulgaria: "BG", bg: "BG",
  turkey: "TR", turkiye: "TR", tr: "TR",
  greece: "GR", gr: "GR",
  "united kingdom": "GB", uk: "GB", "great britain": "GB", england: "GB", gb: "GB",
  ireland: "IE", ie: "IE",
  "united states": "US", usa: "US", "united states of america": "US", us: "US",
  canada: "CA", ca: "CA",
  mexico: "MX", mx: "MX",
  japan: "JP", jp: "JP",
  china: "CN", "peoples republic of china": "CN", cn: "CN",
  india: "IN", in: "IN",
  vietnam: "VN", "viet nam": "VN", vn: "VN",
  indonesia: "ID", id: "ID",
  thailand: "TH", th: "TH",
  cambodia: "KH", kh: "KH",
  bangladesh: "BD", bd: "BD",
  "south korea": "KR", korea: "KR", kr: "KR",
  taiwan: "TW", tw: "TW",
  "hong kong": "HK", hongkong: "HK", hk: "HK",
  macau: "MO", macao: "MO", mo: "MO",
  singapore: "SG", sg: "SG",
  philippines: "PH", ph: "PH",
  "sri lanka": "LK", lk: "LK",
  pakistan: "PK", pk: "PK",
  myanmar: "MM", burma: "MM", mm: "MM",
  estonia: "EE", ee: "EE",
  latvia: "LV", lv: "LV",
  lithuania: "LT", lt: "LT",
  czechia: "CZ", "czech republic": "CZ", cz: "CZ",
  slovakia: "SK", sk: "SK",
  slovenia: "SI", si: "SI",
  croatia: "HR", hr: "HR",
  hungary: "HU", hu: "HU",
  morocco: "MA", ma: "MA",
  tunisia: "TN", tn: "TN",
  peru: "PE", pe: "PE",
  brazil: "BR", br: "BR",
  australia: "AU", au: "AU",
  "new zealand": "NZ", nz: "NZ",
};

export function normalizeCountryCode(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  const key = t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return COUNTRY_CODES[key] ?? null;
}

export interface InventoryItemCustomsInput {
  harmonizedSystemCode?: string;
  countryCodeOfOrigin?: string;
  measurement?: { weight: { unit: "KILOGRAMS"; value: number } };
}

/** Only the keys we actually have. Never null — see the note at the top. */
export function toInventoryItemInput(c: CustomsBlock): InventoryItemCustomsInput {
  return {
    ...(c.hsCode ? { harmonizedSystemCode: c.hsCode } : {}),
    ...(c.countryCode ? { countryCodeOfOrigin: c.countryCode } : {}),
    ...(c.weightKg
      ? { measurement: { weight: { unit: "KILOGRAMS" as const, value: c.weightKg } } }
      : {}),
  };
}

/** True when the master has nothing to say and the write would be a no-op. */
export function isEmptyCustoms(c: CustomsBlock): boolean {
  return !c.hsCode && !c.countryCode && c.weightKg === null;
}
