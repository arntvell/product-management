// Run: ORIGO_POSTGRES_PRISMA_URL=postgresql://nobody@127.0.0.1:1/none npx tsx --test src/lib/partner/colorway-sizes.test.ts
// (lib/db.ts insists on a URL at import; this one is never reached.)
// No database: the only one there is, is production. The call runs against an
// in-memory store; the FeedStyle comes from the real Loom payload builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addColorwaySizes,
  planColorwaySizes,
  type ColorwaySizesStore,
  type PlannedSize,
  type SizesColorway,
  type SizesSystem,
} from "./colorway-sizes";
import type { LoomColorway } from "@/lib/loom/payload";

const EU_SHOES: SizesSystem = {
  name: "EU Shoes",
  entries: ["40", "41", "42", "43", "44", "45", "46", "42.5"].map((l, i) => ({
    id: `e${i}`,
    sizeLabel: l,
    dim1: l,
    dim2: null,
    skuToken: l.replace(".", ""),
    archived: false,
  })).concat([{ id: "old", sizeLabel: "39", dim1: "39", dim2: null, skuToken: "39", archived: true }]),
};

function chambord(): SizesColorway {
  return {
    id: "cw1",
    colorwaySku: "EXT-PB-CHMBR-LSS-NR",
    status: "ACTIVE",
    archived: false,
    kind: "MERCHANDISE",
    source: "IMPORT",
    isLivid: false,
    variants: ["41", "42", "43"].map((l) => ({
      id: `v${l}`,
      variantSku: `EXT-PB-CHMBR-LSS-NR-${l}`,
      sizeLabel: l,
      dim1: l,
      dim2: null,
    })),
  };
}

/** Everything the call touches, in memory. */
function fakeStore(colorways: SizesColorway[], opts: { otherSkus?: Record<string, string> } = {}) {
  const writes: PlannedSize[][] = [];
  let n = 0;
  const store: ColorwaySizesStore = {
    async seasonExists(code) {
      return code === "SS27";
    },
    async findColorway(sku) {
      const cw = colorways.find((c) => c.colorwaySku === sku || c.colorwaySku === sku.toUpperCase());
      return cw ? structuredClone(cw) : null;
    },
    async sizeSystems() {
      return [EU_SHOES];
    },
    async skusTaken(skus) {
      return skus.filter((s) => opts.otherSkus?.[s]).map((s) => ({ variantSku: s, colorwaySku: opts.otherSkus![s] }));
    },
    async createVariants(cw, sizes) {
      writes.push(sizes);
      const target = colorways.find((c) => c.id === cw.id)!;
      for (const s of sizes)
        target.variants.push({ id: `new${++n}`, variantSku: s.sku, sizeLabel: s.sizeLabel, dim1: s.dim1, dim2: s.dim2 });
    },
    async loadForFeed(id, seasonCode) {
      const cw = colorways.find((c) => c.id === id)!;
      return [feedRow(cw, seasonCode)];
    },
  };
  return { store, writes };
}

/** The colourway as loadColorwaysForLoom returns it: live on Shopify and Sitoo, approved in FW26 only. */
function feedRow(cw: SizesColorway, seasonCode: string | null): LoomColorway {
  const inSeason = seasonCode === "FW26";
  return {
    id: cw.id,
    colorwaySku: cw.colorwaySku,
    name: "Lisse Noir",
    color: "Noir",
    swatchHex: null,
    isCore: false,
    tags: [],
    productType: "Shoe Men",
    hsCodeOverride: null,
    customsDescriptionOverride: null,
    weightKgOverride: null,
    fiberCompositionOverride: null,
    countryOfOrigin: "FR",
    manufacturerId: null,
    manufacturer: null,
    styleId: "st1",
    style: {
      id: "st1",
      styleSku: "EXT-PB-CHMBR",
      styleName: "Chambord",
      gender: "MEN",
      unisex: false,
      category: "Shoe Men",
      categoryRef: null,
      hsCode: "64039116",
      customsDescription: "Leather shoes",
      weightKg: null,
      fiberComposition: null,
    },
    brand: { name: "Paraboot", isLivid: false },
    categoryRef: null,
    prices: inSeason ? [{ priceType: "MSRP", currency: "NOK", amount: 6900 }] : [],
    seasonImages: [],
    entries: inSeason ? [{ cancelled: false, approvedForProduction: true }] : [],
    publications: [
      { channel: "SHOPIFY", published: true, externalId: "gid://shopify/Product/1" },
      { channel: "SITOO", published: true, externalId: null },
      { channel: "LOOM", published: true, externalId: null },
    ],
    variants: cw.variants.map((v) => ({
      ...v,
      barcode: v.id.startsWith("new") ? null : `360662000${v.sizeLabel}`,
      channelRefs: v.id.startsWith("new")
        ? []
        : [{ channel: "SITOO", externalId: `s${v.sizeLabel}`, externalSku: null }],
    })),
  } as unknown as LoomColorway;
}

