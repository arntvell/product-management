// Moving colourways to the style they belong under.
//
// The whole repair is one column: `Colorway.styleId`. Loom builds its style
// blocks from that FK and nothing else, so re-pointing it re-nests the product
// over there — and because `colorway_id` is our primary key passed through
// verbatim, the id Loom holds never changes. That is Loom's first constraint:
// a colourway re-created under a new id arrives as a brand-new product and
// loses its order history, stock and costs.
//
// Preview first. This is the second pass in the catalogue that rewrites parents
// in bulk, and unlike merge-colorways it can touch hundreds of rows at once.
import { prisma } from "@/lib/db";

export interface MoveRequest {
  colorwayId: string;
  /** Omit to leave the colourway name alone — see `rename` below. */
  newName?: string;
}

export interface SelectionRequest {
  targetStyleId: string;
  /** Set only for a promotion: the target's new `styleName`. */
  targetRename?: string;
  moves: MoveRequest[];
}

export interface ApplyOptions {
  /**
   * Move colourways that carry a `threadflowId`.
   *
   * Off by default and it should stay off: `buildColorway` in threadflow/sync.ts
   * spreads `styleId` and `name` into the UPDATE branch for every colourway
   * Threadflow sends, matched by threadflowId OR colorwaySku. A move Threadflow
   * disagrees with is reverted on the next pull, silently.
   */
  allowThreadflow?: boolean;
  /**
   * Apply `newName` even where the colourway is published.
   *
   * The colourway name is the Shopify product title; the garment name reaches
   * the storefront separately, through the `custom.style_name` metafield
   * (Colorway.styleName — a different column from Style.styleName). Renaming
   * "Riley Navy" to "Navy" on a published row changes a live title, so the
   * rename is carried only when this is set, and `Colorway.styleName` is written
   * alongside it so the two still compose.
   */
  renamePublished?: boolean;
}

export interface PlannedMove {
  colorwayId: string;
  colorwaySku: string;
  fromStyleSku: string;
  toStyleSku: string;
  fromName: string;
  toName: string;
  /** The custom.style_name metafield, when the rename carries it. */
  toStyleNameMetafield?: string;
  renameSkipped?: string;
  publishedTo: string[];
}

export interface StylePlan {
  targetStyleId: string;
  targetStyleSku: string;
  targetStyleName: string;
  targetRenameTo?: string;
  moves: PlannedMove[];
}

export interface SplitApplyPlan {
  styles: StylePlan[];
  /** Styles that end up with no colourways at all. */
  emptied: { styleId: string; styleSku: string; styleName: string; inLoom: boolean }[];
  blockers: string[];
  warnings: string[];
  counts: { styles: number; moves: number; renames: number; emptied: number; emptiedInLoom: number };
}

export interface SplitApplyResult extends SplitApplyPlan {
  colorwaysMoved: number;
  colorwaysRenamed: number;
  stylesRenamed: number;
}

/** Fields a human has settled by hand; Threadflow already refuses to touch these. */
async function lockedFields(colorwayIds: string[]): Promise<Map<string, Set<string>>> {
  const rows = await prisma.fieldOwner.findMany({
    where: { entityType: "colorway", entityId: { in: colorwayIds }, owner: "MANUAL" },
    select: { entityId: true, field: true },
  });
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    (out.get(r.entityId) ?? out.set(r.entityId, new Set()).get(r.entityId)!).add(r.field);
  }
  return out;
}

