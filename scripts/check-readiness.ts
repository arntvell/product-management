// Pure-function checks for the Shopify readiness gate. No database, no network:
//
//   npx tsx scripts/check-readiness.ts
//
// The gate decides what may go live in front of a customer, and the badge and
// the push both read it — drift between them is the thing readiness.ts exists to
// prevent. These pin the three profiles and the create-vs-update split.
//
// Written when the care page and the fit guide stopped being gate conditions
// (2026-10-15), because nothing covered the module at all.

import {
  readinessProfileFor,
  shopifyBlockingMissing,
  shopifyMissing,
  shopifyRefusing,
} from "@/lib/master/readiness";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`
  );
};

// --- the profile ------------------------------------------------------------
eq("Livid's own brand is mainline", readinessProfileFor({ name: "Livid", isLivid: true }), "mainline");
eq("a resold brand is external", readinessProfileFor({ name: "Paraboot", isLivid: false }), "external");
eq("vintage is vintage", readinessProfileFor({ name: "Vintage", isLivid: false }), "vintage");
// Vintage carries isLivid false in production, but the name decides either way —
// the two flags must not be able to disagree into a third answer.
eq("vintage wins over the Livid flag", readinessProfileFor({ name: "vintage", isLivid: true }), "vintage");
eq("the brand name is matched however it is cased", readinessProfileFor({ name: "  VINTAGE ", isLivid: false }), "vintage");
eq("no brand at all is external, not mainline", readinessProfileFor(null), "external");

// --- what blocks a create ----------------------------------------------------
const complete = {
  hasVariants: true,
  hasPrice: true,
  description: "A jacket.",
  hasImage: true,
  hasTags: true,
  swatchHex: "#102030",
};

eq("a complete mainline product is ready", shopifyMissing({ ...complete, profile: "mainline" }), []);
eq("a complete external is ready", shopifyMissing({ ...complete, profile: "external" }), []);
eq("a complete vintage garment is ready", shopifyMissing({ ...complete, profile: "vintage" }), []);
eq("no profile given behaves as mainline", shopifyMissing(complete), []);

// The five that decide whether a customer should see the page at all. These are
// the gate; everything else was advisory dressed up as a blocker.
eq(
  "an empty mainline product lists every gap",
  shopifyMissing({ hasVariants: false, hasPrice: false, description: null, hasImage: false, hasTags: false, swatchHex: null, profile: "mainline" }),
  ["variants", "price", "description", "image", "tags", "swatch"]
);
eq(
  "an external is not judged on its swatch",
  shopifyMissing({ ...complete, swatchHex: null, profile: "external" }),
  []
);
eq(
  "...nor is vintage",
  shopifyMissing({ ...complete, swatchHex: null, profile: "vintage" }),
  []
);
eq(
  "but Livid's own production is",
  shopifyMissing({ ...complete, swatchHex: null, profile: "mainline" }),
  ["swatch"]
);

// The care page and the fit guide are gone from the gate entirely. They are
// still edited and still pushed — they simply never block a publish, on any
// profile. A regression here silently makes 88% of the catalogue unpublishable
// again, which is why it is asserted rather than assumed from the type.
for (const profile of ["mainline", "external", "vintage"] as const) {
  eq(
    `the care page and fit guide never block a ${profile} publish`,
    shopifyMissing({ ...complete, swatchHex: profile === "mainline" ? "#102030" : null, profile }),
    []
  );
}
// A photograph and a description stay required on every profile — the one thing
// `allowIncomplete` waives, and the failure this gate is for.
for (const profile of ["mainline", "external", "vintage"] as const) {
  eq(
    `a ${profile} product with no image is refused`,
    shopifyMissing({ ...complete, hasImage: false, profile }).includes("image"),
    true
  );
}

// --- create vs update --------------------------------------------------------
const bareLive = {
  hasVariants: true,
  hasPrice: true,
  description: null,
  hasImage: false,
  hasTags: false,
  swatchHex: null,
  profile: "external" as const,
};
eq("only variants and price stop a product being orderable", shopifyBlockingMissing(bareLive), []);
eq(
  "a create faces the whole gate",
  shopifyRefusing(bareLive, { action: "create" }),
  ["description", "image", "tags"]
);
eq(
  "an update faces only variants and price",
  shopifyRefusing(bareLive, { action: "update" }),
  []
);
eq(
  "...unless a blank is an instruction to erase",
  shopifyRefusing(bareLive, { action: "update", clearEmptied: true }),
  ["description", "image", "tags"]
);
eq(
  "an update with no sizes is still refused",
  shopifyRefusing({ ...bareLive, hasVariants: false }, { action: "update" }),
  ["variants"]
);

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
