// Styles that should be one style, and the colourways stranded under the wrong
// parent.
//
// Loom groups colourways by nothing more than our `Colorway.styleId` FK: the
// payload emits one block per style and nests that style's colourways inside it
// (loom/payload.ts). A colourway has no style field of its own over there, so it
// belongs to whichever block it arrives in, and every push rewrites the grouping
// from our structure. That makes this fixable here and only here — and it makes
// the fix an `UPDATE Colorway SET styleId`, which never touches a colorway id.
// Loom's constraint is exactly that: a re-created colourway arrives as a new
// product and loses its order history, stock and costs.
//
// Two shapes produce the split, and they need different answers:
//
//   DUPLICATE-STYLE  Two style rows with the same name. cin7/import.ts resolves
//                    the parent by NAME (deriveParentStyle) and then looks it up
//                    by the SYNTHESISED `LIV-STY-<slug>` SKU. The Threadflow
//                    style that supplied the name has a different SKU, so the
//                    lookup misses and a second "Abby" is created.
//
//   SELF-NAMED       A style whose single colourway is named after it — "Riley
//                    Navy" holding one "Riley Navy". The colour is in the style
//                    name. import-shopify.ts and the retired create.ts wrote
//                    styleSku === colorwaySku for every product; cin7 falls back
//                    to the full product name when no parent matches.
//
// A report, never an action — same contract as duplicate-candidates.ts. Applying
// is style-splits-apply.ts, and it previews first.
import { prisma } from "@/lib/db";
import { isOneOfOne } from "./sku";
import { colorwayName, isImperfect, withoutImperfectMarker } from "@/lib/cin7/import";
import { SEED_NAME_RULES } from "./style-name-rules";

export type SplitConfidence = "high" | "medium" | "low";

export type SplitKind =
  /** Two genuine styles, same name. Keep the Threadflow row. */
  | "duplicate-style"
  /** A `<Style> <Colour>` style whose parent already exists. */
  | "self-named"
  /** A cluster of `<Style> <Colour>` styles with no parent: promote one. */
  | "promote";

export interface SplitStyle {
  styleId: string;
  styleSku: string;
  styleName: string;
  source: string;
  threadflowId: string | null;
  gender: string | null;
  category: string;
  brand: string | null;
  inLoom: boolean;
  colorways: SplitColorway[];
}

export interface SplitColorway {
  colorwayId: string;
  colorwaySku: string;
  name: string;
  /** What the name becomes once the parent's name is stripped off the front. */
  proposedName: string;
  source: string;
  threadflowId: string | null;
  archived: boolean;
  seasons: string[];
  /** Renaming this changes a live product title — see the apply module. */
  publishedTo: string[];
}

export interface SplitProposal {
  kind: SplitKind;
  confidence: SplitConfidence;
  reason: string;
  /** The style everything moves into. For `promote`, the row being renamed. */
  target: SplitStyle;
  /** Only set for `promote`: what `target.styleName` becomes. */
  targetRename?: string;
  /**
   * The target's OWN colourways, when promoting.
   *
   * Renaming the style "Riley Grey Melange" to "Riley" leaves its colourway
   * still called "Riley Grey Melange" while its new siblings read "Navy",
   * "Black", "Green". They need the same strip.
   */
  targetColorways?: SplitColorway[];
  /** The styles whose colourways move out. */
  absorb: SplitStyle[];
  /** Set when some colourway cannot move — Threadflow would revert it. */
  blockers: string[];
  /** Flagged, not resolved: Loom takes category at style level. */
  categoryConflict?: string;
}

export interface SplitReport {
  proposals: SplitProposal[];
  counts: {
    duplicateStyle: number;
    selfNamed: number;
    promote: number;
    high: number;
    medium: number;
    low: number;
    /** Style rows that would be left childless — and how many Loom holds. */
    stylesEmptied: number;
    stylesEmptiedInLoom: number;
    colorwaysMoved: number;
  };
  scanned: number;
  vintageSkipped: number;
  /** Styles left alone, with the reason, so the report accounts for everything. */
  skipped: { styleSku: string; styleName: string; reason: string }[];
}

/** Compare names the way a human would: case and spacing are not identity. */
export const normName = (s: string | null | undefined): string =>
  String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Strip the parent's name off the front of a colourway name.
 *
 * The FULL parent name, never just its first word — otherwise "Hayes Suit Pant
 * Black" under "Hayes Suit Pant" keeps the garment in its colour and reads as
 * "Suit Pant Black". Carried over from regroup-styles.ts, which this supersedes.
 */