type Ok = Extract<Awaited<ReturnType<typeof addColorwaySizes>>["items"][number], { ok: true }>;
const item = (sizes: string[], key = "line-1", sku = "EXT-PB-CHMBR-LSS-NR") => ({
  loom_key: key,
  colorway_sku: sku,
  sizes,
  cost_nok: 2343.2,
  msrp_nok: 6900,
});

test("dry run: the SKUs it would give, nothing saved", async () => {
  const cws = [chambord()];
  const { store, writes } = fakeStore(cws);
  const r = await addColorwaySizes({ dry_run: true, items: [item(["46", "42.5"])] }, store);
  assert.equal(r.dryRun, true);
  const o = r.items[0] as Ok;
  assert.equal(o.ok, true);
  assert.deepEqual(o.variant_skus, { "46": "EXT-PB-CHMBR-LSS-NR-46", "42.5": "EXT-PB-CHMBR-LSS-NR-425" });
  assert.equal(o.style, undefined);
  assert.equal(writes.length, 0);
  assert.equal(cws[0].variants.length, 3);
});

test("anything but dry_run: false is a dry run", async () => {
  const { store, writes } = fakeStore([chambord()]);
  await addColorwaySizes({ items: [item(["46"])] }, store);
  await addColorwaySizes({ dry_run: "false", items: [item(["46"])] }, store);
  assert.equal(writes.length, 0);
});

test("real call: adds the size, no barcode, returns its SKU", async () => {
  const cws = [chambord()];
  const { store, writes } = fakeStore(cws);
  const r = await addColorwaySizes({ dry_run: false, items: [item(["46"])] }, store);
  const o = r.items[0] as Ok;
  assert.equal(o.ok, true);
  assert.deepEqual(o.variant_skus, { "46": "EXT-PB-CHMBR-LSS-NR-46" });
  assert.deepEqual(o.existing, []);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].map((s) => [s.sku, s.sizeLabel, s.dim1]), [["EXT-PB-CHMBR-LSS-NR-46", "46", "46"]]);
  assert.equal(cws[0].variants.length, 4);
});

test("a size the colourway already has is a no-op with its existing SKU", async () => {
  const { store, writes } = fakeStore([chambord()]);
  const r = await addColorwaySizes({ dry_run: false, items: [item(["42", "46"])] }, store);
  const o = r.items[0] as Ok;
  assert.deepEqual(o.variant_skus, { "42": "EXT-PB-CHMBR-LSS-NR-42", "46": "EXT-PB-CHMBR-LSS-NR-46" });
  assert.deepEqual(o.existing, ["42"]);
  assert.deepEqual(writes[0].map((s) => s.sizeLabel), ["46"]);

  const only = await addColorwaySizes({ dry_run: false, items: [item(["43"], "line-2")] }, store);
  assert.equal(only.items[0].ok, true);
  assert.equal(writes.length, 1, "nothing written for a size it has");
});

test("unknown colourway is refused per item, for a buyer", async () => {
  const { store } = fakeStore([chambord()]);
  const r = await addColorwaySizes(
    { dry_run: false, items: [item(["46"], "a", "EXT-NOPE-NOTHING"), item(["46"], "b")] },
    store
  );
  assert.deepEqual(r.items[0], {
    loom_key: "a",
    ok: false,
    colorway_sku: "EXT-NOPE-NOTHING",
    error: "Origio has no colourway EXT-NOPE-NOTHING",
  });
  assert.equal(r.items[1].ok, true, "one refusal does not stop the rest");
});

test("idempotent: a repeated real call creates nothing and returns the same SKUs and style", async () => {
  const { store, writes } = fakeStore([chambord()]);
  const first = (await addColorwaySizes({ dry_run: false, items: [item(["46", "44"])] }, store)).items[0] as Ok;
  const again = (await addColorwaySizes({ dry_run: false, items: [item(["46", "44"])] }, store)).items[0] as Ok;
  assert.equal(writes.length, 1);
  assert.deepEqual(again.variant_skus, first.variant_skus);
  assert.deepEqual(again.existing, ["46", "44"]);
  assert.deepEqual(again.style, first.style);
});

