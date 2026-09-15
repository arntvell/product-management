// Drives a whole draft through the HTTP API, the way the wizard does.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-wizard-flow.ts [baseUrl]
//
// Needs the dev server running. Exercises the parts that only exist over HTTP:
// the compare-and-swap on autosave, the barcode CSV round-trip (including a bad
// check digit, a duplicate and an unknown SKU), pre-flight, and finalize.
// Cleans up everything it creates.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { buildStyleSku, buildColorwaySku, buildVariantSku } from "../src/lib/master/sku.ts";
import { emptyDraftPayload, type DraftPayloadV1 } from "../src/lib/master/draft-payload.ts";
import { parseCsvRecords } from "../src/lib/csv.ts";
import { getColorwayForPublish, buildShopifyPreview } from "../src/lib/master/publish.ts";
import {
  loadColorwaysForLoom,
  buildLoomPayloadFromColorways,
} from "../src/lib/loom/payload.ts";

const BASE = process.argv[2] ?? "http://localhost:3000";
const PASSWORD = process.env.APP_PASSWORD ?? "";
const TAG = "ZZW" + Date.now().toString(36).toUpperCase().slice(-5);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
};

/** GS1 mod-10 check digit, so the fixture is a valid EAN-13 rather than a guess. */
function ean13(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return first12 + String((10 - (sum % 10)) % 10);
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "content-type": "application/json",
      authorization: `Bearer ${PASSWORD}`,
    },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json, text };
}