export function stripPrefix(name: string, prefix: string): string {
  const n = name.trim();
  if (normName(n) === normName(prefix)) return n;
  if (normName(n).startsWith(normName(prefix) + " ")) {
    return n.slice(prefix.trim().length).trim() || n;
  }
  return n;
}

/**
 * Imperfect rows carry the size in the name — "Keri Japan Black, 2834*",
 * "Barnes Forest Fog 29 34*" — so a prefix match never fires against them.
 *
 * Find the trailing size, then hand the stripping to `colorwayName` from the
 * Cin7 importer, which already knows both spellings (2834 and "28 34"). A second
 * regex here would drift from that one.
 *
 * The asterisk is NOT discarded. It marks an imperfect, which is a different
 * product from the garment it came from, and it moves to the FRONT so the
 * marker survives both passes:
 *
 *   pass A matches `matchName` exactly   — "*barnes" never equals "barnes"
 *   pass B matches `startsWith(v + " ")` — "*barnes forest fog" never starts
 *                                          with "barnes ", only with "*barnes "
 *
 * Stripping it instead — which this did until 2026-09-17 — made "Barnes*"
 * normalise to "barnes" and the report would have proposed merging the
 * imperfect style into the real one, undoing the split deliberately.
 * Imperfects group with imperfects; they never join the wholesale style.
 */