test("style is the WHOLE colourway: every size with its variant_id, channels as they are", async () => {
  const { store } = fakeStore([chambord()]);
  const o = (await addColorwaySizes({ dry_run: false, items: [item(["46"])] }, store)).items[0] as Ok;
  const style = o.style as { style_id: string; style_sku: string; colorways: Array<Record<string, unknown>> };
  assert.equal(style.style_id, "st1");
  assert.equal(style.style_sku, "EXT-PB-CHMBR");
  assert.equal(style.colorways.length, 1);
  const c = style.colorways[0] as {
    colorway_id: string;
    colorway_sku: string;
    channels: Record<string, boolean>;
    approved_for_production: boolean;
    dropped: boolean;
    prices: Record<string, unknown>;
    variants: Array<{ variant_id: string; sku: string; barcode: string | null; dimensions: { size: string } }>;
  };
  assert.equal(c.colorway_id, "cw1");
  assert.deepEqual(
    c.variants.map((v) => [v.variant_id, v.sku, v.dimensions.size]).sort(),
    [
      ["new1", "EXT-PB-CHMBR-LSS-NR-46", "46"],
      ["v41", "EXT-PB-CHMBR-LSS-NR-41", "41"],
      ["v42", "EXT-PB-CHMBR-LSS-NR-42", "42"],
      ["v43", "EXT-PB-CHMBR-LSS-NR-43", "43"],
    ]
  );
  assert.equal(c.variants.find((v) => v.variant_id === "new1")!.barcode, null);
  assert.equal(c.variants.find((v) => v.variant_id === "v42")!.barcode, "36066200042");
  // A carry-over live on Shopify and Sitoo stays declared there.
  assert.deepEqual(c.channels, { loom: true, shopify: true, sitoo: true });
  // Applied to the plan's season, where Origio has no entry yet: bought, so approved.
  assert.equal(c.approved_for_production, true);
  assert.equal(c.dropped, false);
  // No season sent: no prices, so Loom keeps the ones it has.
  assert.deepEqual(c.prices, {});
});

test("season sent: the style carries that season's prices; an unknown season is a 400", async () => {
  const { store } = fakeStore([chambord()]);
  await assert.rejects(addColorwaySizes({ dry_run: true, season: "XX99", items: [] }, store), /no season XX99/);
  const { store: s2 } = fakeStore([chambord()]);
  s2.seasonExists = async () => true;
  const o = (await addColorwaySizes({ dry_run: false, season: "fw26", items: [item(["46"])] }, s2)).items[0] as Ok;
  const c = (o.style as { colorways: Array<{ prices: unknown }> }).colorways[0];
  assert.deepEqual(c.prices, { NOK: { msrp: 6900 } });
});

test("a SKU held by another colourway is a collision, nothing written", async () => {
  const { store, writes } = fakeStore([chambord()], { otherSkus: { "EXT-PB-CHMBR-LSS-NR-46": "EXT-PB-OTHER" } });
  const r = await addColorwaySizes({ dry_run: false, items: [item(["46"])] }, store);
  assert.equal(r.items[0].ok, false);
  assert.match((r.items[0] as { error: string }).error, /collision: EXT-PB-CHMBR-LSS-NR-46 exists on EXT-PB-OTHER/);
  assert.equal(writes.length, 0);
});

test("items without an array of items is a 400", async () => {
  const { store } = fakeStore([]);
  await assert.rejects(addColorwaySizes({ dry_run: true }, store), /items must be an array/);
});

// --- the planner's rules ---

test("labels: '42,5' and '42.5' are one size; the size system's spelling and token win", () => {
  const p = planColorwaySizes(chambord(), [EU_SHOES], ["42,5", "42.5"]);
  assert.ok(p.ok);
  assert.equal(p.sizes.length, 1);
  assert.equal(p.sizes[0].asked, "42,5");
  assert.equal(p.sizes[0].sizeLabel, "42.5");
  assert.equal(p.sizes[0].sku, "EXT-PB-CHMBR-LSS-NR-425");
});

