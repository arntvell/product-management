// Fails if a component reaches outside the Origo design system.
//
//   npm run lint:ds        (or: npx tsx scripts/check-design-system.ts)
//
// The Tailwind namespaces are closed in globals.css, so an off-system utility
// does not compile — it silently renders nothing rather than erroring. This
// turns that silence into a failure with a line number, which is the whole
// point of catching it at review rather than on the screen.
//
// See docs/origo-design-system-adoption.md and
// _front-end-design-system/PRODUCT-MASTER-DESIGN.md §11.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const RULES: Array<{ pattern: RegExp; why: string }> = [
  {
    pattern:
      /\b(?:bg|text|border|ring|outline|divide|fill|stroke|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    why: "colour outside the palette — status is shape and word (§2, §3). Use ink, line, hover, selected, muted-foreground.",
  },
  {
    pattern: /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b|\btext-\[\d+px\]/,
    why: "type size outside the scale (§4). Use text-meta, text-fine, text-body, text-section, text-page.",
  },
  {
    pattern: /\bfont-(?:thin|extralight|light|medium|semibold|bold|extrabold|black)\b/,
    why: "the system has one weight (§4). Hierarchy is size, case and family.",
  },
  {
    pattern: /\brounded(?:-(?:xs|sm|md|lg|xl|[2-9]xl|t|b|l|r|tl|tr|bl|br))?\b(?!-)/,
    why: "radius is 0 (§5). Only rounded-full survives, for the filter chip and status dots.",
  },
  {
    pattern: /\bshadow-(?:xs|sm|md|lg|xl|[2-9]xl)\b/,
    why: "the drawer's shadow-overlay is the only shadow in the system (§3).",
  },
  {
    pattern: /\bdark:/,
    why: "the system is light only (§1). The dark variant is pinned to a class nothing gets.",
  },
];

const files = execSync(
  'git ls-files "src/**/*.tsx" "src/**/*.ts"',
  { encoding: "utf8" }
)
  .split("\n")
  .filter(Boolean)
  // The guard describes the rules it enforces, so it would fail on itself.
  .filter((f) => !f.endsWith("scripts/check-design-system.ts"));

let failures = 0;
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const { pattern, why } of RULES) {
      const m = line.match(pattern);
      if (m) {
        console.error(`${file}:${i + 1}  ${m[0]}\n    ${why}`);
        failures++;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} design-system violation(s).`);
  process.exit(1);
}
console.log(`Design system clean across ${files.length} files.`);
