// Merge two Colorway rows that are the same garment.
//
// This happens because Threadflow issues a colorway id PER SEASON while
// `colorwaySku` is the stable natural key. When Threadflow standardises a SKU,
// one season's record can pick up the new SKU before the other's — and for a
// while the two seasons resolve to two different local rows. Add the Cin7
// imports, which were re-modelled as colorways under the same parent styles,
// and one garment can end up held twice from two directions. Both rows then want
// the same SKU, and only one can have it.
//
// The survivor is always the row that ALREADY HOLDS the SKU Threadflow wants.
// That is not an arbitrary tie-break: it is the row Loom is publishing (Loom
// identifies a product by our own colorway id, see src/lib/loom/payload.ts), and
// in practice it is also the row carrying the barcodes. Keeping it means the
// merge changes no external identity and strands no barcode.
//
// Nothing is deleted. The loser's SKU is parked, its Threadflow id released and
// the row archived, so the operation is reversible and a later sync ignores it.
import { prisma } from "@/lib/db";

export interface ColorwaySummary {
  id: string;
  colorwaySku: string;
  name: string;
  source: string;
  styleSku: string;
  archived: boolean;
  status: string;
  variants: number;
  barcodes: number;
  seasons: string[];
  channels: string[];
  threadflowId: string | null;
}

export interface VariantAction {
  /** move: the survivor lacks this size, so the row comes across. */
  /** fold: both have it — keep the survivor's, carry what it is missing. */
  kind: "move" | "fold";
  size: string;
  loserVariantId: string;
  loserSku: string;
  newSku?: string;
  survivorVariantId?: string;
  survivorSku?: string;
  carriesBarcode: boolean;
  carriesCost: boolean;
}

export interface ColorwayMergePlan {
  keep: ColorwaySummary;
  lose: ColorwaySummary;
  /** Reasons this merge must not run. Non-empty means apply refuses. */
  blockers: string[];
  notes: string[];
  variants: VariantAction[];
  entries: { seasonCode: string; seasonId: string; action: "move" | "fold" }[];
  prices: { action: "move" | "drop"; currency: string; priceType: string; seasonId: string }[];
  images: { action: "move" | "drop"; seasonId: string; slot: string }[];
  media: number;
  publications: { channel: string; action: "move" | "keep-survivor" }[];
  channelContent: { channel: string; field: string; action: "move" | "keep-survivor" }[];
  fieldOwners: { field: string; action: "move" | "keep-survivor" }[];
  /** Survivor columns that would be filled from the loser (only where empty). */
  fills: string[];
  tagsAdded: string[];
  setsIsCore: boolean;
  flipsSourceToThreadflow: boolean;
  loserParkedSku: string;
}

export interface ColorwayMergeResult extends ColorwayMergePlan {
  applied: true;
  variantsMoved: number;
  variantsFolded: number;
  barcodesCarried: number;
}

export interface MergeOptions {
  /** Required by apply — the merge is the one destructive pass in this codebase. */
  confirm?: boolean;
  /**
   * Retiring a published row withdraws it from that channel, and the survivor
   * would then arrive as a brand-new product. Refuse unless told otherwise.
   */
  allowPublishedLoser?: boolean;
  /** Allow a merge across two different parent styles. */
  allowDifferentStyle?: boolean;
  /** Delete the loser's folded variants instead of parking their SKUs. */
  deleteLoserVariants?: boolean;
}

const SUMMARY_SELECT = {
  id: true,
  colorwaySku: true,
  name: true,
  source: true,
  styleId: true,
  archived: true,
  status: true,
  threadflowId: true,
  style: { select: { styleSku: true } },
  variants: { select: { barcode: true } },
  entries: { select: { season: { select: { code: true } } } },
  publications: { select: { channel: true } },
} as const;

/** Text columns filled from the loser only where the survivor's is empty. */
const TEXT_FILL_FIELDS = [
  "color",
  "swatchHex",
  "swatchImageUrl",
  "productType",
  "vendor",
  "countryOfOrigin",
  "shortDescription",
  "fullDescription",
  "details",
  "styleTagline",
  "styleName",
  "carePageId",
  "fitguidePageId",
  "recommendedCollectionId",
  "modelInfoId",
  "flatFileId",
  "hsCodeOverride",
  "customsDescriptionOverride",
  "fiberCompositionOverride",
] as const;