export function nameForMatching(name: string, sku?: string | null): string {
  const imperfect = isImperfect(sku ?? "", name);
  const mark = (v: string) => (imperfect ? `*${v}` : v);
  const n = withoutImperfectMarker(name);
  const m = /[,\s]+(\d{2})\s*[\/x\s]\s*(\d{2})\s*$|[,\s]+(\d{4})\s*$|[,\s]+(\d{2})\s*$/.exec(n);
  if (!m) return mark(n);
  const size = m[1] && m[2] ? `${m[1]}${m[2]}` : (m[3] ?? m[4])!;
  return mark(colorwayName(n, size).replace(/[,\s]+$/, ""));
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type LoadedStyle = SplitStyle & { matchName: string };

async function loadStyles(): Promise<LoadedStyle[]> {
  const rows = await prisma.style.findMany({
    select: {
      id: true,
      styleSku: true,
      styleName: true,
      source: true,
      threadflowId: true,
      gender: true,
      category: true,
      brand: { select: { name: true } },
      colorways: {
        select: {
          id: true,
          colorwaySku: true,
          name: true,
          source: true,
          threadflowId: true,
          archived: true,
          entries: { select: { season: { select: { code: true } } } },
          publications: { select: { channel: true } },
        },
      },
    },
  });

  return rows.map((s) => ({
    styleId: s.id,
    styleSku: s.styleSku,
    styleName: s.styleName,
    matchName: normName(nameForMatching(s.styleName, s.styleSku)),
    source: s.source,
    threadflowId: s.threadflowId,
    gender: s.gender,
    category: s.category,
    brand: s.brand?.name ?? null,
    inLoom: s.colorways.some((c) => c.publications.some((p) => p.channel === "LOOM")),
    colorways: s.colorways.map((c) => ({
      colorwayId: c.id,
      colorwaySku: c.colorwaySku,
      name: c.name,
      proposedName: c.name,
      source: c.source,
      threadflowId: c.threadflowId,
      archived: c.archived,
      seasons: [...new Set(c.entries.map((e) => e.season.code))].sort(),
      publishedTo: c.publications.map((p) => String(p.channel)),
    })),
  }));
}

interface StoredNameRule {
  name: string;
  kind: string;
  parent?: string | null;
}

interface NameRules {
  compound: Set<string>;
  keepSeparate: Set<string>;
  parentOverride: Map<string, string>;
}

/**
 * The baseline exception list, with anything decided in the review screen
 * layered on top. The table is allowed not to exist yet: the report is useful
 * before the migration lands, and a missing table must not take it down.
 */
async function loadNameRules(): Promise<NameRules> {
  const rules: NameRules = {
    compound: new Set(),
    keepSeparate: new Set(),
    parentOverride: new Map(),
  };

  const apply = (r: { name: string; kind: string; parent?: string | null }) => {
    const name = normName(r.name);
    if (r.kind === "COMPOUND") rules.compound.add(name);
    else if (r.kind === "KEEP_SEPARATE") rules.keepSeparate.add(name);
    else if (r.parent) rules.parentOverride.set(name, normName(r.parent));
  };

  for (const r of SEED_NAME_RULES) apply(r);

  // The delegate is absent when the client predates the model — a dev server
  // that has not restarted since `prisma generate`.
  const delegate = (prisma as { styleNameRule?: { findMany: () => Promise<StoredNameRule[]> } })
    .styleNameRule;
  if (!delegate) {
    console.warn("[style-splits] Prisma client has no StyleNameRule — baseline list only.");
    return rules;
  }

  try {
    for (const r of await delegate.findMany()) apply(r);
  } catch (err) {
    // P2021: the table is not there yet. Everything else is a real failure.
    const code = (err as { code?: string }).code;
    if (code !== "P2021") throw err;
    console.warn(
      "[style-splits] StyleNameRule table not found — running on the baseline " +
        "list only. Run `npx prisma migrate deploy`; no restart needed after."
    );
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

/**
 * A style whose one colourway is named after it — the colour lives in the style
 * name. This is the shape `cin7/import.ts:516-521` already throws to prevent on
 * its own path, and the one import-shopify.ts and create.ts wrote wholesale.
 */
export function isSelfNamed(s: SplitStyle): boolean {
  return (
    s.colorways.length === 1 &&
    normName(nameForMatching(s.colorways[0].name, s.colorways[0].colorwaySku)) ===
    normName(nameForMatching(s.styleName, s.styleSku))
  );
}

/**
 * Styles that can act as a parent.
 *
 * Threadflow decides where a garment name ends and a colour begins, so a TF
 * style always qualifies. A MANUAL or Cin7 row qualifies only if it is not
 * itself a self-named singleton — otherwise the vocabulary poisons itself and
 * the bogus "Barnes Japan Fade" swallows "Barnes Japan Fade Selvage". That
 * pollution is live today: cin7/import.ts loads its vocabulary as
 * `source in (THREADFLOW, MANUAL)` with no such filter.
 */
export function isParentCandidate(s: SplitStyle): boolean {
  if (isOneOfOne(s.styleSku)) return false;
  if (s.threadflowId) return true;
  return !isSelfNamed(s);
}


/**
 * The words that name a garment rather than a colour.
 *
 * "Market Jeans", "Market shorts" and "Market blouse print" share a leading word
 * but they are three garments, not three colours of one. The catalogue already
 * knows which words are garment types — Category and Colorway.productType — so
 * ask it rather than inventing a list.
 */
async function loadGarmentWords(): Promise<Set<string>> {
  const [categories, productTypes] = await Promise.all([
    prisma.category.findMany({ select: { name: true } }),
    prisma.colorway.findMany({
      where: { productType: { not: null } },
      select: { productType: true },
      distinct: ["productType"],
    }),
  ]);
  const words = new Set<string>();
  for (const value of [
    ...categories.map((c) => c.name),
    ...productTypes.map((p) => p.productType ?? ""),
  ]) {
    for (const w of normName(value).split(/[\s/&-]+/)) {
      if (w.length >= 3) words.add(w);
    }
  }
  return words;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** The words the first token is worth nothing without — never a style on its own. */
const TOO_GENERIC = new Set([
  "sample", "imperfect", "wool", "merino", "double", "vintage", "the", "old",
]);

/**
 * The parent name a cluster agrees on, at word boundaries.
 *
 * This is the "normally the first word, but sometimes the first two" rule made
 * mechanical. "Water Bottle 500Ml Amber" + "Water Bottle 950Ml Blue" agree on
 * "Water Bottle", not on "Water" — and a style called Water would be wrong.
 *
 * The prefix may equal one member's whole name — "Water Bottle" alongside
 * "Water Bottle 500Ml Amber". That member is then the parent, which is what we
 * want; truncating to "Water" to keep a word spare would name the style after
 * nothing. Only when every name is identical is the last word given back, since
 * a parent that swallows all of them leaves no colour anywhere.
 */
export function commonWordPrefix(names: string[]): string[] {
  const split = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  if (!split.length) return [];
  const limit = Math.min(...split.map((w) => w.length));
  const out: string[] = [];
  for (let i = 0; i < limit; i++) {
    const word = split[0][i];
    if (!split.every((w) => normName(w[i]) === normName(word))) break;
    out.push(word);
  }
  const allIdentical = split.every((w) => w.length === out.length);
  return allIdentical ? out.slice(0, -1) : out;
}

/** A leading token that is not a word is a collection or model code, not a garment. */
const looksLikeAGarmentName = (word: string) => /^[a-z]{2,}$/i.test(word.replace(/[^a-z]/gi, "") ) && /^[a-z]/i.test(word);

function pickTarget(group: LoadedStyle[]): LoadedStyle {
  const tf = group.filter((s) => s.threadflowId);
  // Threadflow first, always. It is the row the sync keys on, and the sync
  // rewrites styleId for every colourway it knows — so a target the sync does
  // not recognise is a move that undoes itself on the next pull.
  if (tf.length === 1) return tf[0];
  const pool = tf.length ? tf : group;
  return [...pool].sort(
    (a, b) =>
      Number(b.styleSku.startsWith("LIV-STY-")) - Number(a.styleSku.startsWith("LIV-STY-")) ||
      b.colorways.length - a.colorways.length ||
      Number(b.inLoom) - Number(a.inLoom) ||
      a.styleSku.localeCompare(b.styleSku)
  )[0];
}

function blockersFor(absorb: LoadedStyle[]): string[] {
  const out: string[] = [];
  const tfHeld = absorb.flatMap((s) =>
    s.colorways.filter((c) => c.threadflowId).map((c) => c.colorwaySku)
  );
  if (tfHeld.length) {
    out.push(
      `${tfHeld.length} colourway(s) carry a Threadflow id (${tfHeld
        .slice(0, 3)
        .join(", ")}${tfHeld.length > 3 ? "…" : ""}). The next sync rewrites ` +
        `styleId and name for anything Threadflow sends, so this move would be ` +
        `reverted. Fix it in Threadflow, or pass allowThreadflow to override.`
    );
  }
  return out;
}

function categoryConflictFor(target: LoadedStyle, absorb: LoadedStyle[]): string | undefined {
  const others = [...new Set(absorb.map((s) => s.category))].filter(
    (c) => c && c !== target.category
  );
  if (!others.length) return undefined;
  // Loom takes category at style level, so the disagreement becomes visible the
  // moment these merge. Report it; do not pick a winner.
  return `${target.styleSku} is "${target.category}", absorbing ${others
    .map((c) => `"${c}"`)
    .join(", ")}`;
}

function toProposalStyle(s: LoadedStyle, parentName?: string): SplitStyle {
  return {
    ...s,
    colorways: s.colorways.map((c) => ({
      ...c,
      proposedName: parentName ? stripPrefix(c.name, parentName) : c.name,
    })),
  };
}

export async function buildStyleSplitReport(): Promise<SplitReport> {
  const [all, rules, garmentWords] = await Promise.all([
    loadStyles(),
    loadNameRules(),
    loadGarmentWords(),
  ]);

  const proposals: SplitProposal[] = [];
  const skipped: SplitReport["skipped"] = [];
  let vintageSkipped = 0;

  // One-of-one vintage never groups. Six second-hand Tommy Hilfiger shirts in XL
  // are six garments with six SKUs and one name; nesting them would claim they
  // are colours of each other.
  const live: LoadedStyle[] = [];
  for (const s of all) {
    const vintage =
      isOneOfOne(s.styleSku) ||
      (s.colorways.length > 0 && s.colorways.every((c) => isOneOfOne(c.colorwaySku)));
    if (vintage) {
      vintageSkipped++;
      continue;
    }
    // Keyed on styleSku, never styleName: in a duplicate-style pair both rows
    // carry the SAME name, so rejecting one by name would drop the survivor
    // from `live` and from the vocabulary too — and every colourway that nests
    // under it loses its parent on the next run.
    if (rules.keepSeparate.has(normName(s.styleSku))) {
      skipped.push({ styleSku: s.styleSku, styleName: s.styleName, reason: "reviewed: keep separate" });
      continue;
    }
    live.push(s);
  }

  const claimed = new Set<string>();
  // Where a style that pass A empties sends its colourways. Pass B must follow
  // it: nesting "Abby Fog" under LIV-STY-ABBY while pass A is emptying
  // LIV-STY-ABBY into LIV-W-BBY would leave the two passes fighting.
  const redirect = new Map<string, string>();

  // --- Pass A: two genuine styles wearing the same name -------------------
  const byName = new Map<string, LoadedStyle[]>();
  for (const s of live) {
    if (isSelfNamed(s)) continue; // pass B's problem
    (byName.get(s.matchName) ?? byName.set(s.matchName, []).get(s.matchName)!).push(s);
  }

  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const target = pickTarget(group);
    const absorb = group.filter((s) => s.styleId !== target.styleId);
    const tfCount = group.filter((s) => s.threadflowId).length;

    proposals.push({
      kind: "duplicate-style",
      confidence: tfCount === 1 ? "high" : "low",
      reason:
        tfCount === 1
          ? `same style name; ${target.styleSku} is the Threadflow row and the sync writes to it`
          : tfCount === 0
            ? "same style name, neither side is a Threadflow row — pick the survivor by hand"
            : `same style name and ${tfCount} Threadflow rows — a Threadflow data problem, ` +
              "fix it there rather than here",
      target: toProposalStyle(target),
      absorb: absorb.map((s) => toProposalStyle(s)),
      blockers: blockersFor(absorb),
      categoryConflict: categoryConflictFor(target, absorb),
    });
    for (const s of group) claimed.add(s.styleId);
    for (const s of absorb) redirect.set(s.styleId, target.styleId);
  }

  // --- Pass B: `<Style> <Colour>` styles ----------------------------------
  const vocabulary = live
    .filter((s) => isParentCandidate(s))
    .sort((a, b) => b.matchName.length - a.matchName.length);
  const byStyleId = new Map(live.map((s) => [s.styleId, s]));
  const selfNamed = live.filter((s) => isSelfNamed(s) && !claimed.has(s.styleId));

  const underParent = new Map<string, LoadedStyle[]>();
  const orphans: LoadedStyle[] = [];

  for (const s of selfNamed) {
    const override = rules.parentOverride.get(normName(s.colorways[0]?.colorwaySku)) ??
      rules.parentOverride.get(s.matchName);
    const hit = override
      ? vocabulary.find((v) => v.matchName === override)
      : rules.compound.has(s.matchName)
        ? undefined
        : vocabulary.find(
            (v) => v.styleId !== s.styleId && s.matchName.startsWith(v.matchName + " ")
          );
    if (hit) {
      // Follow pass A: if this parent is itself being emptied, nest under the
      // row that survives instead.
      const parentId = redirect.get(hit.styleId) ?? hit.styleId;
      (underParent.get(parentId) ?? underParent.set(parentId, []).get(parentId)!).push(s);
    } else if (rules.compound.has(s.matchName)) {
      skipped.push({
        styleSku: s.styleSku,
        styleName: s.styleName,
        reason: "a garment in its own right — see the name rules",
      });
    } else {
      orphans.push(s);
    }
  }

  for (const [targetId, members] of underParent) {
    const target = byStyleId.get(targetId)!;
    const remainders = members.map((m) => stripPrefix(m.colorways[0].name, target.styleName));
    const emptyRemainder = remainders.some((r) => normName(r) === normName(target.styleName));
    proposals.push({
      kind: "self-named",
      confidence:
        target.colorways.length >= 2 && !emptyRemainder
          ? "high"
          : emptyRemainder
            ? "low"
            : "medium",
      reason:
        `the colour is in the style name; "${target.styleName}" already exists` +
        (target.colorways.length >= 2
          ? ` with ${target.colorways.length} colourways`
          : " but carries only one colourway itself") +
        (emptyRemainder ? " — stripping the parent name leaves nothing for some rows" : ""),
      target: toProposalStyle(target),
      absorb: members.map((s) => toProposalStyle(s, target.styleName)),
      blockers: blockersFor(members),
      categoryConflict: categoryConflictFor(target, members),
    });
  }

  // --- Pass C: clusters with no parent anywhere — promote one -------------
  const clusters = new Map<string, LoadedStyle[]>();
  for (const s of orphans) {
    const word = s.matchName.split(" ")[0];
    if (!word || TOO_GENERIC.has(word)) {
      skipped.push({
        styleSku: s.styleSku,
        styleName: s.styleName,
        reason: word ? `"${word}" is not a garment name` : "no usable name",
      });
      continue;
    }
    (clusters.get(word) ?? clusters.set(word, []).get(word)!).push(s);
  }

  for (const [clusterWord, members] of clusters) {
    if (members.length < 2) {
      skipped.push({
        styleSku: members[0].styleSku,
        styleName: members[0].styleName,
        reason: "no parent style, and nothing else shares its name",
      });
      continue;
    }
    // Promote rather than create: a new style is a new style_id in Loom on top of
    // the ones this leaves empty. Renaming one of the cluster's own rows keeps
    // its style_id, so Loom sees a rename instead of a create plus an orphan.
    // Display casing comes from a real row, not from the normalised cluster key.
    const shared = commonWordPrefix(members.map((m) => m.styleName));
    const bareName = (shared.length ? shared : [members[0].styleName.trim().split(/\s+/)[0]]).join(" ");
    // The cluster key carries the imperfect marker, so a cluster is all
    // imperfect or none of it. The shared prefix is taken from the RAW style
    // names, where the star sits at the end after the size and is lost when the
    // common prefix is computed — so twelve rows called "Barnes … 29/32*"
    // promote to a style called plainly "Barnes", which is the wholesale
    // garment's name. Put the marker back.
    const parentName = clusterWord.startsWith("*") ? `${bareName}*` : bareName;
    // A row already called exactly the parent name is the natural survivor: the
    // promotion is then a no-op rename and Loom sees nothing move at all.
    const exact = members.filter((m) => m.matchName === normName(parentName));
    const promoted = exact.length ? pickTarget(exact) : pickTarget(members);
    const absorb = members.filter((s) => s.styleId !== promoted.styleId);
    // Nothing stripped means the name does not actually start with the parent —
    // the cluster key matched but the colourway name disagrees.
    const emptyRemainder = absorb.some(
      (m) =>
        normName(stripPrefix(m.colorways[0].name, parentName)) ===
        normName(m.colorways[0].name)
    );

    const namey = shared.length
      ? shared.every(looksLikeAGarmentName)
      : looksLikeAGarmentName(parentName);

    // If the leftovers name garments rather than colours, this is a collection
    // being mistaken for a style: "Market Jeans" and "Market shorts" are two
    // garments, not two colours of a Market.
    const leftovers = absorb.map((m) => stripPrefix(m.colorways[0].name, parentName));
    const garmentish = leftovers.filter((r) => {
      const head = normName(r).split(/\s+/)[0] ?? "";
      return garmentWords.has(head);
    }).length;
    const readsAsCollection = leftovers.length > 0 && garmentish * 2 >= leftovers.length;

    proposals.push({
      kind: "promote",
      confidence:
        members.length >= 3 && !emptyRemainder && namey && !readsAsCollection
          ? "medium"
          : "low",
      reason:
        `${members.length} styles agree on "${parentName}" and no "${parentName}" style ` +
        `exists. Promote ${promoted.styleSku} — renaming it keeps its style_id, so Loom ` +
        `sees a rename rather than a new style beside ${absorb.length} empty ones.` +
        (shared.length > 1
          ? ` The name is ${shared.length} words because every member agrees on all of them.`
          : "") +
        (namey ? "" : ` "${parentName}" reads like a collection or model code, not a garment.`) +
        (readsAsCollection
          ? ` ${garmentish} of ${leftovers.length} leftovers name a garment type, not a colour — ` +
            `"${parentName}" may be a collection rather than a style.`
          : ""),
      target: toProposalStyle(promoted),
      targetRename: parentName,
      targetColorways: toProposalStyle(promoted, parentName).colorways.filter(
        (c) => c.proposedName !== c.name
      ),
      absorb: absorb.map((s) => toProposalStyle(s, parentName)),
      blockers: blockersFor(absorb),
      categoryConflict: categoryConflictFor(promoted, absorb),
    });
  }

  proposals.sort(
    (a, b) =>
      rank(a.confidence) - rank(b.confidence) ||
      b.absorb.length - a.absorb.length ||
      a.target.styleName.localeCompare(b.target.styleName)
  );

  const emptied = proposals.flatMap((p) => p.absorb);
  return {
    proposals,
    counts: {
      duplicateStyle: proposals.filter((p) => p.kind === "duplicate-style").length,
      selfNamed: proposals.filter((p) => p.kind === "self-named").length,
      promote: proposals.filter((p) => p.kind === "promote").length,
      high: proposals.filter((p) => p.confidence === "high").length,
      medium: proposals.filter((p) => p.confidence === "medium").length,
      low: proposals.filter((p) => p.confidence === "low").length,
      stylesEmptied: emptied.length,
      stylesEmptiedInLoom: emptied.filter((s) => s.inLoom).length,
      colorwaysMoved: emptied.reduce((n, s) => n + s.colorways.length, 0),
    },
    scanned: all.length,
    vintageSkipped,
    skipped,
  };
}

const rank = (c: SplitConfidence) => (c === "high" ? 0 : c === "medium" ? 1 : 2);