export async function previewStyleSplit(
  selections: SelectionRequest[],
  opts: ApplyOptions = {}
): Promise<SplitApplyPlan> {
  const blockers: string[] = [];
  const warnings: string[] = [];

  const colorwayIds = selections.flatMap((s) => s.moves.map((m) => m.colorwayId));
  if (!colorwayIds.length) blockers.push("No colourways selected.");

  const seen = new Set<string>();
  for (const id of colorwayIds) {
    if (seen.has(id)) blockers.push(`Colourway ${id} appears in more than one selection.`);
    seen.add(id);
  }

  const [colorways, targets, locks] = await Promise.all([
    prisma.colorway.findMany({
      where: { id: { in: colorwayIds } },
      select: {
        id: true,
        colorwaySku: true,
        name: true,
        styleId: true,
        threadflowId: true,
        style: { select: { styleSku: true } },
        publications: { select: { channel: true } },
      },
    }),
    prisma.style.findMany({
      where: { id: { in: selections.map((s) => s.targetStyleId) } },
      select: { id: true, styleSku: true, styleName: true },
    }),
    lockedFields(colorwayIds),
  ]);

  const byId = new Map(colorways.map((c) => [c.id, c]));
  const targetById = new Map(targets.map((t) => [t.id, t]));

  const styles: StylePlan[] = [];
  let renames = 0;

  for (const sel of selections) {
    const target = targetById.get(sel.targetStyleId);
    if (!target) {
      blockers.push(`Target style ${sel.targetStyleId} does not exist.`);
      continue;
    }

    const moves: PlannedMove[] = [];
    for (const m of sel.moves) {
      const cw = byId.get(m.colorwayId);
      if (!cw) {
        blockers.push(`Colourway ${m.colorwayId} does not exist.`);
        continue;
      }
      if (cw.styleId === sel.targetStyleId && !m.newName) {
        warnings.push(`${cw.colorwaySku} is already under ${target.styleSku}; nothing to do.`);
        continue;
      }
      if (cw.threadflowId && !opts.allowThreadflow) {
        blockers.push(
          `${cw.colorwaySku} carries a Threadflow id. The next sync rewrites styleId ` +
            `and name for anything Threadflow sends, so this move would be reverted — ` +
            `fix it in Threadflow, or pass allowThreadflow.`
        );
        continue;
      }

      const publishedTo = cw.publications.map((p) => String(p.channel));
      const storefront = publishedTo.filter((c) => c === "SHOPIFY" || c === "SITOO");
      const wantsRename = Boolean(m.newName && m.newName !== cw.name);

      let toName = cw.name;
      let toStyleNameMetafield: string | undefined;
      let renameSkipped: string | undefined;

      if (wantsRename) {
        if (storefront.length && !opts.renamePublished) {
          renameSkipped =
            `published to ${storefront.join(", ")} — the colourway name is the product ` +
            `title. Re-nesting still applies; pass renamePublished to carry the rename.`;
        } else if (locks.get(cw.id)?.has("name")) {
          renameSkipped = "the name is locked to MANUAL in FieldOwner.";
        } else {
          toName = m.newName!;
          // Keep the storefront able to compose "<garment> <colour>" again: the
          // garment name lives in the custom.style_name metafield, not in the
          // colourway name we just shortened.
          if (!locks.get(cw.id)?.has("styleName")) {
            toStyleNameMetafield = sel.targetRename ?? target.styleName;
          }
          renames++;
        }
      }

      moves.push({
        colorwayId: cw.id,
        colorwaySku: cw.colorwaySku,
        fromStyleSku: cw.style.styleSku,
        toStyleSku: target.styleSku,
        fromName: cw.name,
        toName,
        toStyleNameMetafield,
        renameSkipped,
        publishedTo,
      });
    }

    if (moves.length || sel.targetRename) {
      styles.push({
        targetStyleId: target.id,
        targetStyleSku: target.styleSku,
        targetStyleName: target.styleName,
        targetRenameTo:
          sel.targetRename && sel.targetRename !== target.styleName ? sel.targetRename : undefined,
        moves,
      });
    }
  }

  const emptied = await findEmptied(styles);

  return {
    styles,
    emptied,
    blockers,
    warnings,
    counts: {
      styles: styles.length,
      moves: styles.reduce((n, s) => n + s.moves.length, 0),
      renames,
      emptied: emptied.length,
      emptiedInLoom: emptied.filter((e) => e.inLoom).length,
    },
  };
}

/**
 * Which styles this leaves childless.
 *
 * Worth naming precisely, because a style with no colourways stops appearing in
 * the Loom payload altogether, and `channels.loom` — Loom's only withdraw
 * signal — exists on colourways, never on styles. The ones already published to
 * Loom are the ones that become empty shells over there.
 */
async function findEmptied(styles: StylePlan[]): Promise<SplitApplyPlan["emptied"]> {
  const movedByStyle = new Map<string, number>();
  const moving = styles.flatMap((s) => s.moves.map((m) => m.colorwayId));
  if (!moving.length) return [];

  const rows = await prisma.colorway.findMany({
    where: { id: { in: moving } },
    select: { styleId: true },
  });
  for (const r of rows) movedByStyle.set(r.styleId, (movedByStyle.get(r.styleId) ?? 0) + 1);

  const sources = await prisma.style.findMany({
    where: { id: { in: [...movedByStyle.keys()] } },
    select: {
      id: true,
      styleSku: true,
      styleName: true,
      colorways: { select: { id: true, publications: { select: { channel: true } } } },
    },
  });

  const targetIds = new Set(styles.map((s) => s.targetStyleId));
  return sources
    .filter((s) => !targetIds.has(s.id))
    .filter((s) => s.colorways.length === (movedByStyle.get(s.id) ?? 0))
    .map((s) => ({
      styleId: s.id,
      styleSku: s.styleSku,
      styleName: s.styleName,
      inLoom: s.colorways.some((c) => c.publications.some((p) => p.channel === "LOOM")),
    }));
}

export async function applyStyleSplit(
  selections: SelectionRequest[],
  opts: ApplyOptions = {}
): Promise<SplitApplyResult> {
  const plan = await previewStyleSplit(selections, opts);
  if (plan.blockers.length) {
    throw new Error(`Refusing to apply:\n- ${plan.blockers.join("\n- ")}`);
  }

  let moved = 0;
  let renamed = 0;
  let stylesRenamed = 0;

  for (const s of plan.styles) {
    if (s.targetRenameTo) {
      await prisma.style.update({
        where: { id: s.targetStyleId },
        data: { styleName: s.targetRenameTo },
      });
      stylesRenamed++;
    }

    const CHUNK = 50;
    for (let i = 0; i < s.moves.length; i += CHUNK) {
      const slice = s.moves.slice(i, i + CHUNK);
      await prisma.$transaction(
        slice.map((m) =>
          prisma.colorway.update({
            where: { id: m.colorwayId },
            data: {
              styleId: s.targetStyleId,
              ...(m.toName !== m.fromName ? { name: m.toName } : {}),
              ...(m.toStyleNameMetafield ? { styleName: m.toStyleNameMetafield } : {}),
            },
          })
        ),
        { timeout: 60_000 }
      );
      moved += slice.length;
      renamed += slice.filter((m) => m.toName !== m.fromName).length;
    }
  }

  // The emptied styles are deliberately left in place. They are the record of
  // what moved where, and Loom has not yet said what it does with a style block
  // that stops arriving — sweeping them here would destroy the evidence before
  // that question is answered.
  return { ...plan, colorwaysMoved: moved, colorwaysRenamed: renamed, stylesRenamed };
}