/** List columns filled from the loser only where the survivor's is empty. */
const LIST_FILL_FIELDS = [
  "sameProduct",
  "styleWith",
  "styleWithUnisexHerre",
  "styleWithUnisexDame",
  "menImages",
  "womenImages",
] as const;

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * The size portion of a variant SKU. Derived from the SKU rather than
 * `sizeLabel`: Threadflow rows carry a malformed label ("W32/LL32") because the
 * length arrives already prefixed, so matching on the label would fail on
 * exactly the pairs this function exists for and quietly carry no barcodes.
 */
function sizeKey(variantSku: string, colorwaySku: string, sizeLabel: string): string {
  if (variantSku.startsWith(`${colorwaySku}-`))
    return variantSku.slice(colorwaySku.length + 1);
  // Fallback: normalise the label so W32/LL32 and W32/L32 agree.
  return sizeLabel
    .split("/")
    .map((part) => part.replace(/^([WL])\1+/i, "$1").replace(/^[WL]/i, ""))
    .join("/");
}

async function summarise(id: string): Promise<ColorwaySummary | null> {
  const r = await prisma.colorway.findUnique({ where: { id }, select: SUMMARY_SELECT });
  if (!r) return null;
  return {
    id: r.id,
    colorwaySku: r.colorwaySku,
    name: r.name,
    source: String(r.source),
    styleSku: r.style.styleSku,
    archived: r.archived,
    status: String(r.status),
    variants: r.variants.length,
    barcodes: r.variants.filter((v) => hasText(v.barcode)).length,
    seasons: [...new Set(r.entries.map((e) => e.season.code))].sort(),
    channels: [...new Set(r.publications.map((p) => String(p.channel)))].sort(),
    threadflowId: r.threadflowId,
  };
}

