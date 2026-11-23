// custom.same_product — "Same product, different colors/materials" — the list
// the webshop turns into a style's other colour options.
//
// Kept up to date from what Shopify says right now, because every input moves
// on its own: a colour goes live, sells out, is restocked, or is tagged SALE.
//
// The rule (decided 2026-11-23):
//   - Only LIVE Livid products get a list: Shopify ACTIVE, not tagged hide /
//     rocket-hide. Drafts and hidden products are left exactly as they are.
//   - A colour is LISTED only if it is live and IN STOCK (totalInventory > 0).
//     A sold-out product still gets its own list; it just isn't offered on others.
//   - Family = same style NAME, so two style rows called "Barnes" are one family.
//   - Full-price products list full-price siblings only. SALE products list
//     sale AND full-price siblings. SALE = any tag containing "sale" except
//     presale tags ("presale-ss26" is a launch, not a discount).
//   - Links someone made by hand to another product (Fuller <-> Fuller Chino)
//     are kept while they pass the same tests; links that fail them are dropped.
//     Existing order is kept and new siblings are appended.
//
// Writes only this metafield (metafieldsSet / metafieldsDelete) and mirrors the
// list into Colorway.sameProduct as master ids, so a push sends what Shopify
// already holds instead of reverting it. Dry run unless `apply`.
import { prisma } from "@/lib/db";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { HIDE_TAGS } from "@/lib/shopify/reveal";
import { METAFIELDS_DELETE_MUTATION, METAFIELDS_SET_MUTATION } from "@/lib/shopify/mutations";

export interface SameProductChange {
  colorwayId: string;
  sku: string;
  gid: string;
  list: string[];
  add: string[];
  drop: string[];
}

export interface SameProductRun {
  applied: boolean;
  liveProducts: number;
  unchanged: number;
  changes: SameProductChange[];
  linksAdded: number;
  linksDropped: number;
  written: number;
  /** Shopify already right, Origio's Colorway.sameProduct was not — Origio only. */
  origioFixes: Array<{ colorwayId: string; sku: string; masterIds: string[] }>;
  origioFixed: number;
  /**
   * Upcoming products not on Shopify yet (FW26/SS27): their list is set in
   * Origio, so a create launches them with their colours already linked. They
   * count as full-price, and are offered on other pages only once they are live.
   */
  prelaunch: Array<{ colorwayId: string; sku: string; masterIds: string[] }>;
  prelaunchFixed: number;
  errors: string[];
  /** Labels for the GIDs in `changes`, for reporting. */
  labels: Record<string, string>;
}

/** Seasons whose not-yet-published products get their list ahead of launch. */
const PRELAUNCH_SEASONS = ["FW26", "SS27"];

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
export const isSaleTag = (t: string) => /sale/i.test(t) && !/presale/i.test(t);

interface ShopState {
  status: string;
  hidden: boolean;
  sale: boolean;
  inStock: boolean;
  same: string[];
  title: string;
}

async function readShopify(gids: string[]): Promise<Map<string, ShopState>> {
  const out = new Map<string, ShopState>();
  for (let i = 0; i < gids.length; i += 50) {
    const r = await shopifyGraphQL<{
      nodes: Array<{ id: string; title: string; status: string; tags: string[]; totalInventory: number; sp: { value: string } | null } | null>;
    }>(
      `query($ids:[ID!]!){nodes(ids:$ids){... on Product{id title status tags totalInventory sp:metafield(namespace:"custom",key:"same_product"){value}}}}`,
      { ids: gids.slice(i, i + 50) }
    );
    for (const n of r.nodes ?? []) {
      if (!n?.id) continue;
      out.set(n.id, {
        status: n.status,
        hidden: n.tags.some((t) => (HIDE_TAGS as readonly string[]).includes(t)),
        sale: n.tags.some(isSaleTag),
        inStock: (n.totalInventory ?? 0) > 0,
        same: n.sp?.value ? (JSON.parse(n.sp.value) as string[]) : [],
        title: n.title,
      });
    }
  }
  return out;
}

