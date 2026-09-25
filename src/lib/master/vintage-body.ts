// The three body-HTML templates for an online vintage garment.
//
// These are customer-facing copy that has been live for years, so they are not
// retyped: each was read verbatim off a product the spreadsheet built, on
// 2026-09-25, and the sources are named below. Whitespace inside the tags is
// part of the copy — `<strong>Chest width </strong>` really does carry that
// trailing space, and template 3's heading really is followed by a space then
// `<br>`. Do not tidy them.
//
// Which template applies is decided exactly as the sheet's `1. EXPORT
// SHOPIFY`!C2 formula decides it:
//
//   Type mål = 1                          -> tops      (chest + front length)
//   Type mål ≠ 1, Approx size blank       -> trousers  (waist + rise + inseam)
//   Type mål ≠ 1, Approx size set         -> jeans     (+ size translation)

/** Shared by the tops and trousers templates. Verbatim from `13762-vintage`. */
const HOT_TIP =
  "<p><strong>Hot tip for buying vintage online</strong><br>Please be aware that sizes and fits vary greatly from brand to brand, and decade to decade. Instead of just following the garments' S/M/L labels, we recommend comparing the garments' measurements with a similar product you own and know fits you.</p>";

/** Jeans only. Verbatim from `13040-vintage`. */
const JEANS_NOTE =
  "<p><strong>Important note for buying vintage jeans online</strong> <br>Please be aware that sizes and fits vary greatly from brand to brand, and decade to decade. Vintage Levi's jeans specifically were measured in a different way than how we measure jeans now, which results in the general rule of sizing up two sizes when buying vintage jeans.</p>" +
  "<p>Vintage size 28 for example, will fit like a modern 26. But this isn't always the case!</p>" +
  "<p>To help you find the right size, we translate the waist measurements to standardized contemporary jeans sizes, but we always recommend comparing the measurements to a jean that fits you well at home. This will also give you valuable information about the height of the rise, and the length of the jeans.</p>";

export type VintageBodyShape = "tops" | "trousers" | "jeans";

export interface VintageBodyInput {
  /** Beskrivelse — the free copy that opens the body. */
  description: string;
  /** Type mål. `1` means a top; anything else is a bottom. */
  measurementType: string | number;
  /** Approx size — its presence turns a bottom into the jeans template. */
  approxSize?: string | null;
  /** Størrelse — the size on the garment's own label. */
  taggedSize?: string | null;
  chestWidth?: string | number | null;
  frontLength?: string | number | null;
  waist?: string | number | null;
  frontRise?: string | number | null;
  inseam?: string | number | null;
}

/** Which of the three templates this garment takes. */
export function vintageBodyShape(i: {
  measurementType: string | number;
  approxSize?: string | null;
}): VintageBodyShape {
  if (String(i.measurementType).trim() === "1") return "tops";
  return i.approxSize?.trim() ? "jeans" : "trousers";
}

/**
 * The measurements each shape requires. Used by the validator — a bottom with
 * no waist produced `<strong>Waist </strong> cm` on the live store (see
 * `9309-vintage`, a bandana that took the trousers template with every
 * measurement blank). That is the silent failure this module replaces, so the
 * fields are declared here rather than inferred from whether they happen to be
 * filled in.
 */
export const REQUIRED_MEASUREMENTS: Record<VintageBodyShape, string[]> = {
  tops: ["chestWidth", "frontLength"],
  trousers: ["waist", "frontRise", "inseam"],
  jeans: ["waist", "frontRise", "inseam"],
};

function esc(s: string): string {
  // Only what HTML text content actually requires. Escaping apostrophes to
  // entities would render the same but diverge byte-for-byte from four years
  // of live bodies, which is the thing we diff against.
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

const cm = (v: unknown) => `${String(v ?? "").trim()} cm`;

/** Build the Shopify body HTML. */
export function buildVintageBody(i: VintageBodyInput): string {
  const shape = vintageBodyShape(i);
  const intro = `<p>${esc(i.description.trim())}</p>`;

  if (shape === "tops")
    return (
      intro +
      `<p><strong>Chest width </strong>${cm(i.chestWidth)}<br>` +
      `<strong>Front Length </strong>${cm(i.frontLength)}</p>` +
      HOT_TIP
    );

  if (shape === "trousers")
    return (
      intro +
      `<p><strong>Waist </strong>${cm(i.waist)}<br>` +
      `<strong>Front rise </strong>${cm(i.frontRise)}<br>` +
      `<strong>Inseam Length </strong>${cm(i.inseam)}</p>` +
      HOT_TIP
    );

  return (
    intro +
    `<p><strong>Standardized contemporary size: </strong>${esc(String(i.approxSize ?? "").trim())}<br>` +
    `<strong>Tagged size: </strong>${esc(String(i.taggedSize ?? "").trim())}<br>` +
    `<strong>Waist </strong>${cm(i.waist)}<br>` +
    `<strong>Front rise </strong>${cm(i.frontRise)}<br>` +
    `<strong>Inseam Length </strong>${cm(i.inseam)}</p>` +
    JEANS_NOTE
  );
}