test("a label the colourway's size system lacks is refused, naming the sizes it has", () => {
  const p = planColorwaySizes(chambord(), [EU_SHOES], ["47"]);
  assert.equal(p.ok, false);
  assert.match((p as { error: string }).error, /^47 is not a size in Origio's EU Shoes size system, which EXT-PB-CHMBR-LSS-NR is sized in \(40, 41, .*\); pick one of those/);
});

test("with no size system that fits, a label is added as written, with a warning", () => {
  const p = planColorwaySizes(chambord(), [], ["47"]);
  assert.ok(p.ok);
  assert.equal(p.sizes[0].adHoc, true);
  assert.equal(p.sizes[0].sku, "EXT-PB-CHMBR-LSS-NR-47");
  assert.match(p.warnings.join(" "), /no Origio size system fits EXT-PB-CHMBR-LSS-NR; size\(s\) 47 added as written/);
});

test("several candidate systems: a label any of them has is taken from it; none has it, refused", () => {
  const UK: SizesSystem = {
    name: "UK Shoes",
    entries: ["41", "42", "43", "12"].map((l) => ({ id: `uk${l}`, sizeLabel: l, dim1: l, dim2: null, skuToken: l, archived: false })),
  };
  const p = planColorwaySizes(chambord(), [EU_SHOES, UK], ["12"]);
  assert.ok(p.ok);
  assert.equal(p.sizes[0].sku, "EXT-PB-CHMBR-LSS-NR-12");
  const q = planColorwaySizes(chambord(), [EU_SHOES, UK], ["99"]);
  assert.equal(q.ok, false);
  assert.match((q as { error: string }).error, /^99 is not a size in any of the size systems EXT-PB-CHMBR-LSS-NR fits \(EU Shoes, UK Shoes\)/);
});

test("a size the colourway itself just got (a racing call) is not a collision", async () => {
  const cws = [chambord()];
  const { store, writes } = fakeStore(cws, { otherSkus: { "EXT-PB-CHMBR-LSS-NR-46": "EXT-PB-CHMBR-LSS-NR" } });
  const r = await addColorwaySizes({ dry_run: false, items: [item(["46"])] }, store);
  assert.equal(r.items[0].ok, true);
  assert.equal(writes.length, 1);
});

test("a size retired from the size system is refused", () => {
  const p = planColorwaySizes(chambord(), [EU_SHOES], ["39"]);
  assert.deepEqual(p, { ok: false, error: "size 39 has been retired from Origio's EU Shoes size system" });
});

test("waist × length products take no ad hoc size", () => {
  const cw = chambord();
  cw.variants = [{ id: "j", variantSku: "EXT-X-J-3234", sizeLabel: "32/34", dim1: "32", dim2: "34" }];
  cw.colorwaySku = "EXT-X-J";
  const p = planColorwaySizes(cw, [], ["33"]);
  assert.equal(p.ok, false);
  assert.match((p as { error: string }).error, /waist × length/);
});

test("new sizes follow the siblings' stem, and siblings that disagree are refused", () => {
  const drifted = chambord();
  drifted.colorwaySku = "EXT-PB-CHMBR-NR";
  const p = planColorwaySizes(drifted, [EU_SHOES], ["46"]);
  assert.ok(p.ok);
  assert.equal(p.sizes[0].sku, "EXT-PB-CHMBR-LSS-NR-46");

  const mixed = chambord();
  mixed.variants[0].variantSku = "EXT-PB-OLD-41";
  const q = planColorwaySizes(mixed, [EU_SHOES], ["46"]);
  assert.equal(q.ok, false);
  assert.match((q as { error: string }).error, /cannot tell which SKU/);
  // ...but a size it already has still answers.
  assert.ok(planColorwaySizes(mixed, [EU_SHOES], ["42"]).ok);
});

test("Livid, archived and non-merchandise colourways are refused", () => {
  const livid = { ...chambord(), isLivid: true };
  const archived = { ...chambord(), status: "ARCHIVED" };
  const material = { ...chambord(), kind: "MATERIAL" };
  assert.match((planColorwaySizes(livid, [EU_SHOES], ["46"]) as { error: string }).error, /Threadflow/);
  assert.match((planColorwaySizes(archived, [EU_SHOES], ["46"]) as { error: string }).error, /archived/);
  assert.match((planColorwaySizes(material, [EU_SHOES], ["46"]) as { error: string }).error, /not merchandise/);
});

test("no sizes is refused", () => {
  assert.deepEqual(planColorwaySizes(chambord(), [EU_SHOES], ["", " "]), { ok: false, error: "no sizes" });
});