async function main() {
  const brand = await prisma.brand.create({
    data: { name: `ZZ Wizard ${TAG}`, isLivid: false, skuToken: TAG },
  });
  const season = await prisma.season.findFirstOrThrow({ where: { code: "CONTINUITY" } });
  // A modelled category with a mapped spelling for each channel: the point is
  // that the ID reaches Style and Colorway, and that the pushes read the mapping
  // rather than the free text.
  const category = await prisma.category.create({
    data: {
      slug: `zz-wizard-${TAG.toLowerCase()}`,
      name: `ZZ Wizard ${TAG}`,
      path: `zz-wizard-${TAG.toLowerCase()}`,
      depth: 0,
      shopifyProductType: "ZZ Shopify Boots",
      loomCategory: "Outerwear",
    },
  });
  const sizeSystem = await prisma.sizeSystem.create({
    data: {
      name: `ZZ Sizes ${TAG}`,
      kind: "ONE_D",
      entries: {
        create: ["41", "42", "9.5"].map((s, i) => ({
          sizeLabel: s,
          dim1: s,
          skuToken: s,
          position: i,
        })),
      },
    },
    include: { entries: { orderBy: { position: "asc" } } },
  });

  // --- brand settings must actually reach the wizard ---
  await prisma.brandTemplate.create({
    data: {
      brandId: brand.id,
      category: category.name,
      hsCode: "6403991100",
      countryOfOrigin: "France",
      defaultSizeSystemId: sizeSystem.id,
      channels: ["SHOPIFY", "LOOM"],
    },
  });
  const tpl = await api(`/api/catalog/brands/${brand.id}/template`);
  const t = (tpl.json.template ?? {}) as Record<string, unknown>;
  check("brand template served", tpl.status === 200 && !!tpl.json.template, String(tpl.status));
  check("free-text category resolves to a Category id", t.categoryId === category.id, String(t.categoryId));
  check("default size system comes with it", t.defaultSizeSystemId === sizeSystem.id, String(t.defaultSizeSystemId));
  check("customs defaults come with it", t.hsCode === "6403991100" && t.countryOfOrigin === "France");

  // --- create a draft ---
  const created = await api("/api/catalog/drafts", { method: "POST" });
  check("draft created", created.status === 201, String(created.status));
  const draftId = created.json.id as string;

  const styleSku = buildStyleSku({ prefix: "EXT", brandToken: TAG, style: "Wizard Boot" });
  const cwSku = buildColorwaySku(styleSku, "Dark Brown");
  const payload: DraftPayloadV1 = {
    ...emptyDraftPayload(),
    brand: { id: brand.id, name: brand.name, skuToken: TAG, isLivid: false },
    seasonId: season.id,
    template: {
      ...emptyDraftPayload().template,
      categoryId: category.id,
      category: category.name,
      countryOfOrigin: "France",
    },
    style: { mode: "new", styleName: "Wizard Boot", styleSku, manualSku: false },
    colorways: [
      {
        key: "cw0",
        name: "Dark Brown",
        color: "Dark Brown",
        swatchHex: null,
        colorwaySku: cwSku,
        manualSku: false,
        kind: null,
        sizeSystemId: sizeSystem.id,
        variants: sizeSystem.entries.map((e, i) => ({
          key: `v${i}`,
          entryId: e.id,
          sizeLabel: e.sizeLabel,
          dim1: e.dim1,
          dim2: e.dim2,
          skuToken: e.skuToken,
          variantSku: buildVariantSku(cwSku, e.skuToken),
          barcode: null,
          barcodeSource: null,
        })),
        prices: { COST: "889.00", MSRP: "2600.00" },
      },
    ],
  };

  // --- autosave, and the compare-and-swap ---
  const saved = await api(`/api/catalog/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify({ revision: 0, payload, step: "review" }),
  });
  check("autosave accepted", saved.status === 200, String(saved.status));
  check("revision advanced", saved.json.revision === 1, String(saved.json.revision));

  const stale = await api(`/api/catalog/drafts/${draftId}`, {
    method: "PUT",
    body: JSON.stringify({ revision: 0, payload, step: "review" }),
  });
  check("stale revision refused with 409", stale.status === 409, String(stale.status));

  // --- barcode CSV export ---
  const csvRes = await fetch(`${BASE}/api/catalog/drafts/${draftId}/barcodes`, {
    headers: { authorization: `Bearer ${PASSWORD}` },
  });
  // Read bytes, not text: res.text() strips a leading BOM per the WHATWG decode
  // spec, so a text comparison can never see the thing we are checking for.
  const bytes = new Uint8Array(await csvRes.clone().arrayBuffer());
  const csv = await csvRes.text();
  check("csv exported", csvRes.status === 200);
  check(
    "csv has a UTF-8 BOM for Excel",
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
    [...bytes.slice(0, 3)].join(",")
  );
  const records = parseCsvRecords(csv);
  check("csv has one row per size", records.length === 3, `got ${records.length}`);
  check(
    "csv is in size-system order, not alphabetical",
    records.map((r) => r.Size).join(",") === "41,42,9.5",
    records.map((r) => r.Size).join(",")
  );

  // --- barcode CSV import: one good, one bad check digit, one duplicate, one unknown ---
  // A free code on a prefix nobody uses. The first draft of this script reached
  // for 7072536051729, which is a REAL Livid barcode — Barnes Japan Dawn 30/32,
  // straight out of docs/sitoo-barnes-recreate.md — and pre-flight refused the
  // whole batch. That was the guard working; the test data was wrong.
  const good = ean13("999999900001");
  const badDigit = good.slice(0, 12) + ((Number(good[12]) + 1) % 10);
  const rows = [
    ["Style", "Style SKU", "Colourway", "Colourway SKU", "Size", "Variant SKU", "Barcode"],
    ["Wizard Boot", styleSku, "Dark Brown", cwSku, "42", buildVariantSku(cwSku, "42"), good],
    ["Wizard Boot", styleSku, "Dark Brown", cwSku, "41", buildVariantSku(cwSku, "41"), badDigit],
    ["Wizard Boot", styleSku, "Dark Brown", cwSku, "9.5", buildVariantSku(cwSku, "9.5"), good],
    ["Wizard Boot", styleSku, "Dark Brown", cwSku, "99", "EXT-NOT-IN-THIS-DRAFT-99", good],
  ];
  const upload = rows.map((r) => r.join(",")).join("\r\n");
  const imported = await api(`/api/catalog/drafts/${draftId}/barcodes`, {
    method: "POST",
    body: JSON.stringify({ csv: upload, revision: 1 }),
  });
  check("csv import accepted", imported.status === 200, String(imported.status));
  const report = imported.json.report as Record<string, unknown>;
  check("one barcode filled", report.filled === 1, JSON.stringify(report.filled));
  check(
    "bad check digit rejected",
    (report.rejected as unknown[]).length === 2,
    JSON.stringify(report.rejected)
  );
  check(
    "unknown SKU reported, not created",
    (report.unknown as string[]).length === 1,
    JSON.stringify(report.unknown)
  );

  // --- preflight ---
  const pre = await api(`/api/catalog/drafts/${draftId}/preflight`, { method: "POST" });
  check("preflight ok", pre.status === 200 && (pre.json.report as { ok: boolean }).ok,
    JSON.stringify((pre.json.report as { errors: string[] })?.errors));

  // --- finalize ---
  const fin = await api(`/api/catalog/drafts/${draftId}/finalize`, { method: "POST" });
  check("finalize created", fin.status === 201, fin.text.slice(0, 200));

  const styles = await prisma.style.count({ where: { brandId: brand.id } });
  const colorways = await prisma.colorway.count({ where: { brandId: brand.id } });
  const variants = await prisma.variant.count({ where: { colorway: { brandId: brand.id } } });
  const barcoded = await prisma.variant.count({
    where: { colorway: { brandId: brand.id }, barcode: { not: null } },
  });
  check("1 style, 1 colorway, 3 variants",
    styles === 1 && colorways === 1 && variants === 3,
    `${styles}/${colorways}/${variants}`);
  check("the one good barcode landed", barcoded === 1, String(barcoded));

  // --- the category model, and the status the product is born in ---
  const styleRow = await prisma.style.findFirstOrThrow({ where: { brandId: brand.id } });
  const cwRow = await prisma.colorway.findFirstOrThrow({ where: { brandId: brand.id } });
  check("style carries the category id", styleRow.categoryId === category.id, String(styleRow.categoryId));
  check("colorway carries the category id", cwRow.categoryId === category.id, String(cwRow.categoryId));
  // A product created here has no description and no photograph. Born ACTIVE it
  // would reach the storefront on the first push; DRAFT makes going live a
  // decision taken on /catalog/publishing.
  check("born DRAFT, not live", cwRow.status === "DRAFT", cwRow.status);

  // The pushes must read the MAPPING, not the free text. Both are built without
  // touching a channel, so this is a pure payload assertion.
  const preview = buildShopifyPreview(await getColorwayForPublish(cwRow.id, "CONTINUITY") as never);
  check("Shopify sends the mapped product type",
    preview.product.productType === "ZZ Shopify Boots",
    String(preview.product.productType));

  const loomRows = await loadColorwaysForLoom([cwRow.id], "CONTINUITY");
  const loomPayload = buildLoomPayloadFromColorways(loomRows, "CONTINUITY", new Set(), undefined, "data");
  const loomCw = loomPayload.styles[0]?.colorways[0] as { product_type?: string } | undefined;
  check("Loom sends the mapped category", loomCw?.product_type === "Outerwear", String(loomCw?.product_type));

  // --- finalizing again is a no-op ---
  const again = await api(`/api/catalog/drafts/${draftId}/finalize`, { method: "POST" });
  check("second finalize is safe", again.status === 201 || again.status === 200, String(again.status));
  check("still 1 colorway",
    (await prisma.colorway.count({ where: { brandId: brand.id } })) === 1);

  // --- cleanup ---
  const cwIds = (await prisma.colorway.findMany({ where: { brandId: brand.id }, select: { id: true } })).map((c) => c.id);
  await prisma.productDraft.deleteMany({ where: { id: draftId } });
  await prisma.brandTemplate.deleteMany({ where: { brandId: brand.id } });
  await prisma.fieldOwner.deleteMany({ where: { entityType: "colorway", entityId: { in: cwIds } } });
  await prisma.colorway.deleteMany({ where: { brandId: brand.id } });
  await prisma.style.deleteMany({ where: { brandId: brand.id } });
  await prisma.brand.delete({ where: { id: brand.id } });
  await prisma.sizeSystem.delete({ where: { id: sizeSystem.id } });
  await prisma.category.delete({ where: { id: category.id } });
  check("cleaned up", (await prisma.brand.count({ where: { name: { startsWith: "ZZ Wizard" } } })) === 0);

  console.log(fail ? `\n${fail} FAILURES` : "\nall assertions passed");
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