export async function previewColorwayMerge(
  keepId: string,
  loseId: string,
  opts: MergeOptions = {}
): Promise<ColorwayMergePlan> {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (keepId === loseId) throw new Error("keepId and loseId are the same colorway");

  const [keep, lose] = await Promise.all([summarise(keepId), summarise(loseId)]);
  if (!keep) throw new Error(`No colorway ${keepId}`);
  if (!lose) throw new Error(`No colorway ${loseId}`);

  if (keep.styleSku !== lose.styleSku && !opts.allowDifferentStyle)
    blockers.push(
      `Different parent styles (${keep.styleSku} vs ${lose.styleSku}). ` +
        `Pass allowDifferentStyle only if you are sure these are one garment.`
    );
  if (lose.channels.length && !opts.allowPublishedLoser)
    blockers.push(
      `${lose.colorwaySku} is published to ${lose.channels.join("+")}. Retiring it ` +
        `withdraws it there and the survivor would arrive as a new product — ` +
        `withdraw it deliberately first, or pass allowPublishedLoser.`
    );
  if (keep.name.trim().toLowerCase() !== lose.name.trim().toLowerCase())
    notes.push(`Colour names differ: "${keep.name}" vs "${lose.name}".`);

  // ---- Variants, matched by SKU size suffix ----
  const [keepVars, loseVars] = await Promise.all([
    prisma.variant.findMany({
      where: { colorwayId: keepId },
      select: { id: true, variantSku: true, sizeLabel: true, barcode: true, averageCostNok: true },
    }),
    prisma.variant.findMany({
      where: { colorwayId: loseId },
      select: { id: true, variantSku: true, sizeLabel: true, barcode: true, averageCostNok: true },
    }),
  ]);
  const keepBySize = new Map(
    keepVars.map((v) => [sizeKey(v.variantSku, keep.colorwaySku, v.sizeLabel), v])
  );

  const variants: VariantAction[] = [];
  const claimedNewSku = new Set(keepVars.map((v) => v.variantSku));
  for (const lv of loseVars) {
    const size = sizeKey(lv.variantSku, lose.colorwaySku, lv.sizeLabel);
    const match = keepBySize.get(size);
    if (match) {
      variants.push({
        kind: "fold",
        size,
        loserVariantId: lv.id,
        loserSku: lv.variantSku,
        survivorVariantId: match.id,
        survivorSku: match.variantSku,
        carriesBarcode: !hasText(match.barcode) && hasText(lv.barcode),
        carriesCost: match.averageCostNok == null && lv.averageCostNok != null,
      });
      continue;
    }
    const newSku = `${keep.colorwaySku}-${size}`;
    if (claimedNewSku.has(newSku)) {
      notes.push(
        `Variant ${lv.variantSku} would become ${newSku}, which is already taken — folding instead.`
      );
      variants.push({
        kind: "fold",
        size,
        loserVariantId: lv.id,
        loserSku: lv.variantSku,
        carriesBarcode: false,
        carriesCost: false,
      });
      continue;
    }
    const taken = await prisma.variant.findUnique({
      where: { variantSku: newSku },
      select: { id: true },
    });
    if (taken) {
      blockers.push(
        `Variant SKU ${newSku} is already held by another colorway — resolve that first.`
      );
      continue;
    }
    claimedNewSku.add(newSku);
    variants.push({
      kind: "move",
      size,
      loserVariantId: lv.id,
      loserSku: lv.variantSku,
      newSku,
      carriesBarcode: hasText(lv.barcode),
      carriesCost: lv.averageCostNok != null,
    });
  }

  // ---- Season entries ----
  const [keepEntries, loseEntries] = await Promise.all([
    prisma.seasonEntry.findMany({
      where: { colorwayId: keepId },
      select: { id: true, seasonId: true, season: { select: { code: true } } },
    }),
    prisma.seasonEntry.findMany({
      where: { colorwayId: loseId },
      select: { id: true, seasonId: true, season: { select: { code: true } } },
    }),
  ]);
  const keepSeasonIds = new Set(keepEntries.map((e) => e.seasonId));
  const entries = loseEntries.map((e) => ({
    seasonCode: e.season.code,
    seasonId: e.seasonId,
    action: keepSeasonIds.has(e.seasonId) ? ("fold" as const) : ("move" as const),
  }));

  // ---- Prices / images / media ----
  const [keepPrices, losePrices] = await Promise.all([
    prisma.price.findMany({
      where: { colorwayId: keepId },
      select: { seasonId: true, currency: true, priceType: true },
    }),
    prisma.price.findMany({
      where: { colorwayId: loseId },
      select: { id: true, seasonId: true, currency: true, priceType: true },
    }),
  ]);
  const keepPriceKeys = new Set(
    keepPrices.map((p) => `${p.seasonId}|${p.currency}|${p.priceType}`)
  );
  const prices = losePrices.map((p) => ({
    action: keepPriceKeys.has(`${p.seasonId}|${p.currency}|${p.priceType}`)
      ? ("drop" as const)
      : ("move" as const),
    currency: p.currency,
    priceType: String(p.priceType),
    seasonId: p.seasonId,
  }));

  const [keepImages, loseImages] = await Promise.all([
    prisma.seasonImage.findMany({
      where: { colorwayId: keepId },
      select: { seasonId: true, slot: true },
    }),
    prisma.seasonImage.findMany({
      where: { colorwayId: loseId },
      select: { id: true, seasonId: true, slot: true },
    }),
  ]);
  const keepImageKeys = new Set(keepImages.map((i) => `${i.seasonId}|${i.slot}`));
  const images = loseImages.map((i) => ({
    action: keepImageKeys.has(`${i.seasonId}|${i.slot}`)
      ? ("drop" as const)
      : ("move" as const),
    seasonId: i.seasonId,
    slot: String(i.slot),
  }));

  const media = await prisma.mediaAsset.count({ where: { colorwayId: loseId } });

  // ---- Channels / content / field ownership ----
  const [keepPubs, losePubs] = await Promise.all([
    prisma.channelPublication.findMany({
      where: { colorwayId: keepId },
      select: { channel: true },
    }),
    prisma.channelPublication.findMany({
      where: { colorwayId: loseId },
      select: { channel: true },
    }),
  ]);
  const keepChannels = new Set(keepPubs.map((p) => String(p.channel)));
  const publications = losePubs.map((p) => ({
    channel: String(p.channel),
    action: keepChannels.has(String(p.channel))
      ? ("keep-survivor" as const)
      : ("move" as const),
  }));

  const [keepContent, loseContent] = await Promise.all([
    prisma.channelContent.findMany({
      where: { colorwayId: keepId },
      select: { channel: true, field: true },
    }),
    prisma.channelContent.findMany({
      where: { colorwayId: loseId },
      select: { id: true, channel: true, field: true },
    }),
  ]);
  const keepContentKeys = new Set(keepContent.map((c) => `${c.channel}|${c.field}`));
  const channelContent = loseContent.map((c) => ({
    channel: String(c.channel),
    field: c.field,
    action: keepContentKeys.has(`${c.channel}|${c.field}`)
      ? ("keep-survivor" as const)
      : ("move" as const),
  }));

  // FieldOwner is not a foreign key, so nothing stops these stranding on a
  // retired colorway — and losing a MANUAL lock silently un-protects a hand
  // edit, which the next sync then overwrites.
  const [keepOwners, loseOwners] = await Promise.all([
    prisma.fieldOwner.findMany({
      where: { entityType: "colorway", entityId: keepId },
      select: { field: true },
    }),
    prisma.fieldOwner.findMany({
      where: { entityType: "colorway", entityId: loseId },
      select: { id: true, field: true },
    }),
  ]);
  const keepOwnerFields = new Set(keepOwners.map((o) => o.field));
  const fieldOwners = loseOwners.map((o) => ({
    field: o.field,
    action: keepOwnerFields.has(o.field)
      ? ("keep-survivor" as const)
      : ("move" as const),
  }));

  // ---- Scalar fill-if-empty ----
  const [keepRow, loseRow] = await Promise.all([
    prisma.colorway.findUniqueOrThrow({ where: { id: keepId } }),
    prisma.colorway.findUniqueOrThrow({ where: { id: loseId } }),
  ]);
  const kr = keepRow as unknown as Record<string, unknown>;
  const lr = loseRow as unknown as Record<string, unknown>;
  const fills: string[] = [];
  for (const f of TEXT_FILL_FIELDS)
    if (!hasText(kr[f]) && hasText(lr[f])) fills.push(f);
  for (const f of LIST_FILL_FIELDS) {
    const k = kr[f];
    const l = lr[f];
    if (Array.isArray(k) && Array.isArray(l) && k.length === 0 && l.length > 0)
      fills.push(f);
  }
  if (kr.weightKgOverride == null && lr.weightKgOverride != null)
    fills.push("weightKgOverride");

  const tagsAdded = (loseRow.tags ?? []).filter((t) => !(keepRow.tags ?? []).includes(t));

  return {
    keep,
    lose,
    blockers,
    notes,
    variants,
    entries,
    prices,
    images,
    media,
    publications,
    channelContent,
    fieldOwners,
    fills,
    tagsAdded,
    setsIsCore: !keepRow.isCore && loseRow.isCore,
    flipsSourceToThreadflow:
      keep.source !== "THREADFLOW" && lose.source === "THREADFLOW",
    loserParkedSku: `${lose.colorwaySku}--merged-into-${keepId.slice(0, 8)}`,
  };
}