export async function runSameProduct(opts: { apply?: boolean } = {}): Promise<SameProductRun> {
  const pubs = await prisma.channelPublication.findMany({
    where: { channel: "SHOPIFY", externalId: { not: null }, colorway: { archived: false } },
    select: {
      externalId: true,
      colorway: {
        select: { id: true, colorwaySku: true, sameProduct: true, brand: { select: { isLivid: true } }, style: { select: { styleName: true } } },
      },
    },
  });
  const byGid = new Map(pubs.map((p) => [p.externalId!, p.colorway]));
  const livid = pubs.filter((p) => p.colorway.brand?.isLivid);

  const shop = await readShopify(livid.map((p) => p.externalId!));
  // Targets of existing links that are not Livid products Origio holds.
  const strays = [...new Set([...shop.values()].flatMap((s) => s.same))].filter((g) => !shop.has(g));
  for (const [g, s] of await readShopify(strays)) shop.set(g, s);

  const isLive = (g: string) => {
    const s = shop.get(g);
    return !!s && s.status === "ACTIVE" && !s.hidden;
  };
  const listable = (g: string, forSale: boolean) => {
    const s = shop.get(g);
    return !!s && isLive(g) && s.inStock && (forSale || !s.sale);
  };

  // Master ids only: a kept link to a product Origio does not hold stays on
  // Shopify but cannot be represented here.
  const toMasterIds = (gids: string[]) =>
    gids.map((g) => byGid.get(g)?.id).filter((x): x is string => !!x);

  const family = new Map<string, string[]>();
  for (const p of livid) {
    const k = norm(p.colorway.style.styleName);
    family.set(k, [...(family.get(k) ?? []), p.externalId!]);
  }

  const run: SameProductRun = {
    applied: !!opts.apply, liveProducts: 0, unchanged: 0, changes: [], linksAdded: 0, linksDropped: 0, written: 0, origioFixes: [], origioFixed: 0, prelaunch: [], prelaunchFixed: 0, errors: [], labels: {},
  };
  for (const p of livid) {
    const gid = p.externalId!;
    if (!isLive(gid)) continue;
    run.liveProducts++;
    const me = shop.get(gid)!;
    const have = me.same;
    const keep = have.filter((g) => g !== gid && listable(g, me.sale));
    const siblings = (family.get(norm(p.colorway.style.styleName)) ?? []).filter((g) => g !== gid && listable(g, me.sale));
    const list = [...new Set([...keep, ...siblings])];
    const add = list.filter((g) => !have.includes(g));
    const drop = have.filter((g) => !list.includes(g));
    if (!add.length && !drop.length) {
      run.unchanged++;
      // Shopify is right; make sure Origio says the same, or the next push
      // would send Origio's (stale) list and undo it.
      const masterIds = toMasterIds(list);
      if (JSON.stringify(masterIds) !== JSON.stringify(p.colorway.sameProduct))
        run.origioFixes.push({ colorwayId: p.colorway.id, sku: p.colorway.colorwaySku, masterIds });
      continue;
    }
    run.linksAdded += add.length;
    run.linksDropped += drop.length;
    run.changes.push({ colorwayId: p.colorway.id, sku: p.colorway.colorwaySku, gid, list, add, drop });
  }
  for (const c of run.changes)
    for (const g of [...c.add, ...c.drop]) run.labels[g] = byGid.get(g)?.colorwaySku ?? shop.get(g)?.title ?? g;

  const upcoming = await prisma.colorway.findMany({
    where: {
      archived: false,
      brand: { isLivid: true },
      entries: { some: { season: { code: { in: PRELAUNCH_SEASONS } } } },
      NOT: { publications: { some: { channel: "SHOPIFY", externalId: { not: null } } } },
    },
    select: { id: true, colorwaySku: true, sameProduct: true, style: { select: { styleName: true } } },
  });
  for (const u of upcoming) {
    const siblings = (family.get(norm(u.style.styleName)) ?? []).filter((g) => listable(g, false));
    const masterIds = toMasterIds(siblings);
    if (JSON.stringify(masterIds) !== JSON.stringify(u.sameProduct))
      run.prelaunch.push({ colorwayId: u.id, sku: u.colorwaySku, masterIds });
  }

  if (!opts.apply) return run;

  for (const c of run.changes) {
    try {
      if (c.list.length) {
        const r = await shopifyGraphQL<{ metafieldsSet: { userErrors: { message: string }[] } }>(METAFIELDS_SET_MUTATION, {
          metafields: [{ ownerId: c.gid, namespace: "custom", key: "same_product", type: "list.product_reference", value: JSON.stringify(c.list) }],
        });
        if (r.metafieldsSet.userErrors.length) throw new Error(r.metafieldsSet.userErrors.map((e) => e.message).join("; "));
      } else {
        const r = await shopifyGraphQL<{ metafieldsDelete: { userErrors: { message: string }[] } }>(METAFIELDS_DELETE_MUTATION, {
          metafields: [{ ownerId: c.gid, namespace: "custom", key: "same_product" }],
        });
        if (r.metafieldsDelete.userErrors.length) throw new Error(r.metafieldsDelete.userErrors.map((e) => e.message).join("; "));
      }
      await prisma.colorway.update({ where: { id: c.colorwayId }, data: { sameProduct: toMasterIds(c.list) } });
      run.written++;
    } catch (err) {
      run.errors.push(`${c.sku}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const f of run.prelaunch) {
    await prisma.colorway.update({ where: { id: f.colorwayId }, data: { sameProduct: f.masterIds } });
    run.prelaunchFixed++;
  }
  for (const f of run.origioFixes) {
    await prisma.colorway.update({ where: { id: f.colorwayId }, data: { sameProduct: f.masterIds } });
    run.origioFixed++;
  }
  return run;
}