export async function applyColorwayMerge(
  keepId: string,
  loseId: string,
  opts: MergeOptions = {}
): Promise<ColorwayMergeResult> {
  const plan = await previewColorwayMerge(keepId, loseId, opts);
  if (!opts.confirm)
    throw new Error("applyColorwayMerge needs confirm: true — preview it first");
  if (plan.blockers.length)
    throw new Error(`Refusing to merge:\n- ${plan.blockers.join("\n- ")}`);

  let variantsMoved = 0;
  let variantsFolded = 0;
  let barcodesCarried = 0;

  // 1. Variants the survivor lacks: rename onto its prefix and re-point.
  //    Their SeasonVariant links key on variant id, so they follow untouched.
  for (const a of plan.variants) {
    if (a.kind !== "move") continue;
    await prisma.variant.update({
      where: { id: a.loserVariantId },
      data: { variantSku: a.newSku!, colorwayId: keepId },
    });
    variantsMoved++;
  }

  // 2. Sizes both hold: keep the survivor's row, carry what it is missing, and
  //    re-point the loser variant's season links onto it.
  for (const a of plan.variants) {
    if (a.kind !== "fold") continue;
    if (a.survivorVariantId && (a.carriesBarcode || a.carriesCost)) {
      const lv = await prisma.variant.findUnique({
        where: { id: a.loserVariantId },
        select: { barcode: true, averageCostNok: true },
      });
      await prisma.variant.update({
        where: { id: a.survivorVariantId },
        data: {
          ...(a.carriesBarcode ? { barcode: lv?.barcode ?? null } : {}),
          ...(a.carriesCost ? { averageCostNok: lv?.averageCostNok ?? null } : {}),
        },
      });
      if (a.carriesBarcode) barcodesCarried++;
    }
    if (a.survivorVariantId) {
      const links = await prisma.seasonVariant.findMany({
        where: { variantId: a.loserVariantId },
        select: { seasonEntryId: true },
      });
      for (const l of links) {
        await prisma.seasonVariant.createMany({
          data: [{ seasonEntryId: l.seasonEntryId, variantId: a.survivorVariantId }],
          skipDuplicates: true,
        });
        await prisma.seasonVariant.delete({
          where: {
            seasonEntryId_variantId: {
              seasonEntryId: l.seasonEntryId,
              variantId: a.loserVariantId,
            },
          },
        });
      }
    }
    if (opts.deleteLoserVariants) {
      await prisma.variant.delete({ where: { id: a.loserVariantId } });
    } else {
      // Park rather than delete: reversible, and it frees the SKU so a later
      // Threadflow rename can land on it.
      const lv = await prisma.variant.findUnique({
        where: { id: a.loserVariantId },
        select: { variantSku: true },
      });
      if (lv && !lv.variantSku.includes("--merged-"))
        await prisma.variant.update({
          where: { id: a.loserVariantId },
          data: { variantSku: `${lv.variantSku}--merged-${keepId.slice(0, 8)}` },
        });
    }
    variantsFolded++;
  }

  // 3. Season entries.
  const loseEntries = await prisma.seasonEntry.findMany({
    where: { colorwayId: loseId },
    select: {
      id: true,
      seasonId: true,
      cancelled: true,
      approvedForProduction: true,
      drop: true,
      merchPosition: true,
      origin: true,
    },
  });
  for (const e of loseEntries) {
    const mine = await prisma.seasonEntry.findUnique({
      where: { colorwayId_seasonId: { colorwayId: keepId, seasonId: e.seasonId } },
      select: { id: true, drop: true, merchPosition: true },
    });
    if (!mine) {
      await prisma.seasonEntry.update({
        where: { id: e.id },
        data: { colorwayId: keepId },
      });
      continue;
    }
    // Fold: move the season's variant links across, keep whichever detail the
    // survivor is missing, then drop the duplicate entry.
    const links = await prisma.seasonVariant.findMany({
      where: { seasonEntryId: e.id },
      select: { variantId: true },
    });
    if (links.length)
      await prisma.seasonVariant.createMany({
        data: links.map((l) => ({ seasonEntryId: mine.id, variantId: l.variantId })),
        skipDuplicates: true,
      });
    await prisma.seasonEntry.update({
      where: { id: mine.id },
      data: {
        ...(mine.drop == null && e.drop != null ? { drop: e.drop } : {}),
        ...(mine.merchPosition == null && e.merchPosition != null
          ? { merchPosition: e.merchPosition }
          : {}),
      },
    });
    await prisma.seasonEntry.delete({ where: { id: e.id } });
  }

  // 4. Prices, images, media.
  const keepPriceKeys = new Set(
    (
      await prisma.price.findMany({
        where: { colorwayId: keepId },
        select: { seasonId: true, currency: true, priceType: true },
      })
    ).map((p) => `${p.seasonId}|${p.currency}|${p.priceType}`)
  );
  for (const p of await prisma.price.findMany({ where: { colorwayId: loseId } })) {
    const key = `${p.seasonId}|${p.currency}|${p.priceType}`;
    if (keepPriceKeys.has(key)) {
      await prisma.price.delete({ where: { id: p.id } });
    } else {
      keepPriceKeys.add(key);
      await prisma.price.update({ where: { id: p.id }, data: { colorwayId: keepId } });
    }
  }

  const keepImageKeys = new Set(
    (
      await prisma.seasonImage.findMany({
        where: { colorwayId: keepId },
        select: { seasonId: true, slot: true },
      })
    ).map((i) => `${i.seasonId}|${i.slot}`)
  );
  for (const i of await prisma.seasonImage.findMany({ where: { colorwayId: loseId } })) {
    const key = `${i.seasonId}|${i.slot}`;
    if (keepImageKeys.has(key)) {
      await prisma.seasonImage.delete({ where: { id: i.id } });
    } else {
      keepImageKeys.add(key);
      await prisma.seasonImage.update({
        where: { id: i.id },
        data: { colorwayId: keepId },
      });
    }
  }

  const maxPos =
    (
      await prisma.mediaAsset.aggregate({
        where: { colorwayId: keepId },
        _max: { position: true },
      })
    )._max.position ?? -1;
  const loseMedia = await prisma.mediaAsset.findMany({
    where: { colorwayId: loseId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < loseMedia.length; i++) {
    await prisma.mediaAsset.update({
      where: { id: loseMedia[i].id },
      data: { colorwayId: keepId, position: maxPos + 1 + i },
    });
  }

  // 5. Channel rows and field ownership.
  const keepChannels = new Set(
    (
      await prisma.channelPublication.findMany({
        where: { colorwayId: keepId },
        select: { channel: true },
      })
    ).map((p) => String(p.channel))
  );
  for (const p of await prisma.channelPublication.findMany({
    where: { colorwayId: loseId },
  })) {
    if (keepChannels.has(String(p.channel))) {
      await prisma.channelPublication.delete({ where: { id: p.id } });
    } else {
      keepChannels.add(String(p.channel));
      await prisma.channelPublication.update({
        where: { id: p.id },
        data: { colorwayId: keepId },
      });
    }
  }

  const keepContentKeys = new Set(
    (
      await prisma.channelContent.findMany({
        where: { colorwayId: keepId },
        select: { channel: true, field: true },
      })
    ).map((c) => `${c.channel}|${c.field}`)
  );
  for (const c of await prisma.channelContent.findMany({
    where: { colorwayId: loseId },
  })) {
    const key = `${c.channel}|${c.field}`;
    if (keepContentKeys.has(key)) {
      await prisma.channelContent.delete({ where: { id: c.id } });
    } else {
      keepContentKeys.add(key);
      await prisma.channelContent.update({
        where: { id: c.id },
        data: { colorwayId: keepId },
      });
    }
  }

  const keepOwnerFields = new Set(
    (
      await prisma.fieldOwner.findMany({
        where: { entityType: "colorway", entityId: keepId },
        select: { field: true },
      })
    ).map((o) => o.field)
  );
  for (const o of await prisma.fieldOwner.findMany({
    where: { entityType: "colorway", entityId: loseId },
  })) {
    if (keepOwnerFields.has(o.field)) {
      await prisma.fieldOwner.delete({ where: { id: o.id } });
    } else {
      keepOwnerFields.add(o.field);
      await prisma.fieldOwner.update({
        where: { id: o.id },
        data: { entityId: keepId },
      });
    }
  }

  // 6. Fill the survivor's empty columns, then retire the loser.
  if (plan.fills.length || plan.tagsAdded.length || plan.setsIsCore || plan.flipsSourceToThreadflow) {
    const loseRow = (await prisma.colorway.findUniqueOrThrow({
      where: { id: loseId },
    })) as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const f of plan.fills) data[f] = loseRow[f];
    if (plan.tagsAdded.length) {
      const keepRow = await prisma.colorway.findUniqueOrThrow({
        where: { id: keepId },
        select: { tags: true },
      });
      data.tags = [...keepRow.tags, ...plan.tagsAdded];
    }
    if (plan.setsIsCore) data.isCore = true;
    // The survivor is Threadflow-managed from here on, whatever imported it.
    if (plan.flipsSourceToThreadflow) data.source = "THREADFLOW";
    await prisma.colorway.update({ where: { id: keepId }, data });
  }

  // Park the SKU, release the Threadflow id, archive. Deliberately not a
  // delete: reversible, no FK dance, and the sync's "archived rows yield their
  // SKU" rule means a later run ignores it.
  await prisma.colorway.update({
    where: { id: loseId },
    data: {
      colorwaySku: plan.loserParkedSku,
      threadflowId: null,
      archived: true,
      status: "ARCHIVED",
    },
  });

  return { ...plan, applied: true, variantsMoved, variantsFolded, barcodesCarried };
}
