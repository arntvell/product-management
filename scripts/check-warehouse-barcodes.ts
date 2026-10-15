// End-to-end check of the Loom warehouse-barcode receiver, against the real
// database.
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-warehouse-barcodes.ts
//
// Walks the testing checklist in §5 of docs/origio-warehouse-barcodes-handover-1.md,
// which is the list Loom asked us to pass, plus the refusals that list does not
// mention but the contract demands:
//
//   1. the signature verifies against the raw body, and a tampered body does not
//   2. a repeated X-Loom-Event-Id changes nothing and still succeeds
//   3. a lower revision arriving after a higher one for a batch is ignored
//   4. a previous_barcode row REPLACES the barcode instead of adding a second
//   5. a barcode Origio cannot file leaves the rest of the delivery filed
//   6. the filed barcodes are offered to the channels, and sending them does
//      not take the warehouse's name off the FieldOwner row
//
// Checklist item 5 on Loom's list — "each filed barcode reaches Shopify and
// Sitoo" — is deliberately not here. The receiver does not push; it names the
// colorways and a person pushes. That this script asserts `affectedColorwayIds`
// instead is the point, not a gap.
//
// Creates a throwaway brand, style, colorway and variants, and deletes
// everything it made at the end, including on failure.

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { checkDigit } from "../src/lib/master/barcode.ts";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.ORIGO_POSTGRES_PRISMA_URL }),
});

const TAG = "ZZWB" + Date.now().toString(36).toUpperCase().slice(-5);
const SECRET = "loom_whsec_test_" + TAG;

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
};

/**
 * A valid EAN-13 outside Livid's own ranges (7072536 / 7000000), because a
 * supplier's barcode is what this whole path carries. `seq` keeps the codes in
 * one run distinct; the TAG keeps them clear of production data.
 */
function supplierBarcode(seq: number): string {
  const first12 = ("501" + Date.now().toString().slice(-6) + String(seq).padStart(3, "0")).slice(0, 12);
  return first12 + checkDigit(first12);
}

const ids = { brandId: "", styleId: "", colorwayId: "", variantIds: [] as string[] };

async function main() {
  process.env.LOOM_WEBHOOK_SECRET = SECRET;
  // Imported after the env is set — the lib reads LOOM_WEBHOOK_SECRET, and the
  // route's singleton prisma comes from src/lib/db.ts.
  const { verifyLoomSignature, processBarcodesReady, parseBarcodesReady, WAREHOUSE_AUTHORITY } =
    await import("../src/lib/loom/warehouse-barcodes.ts");
  const { createHmac } = await import("node:crypto");
  const sign = (raw: string) => "sha256=" + createHmac("sha256", SECRET).update(raw, "utf8").digest("hex");

  // --- 1. signature ---------------------------------------------------------
  const body = JSON.stringify({ hello: "loom" });
  check("signature verifies against the raw body", verifyLoomSignature(body, sign(body)));
  check("a tampered body is refused", !verifyLoomSignature(body + " ", sign(body)));
  check("a missing signature is refused", !verifyLoomSignature(body, null));
  // The raw bytes, not a reparse: same document, different byte string.
  const reserialised = JSON.stringify(JSON.parse(body) as object) + "\n";
  check("a re-serialised body is refused", !verifyLoomSignature(reserialised, sign(body)));

  // --- fixtures -------------------------------------------------------------
  const brand = await prisma.brand.create({ data: { name: `ZZ Supplier ${TAG}`, isLivid: false, skuToken: TAG } });
  ids.brandId = brand.id;
  const style = await prisma.style.create({
    data: { source: "MANUAL", styleSku: `EXT-${TAG}`, styleName: `ZZ Test Style ${TAG}`, brandId: brand.id },
  });
  ids.styleId = style.id;
  const colorway = await prisma.colorway.create({
    data: {
      source: "MANUAL",
      colorwaySku: `EXT-${TAG}-BLK`,
      name: `ZZ Test Colorway ${TAG}`,
      styleId: style.id,
      brandId: brand.id,
    },
  });
  ids.colorwayId = colorway.id;

  // Four sizes: one filled by id, one by Loom's alias spelling, one that already
  // holds a barcode a person decided, and one for the EAN-8.
  const sizes = ["S", "M", "L", "XL"] as const;
  const variants = [];
  for (const [i, size] of sizes.entries()) {
    variants.push(
      await prisma.variant.create({
        data: {
          colorwayId: colorway.id,
          variantSku: `EXT-${TAG}-BLK-${size}`,
          sizeLabel: size,
          dim1: size,
          ...(i === 2 ? { barcode: supplierBarcode(90) } : {}),
        },
      })
    );
  }
  ids.variantIds = variants.map((v) => v.id);
  const [vS, vM, vL, vXL] = variants;

  // Loom spells the middle size differently. externalSku is the alias column
  // that exists for exactly this.
  await prisma.variantChannelRef.create({
    data: {
      variantId: vM.id,
      channel: "LOOM",
      externalId: `loom-${TAG}-M`,
      externalSku: `LOOM-ALIAS-${TAG}-M`,
    },
  });

  const batchId = `batch_${TAG}`;
  const codeS = supplierBarcode(1);
  const codeM = supplierBarcode(2);
  const codeL = supplierBarcode(3);

  const event = (n: number, revision: number, barcodes: unknown[], isCorrection = false) =>
    parseBarcodesReady({
      event: "barcodes.ready",
      event_id: `loom_evt_${TAG}_${n}`,
      created_at: new Date().toISOString(),
      data: {
        batch_id: batchId,
        inbound_ref: "142",
        po_number: `PO-${TAG}`,
        supplier: brand.name,
        revision,
        is_correction: isCorrection,
        barcodes,
      },
    });

  // --- 2. the first delivery ------------------------------------------------
  const first = await processBarcodesReady(
    event(1, 3, [
      // matched on origio_variant_id — the only key that cannot be wrong
      { sku: `WHATEVER-LOOM-CALLS-IT-${TAG}`, origio_variant_id: vS.id, barcode: codeS, previous_barcode: null },
      // matched on the LOOM alias, with no variant id (a size created before
      // Origio sent stable ids)
      { sku: `LOOM-ALIAS-${TAG}-M`, origio_variant_id: null, barcode: codeM, previous_barcode: null },
      // Origio already holds a barcode here, decided by someone else: §4 says
      // the master wins
      { sku: vL.variantSku, origio_variant_id: vL.id, barcode: codeL, previous_barcode: null },
      // a size Origio has never heard of
      { sku: `EXT-${TAG}-GHOST-2XL`, origio_variant_id: null, barcode: supplierBarcode(4) },
      // an EAN-8 — a supplier length the master accepts since 2026-10-15
      { sku: vXL.variantSku, origio_variant_id: vXL.id, barcode: "96385074" },
      // and a code that is not a GTIN at any length, which is still refused
      { sku: vS.variantSku, origio_variant_id: vS.id, barcode: "123456789" },
    ])
  );

  check("the first delivery is processed", first.status === "processed", first.status);
  check("three barcodes were filled", first.counts.filled === 3, JSON.stringify(first.counts));
  check(
    "matched on origio_variant_id",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } })).barcode === codeS
  );
  check(
    "matched on the LOOM alias spelling",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vM.id } })).barcode === codeM
  );
  check(
    "a barcode Origio already holds is not overwritten",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vL.id } })).barcode !== codeL
  );
  check(
    "the unfilable rows are reported, not thrown",
    first.unfiled.length === 3,
    first.unfiled.map((u) => u.reason).join(" | ")
  );
  check(
    "an EAN-8 is filed, all eight digits of it",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vXL.id } })).barcode === "96385074"
  );
  check(
    "a code that is not a GTIN is refused with its reason",
    first.unfiled.some((u) => u.barcode === "123456789" && /is 9 digits/.test(u.reason)),
    first.unfiled.find((u) => u.barcode === "123456789")?.reason ?? "not reported"
  );
  check(
    "an unknown SKU is refused with its reason",
    first.unfiled.some((u) => /no variant in Origio/.test(u.reason))
  );
  check(
    "the colorway is named for the push that follows",
    first.affectedColorwayIds.length === 1 && first.affectedColorwayIds[0] === colorway.id
  );
  const owner = await prisma.fieldOwner.findFirst({
    where: { entityType: "variant", entityId: vS.id, field: "barcode" },
  });
  check("the warehouse is recorded as the authority", owner?.authority === WAREHOUSE_AUTHORITY, owner?.authority ?? "none");
  check("the evidence names the inbound and the event", !!owner?.evidence?.includes("loom_evt_"), owner?.evidence ?? "");

  // --- 3. a retry of the same event ----------------------------------------
  const before = await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } });
  const repeat = await processBarcodesReady(
    event(1, 3, [{ sku: vS.variantSku, origio_variant_id: vS.id, barcode: supplierBarcode(5) }])
  );
  const after = await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } });
  check("a repeated event id is a duplicate, not an error", repeat.status === "duplicate", repeat.status);
  check("a repeated event id changes nothing", after.barcode === before.barcode);
  check("a repeated event id writes no second row", (await prisma.loomInboundEvent.count({ where: { eventId: `loom_evt_${TAG}_1` } })) === 1);

  // --- 4. a correction, and a stale revision --------------------------------
  const corrected = supplierBarcode(6);
  const correction = await processBarcodesReady(
    event(2, 7, [{ sku: vS.variantSku, origio_variant_id: vS.id, barcode: corrected, previous_barcode: codeS }], true)
  );
  check("a correction is processed", correction.status === "processed", correction.status);
  check("a correction CHANGES the barcode", correction.counts.changed === 1, JSON.stringify(correction.counts));
  const afterCorrection = await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } });
  check("the corrected barcode replaced the old one", afterCorrection.barcode === corrected, afterCorrection.barcode ?? "null");
  check(
    "the variant holds exactly one barcode",
    (await prisma.variant.count({ where: { colorwayId: colorway.id, barcode: codeS } })) === 0
  );

  // A LOWER revision arriving late, which Loom warns can happen after a retry.
  const stale = await processBarcodesReady(
    event(3, 4, [{ sku: vS.variantSku, origio_variant_id: vS.id, barcode: codeS, previous_barcode: corrected }])
  );
  check("a lower revision is superseded, not applied", stale.status === "superseded", stale.status);
  check(
    "a lower revision does not undo the correction",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } })).barcode === corrected
  );

  // A correction whose previous_barcode does NOT match what Origio holds is a
  // disagreement, not a correction: the master wins.
  const mismatch = await processBarcodesReady(
    event(4, 9, [{ sku: vS.variantSku, origio_variant_id: vS.id, barcode: supplierBarcode(7), previous_barcode: supplierBarcode(8) }])
  );
  check(
    "a correction with a mismatched previous_barcode is refused",
    mismatch.counts.unfiled === 1 && /Origio holds/.test(mismatch.unfiled[0]?.reason ?? ""),
    mismatch.unfiled[0]?.reason ?? ""
  );
  check(
    "and leaves the master as it was",
    (await prisma.variant.findUniqueOrThrow({ where: { id: vS.id } })).barcode === corrected
  );

  // --- 5. carrying the filed barcodes out to the channels ------------------
  //
  // Its own batch. A real correction re-sends the WHOLE batch at a higher
  // revision, which is why pendingChannelScope only looks at the newest
  // revision per batch — but the single-row corrections above are a fixture
  // shortcut, so reusing their batch would leave the scope empty for a reason
  // that says nothing about the sync.
  const { pendingChannelScope, syncWarehouseBarcodes, recordChannelSend, summariseSend } =
    await import("../src/lib/loom/warehouse-barcode-sync.ts");

  const held = await prisma.variant.findMany({
    where: { id: { in: [vS.id, vM.id, vXL.id] } },
    select: { id: true, variantSku: true, barcode: true },
  });
  const syncEventId = `loom_evt_${TAG}_SYNC`;
  await processBarcodesReady(
    parseBarcodesReady({
      event: "barcodes.ready",
      event_id: syncEventId,
      created_at: new Date().toISOString(),
      data: {
        batch_id: `batch_${TAG}_SYNC`,
        inbound_ref: "143",
        po_number: `PO-${TAG}-SYNC`,
        revision: 1,
        is_correction: false,
        barcodes: held.map((v) => ({
          sku: v.variantSku,
          origio_variant_id: v.id,
          barcode: v.barcode!,
          previous_barcode: null,
        })),
      },
    })
  );

  const scope = await pendingChannelScope(syncEventId);
  check("the pending scope finds the filed sizes", scope.rows.length === 3, `${scope.rows.length} rows`);
  check("...grouped to one colourway, which is Loom's unit", scope.colorwayIds.length === 1);
  check(
    "...carrying the master's spelling, not Loom's",
    scope.rows.every((r) => held.some((h) => h.variantSku === r.variantSku && h.barcode === r.barcode))
  );
  check(
    "a size whose master barcode disagrees is NOT pending",
    !scope.rows.some((r) => r.variantSku === vL.variantSku)
  );

  // The authority is the regression this guards. applyVariantBarcodeEdits runs
  // under the editor's authority, and it is only safe because every row plans as
  // `unchanged` and apply-barcodes records a decision for written rows only. If
  // that ever changes, the warehouse silently becomes "manual:variant-editor".
  const sync = await syncWarehouseBarcodes({ eventId: syncEventId, dryRun: true });
  check("the preview plans every size", sync.report.rows.length === 3, `${sync.report.rows.length} rows`);
  check(
    "the master is left alone — every row is unchanged",
    sync.report.rows.every((r) => r.master === "unchanged"),
    sync.report.rows.map((r) => r.master).join(",")
  );
  check(
    "an unlinked size reports not-live rather than failing",
    sync.report.rows.every((r) => r.shopify.state === "not-live" && r.sitoo.state === "not-live")
  );

  const applied = await syncWarehouseBarcodes({ eventId: syncEventId, dryRun: false });
  const ownerAfter = await prisma.fieldOwner.findFirst({
    where: { entityType: "variant", entityId: vS.id, field: "barcode" },
  });
  check(
    "the warehouse is STILL the authority after a send",
    ownerAfter?.authority === WAREHOUSE_AUTHORITY,
    ownerAfter?.authority ?? "none"
  );
  check("the send wrote nothing to the master", applied.report.master.applied === 0);

  // Only a clean run marks the event sent; anything failed leaves it pending so
  // the rows come back next time.
  const okSummary = summariseSend(applied.report);
  const marked = await recordChannelSend([syncEventId], okSummary);
  const syncedEvent = await prisma.loomInboundEvent.findUniqueOrThrow({ where: { eventId: syncEventId } });
  check("a clean send marks the event", marked.marked === 1 && !!syncedEvent.channelsPushedAt);
  check("...and is then no longer pending", (await pendingChannelScope(syncEventId)).rows.length === 0);

  await prisma.loomInboundEvent.update({
    where: { eventId: syncEventId },
    data: { channelsPushedAt: null },
  });
  const failedSummary = { ...okSummary, sitoo: { ...okSummary.sitoo, failed: 1 } };
  const notMarked = await recordChannelSend([syncEventId], failedSummary);
  const afterFail = await prisma.loomInboundEvent.findUniqueOrThrow({ where: { eventId: syncEventId } });
  check(
    "a failed channel leaves the event pending, with its report",
    notMarked.pending && !afterFail.channelsPushedAt && !!afterFail.channelReport
  );
  check(
    "...so the rows are offered again",
    (await pendingChannelScope(syncEventId)).rows.length === 3
  );

  console.log(fail ? `\n${fail} FAILURES` : "\nall assertions passed");
}

/**
 * Delete everything the run made.
 *
 * Step by step, each one shielded: a step that throws must not strand the ones
 * after it. The first version was a straight sequence, and when the very first
 * delete hit a table the migration had not created yet it left a brand, a style
 * and three variants behind in the database for a human to find.
 *
 * Order still matters — children before parents — but a failure now costs one
 * row, not all of them, and the script says which.
 */
async function cleanup() {
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`  cleanup: ${what} failed —`, e instanceof Error ? e.message : e);
      fail++;
    }
  };

  await step("events", () =>
    prisma.loomInboundEvent.deleteMany({
      where: { batchId: { in: [`batch_${TAG}`, `batch_${TAG}_SYNC`] } },
    })
  );
  if (ids.variantIds.length) {
    await step("variant field owners", () =>
      prisma.fieldOwner.deleteMany({ where: { entityType: "variant", entityId: { in: ids.variantIds } } })
    );
    await step("channel refs", () =>
      prisma.variantChannelRef.deleteMany({ where: { variantId: { in: ids.variantIds } } })
    );
  }
  if (ids.colorwayId) {
    await step("variants", () => prisma.variant.deleteMany({ where: { colorwayId: ids.colorwayId } }));
    await step("colorway field owners", () =>
      prisma.fieldOwner.deleteMany({ where: { entityType: "colorway", entityId: ids.colorwayId } })
    );
    await step("colorway", () => prisma.colorway.deleteMany({ where: { id: ids.colorwayId } }));
  }
  if (ids.styleId) await step("style", () => prisma.style.deleteMany({ where: { id: ids.styleId } }));
  if (ids.brandId) await step("brand", () => prisma.brand.deleteMany({ where: { id: ids.brandId } }));
  // The ledger never takes a supplier code (apply-barcodes only records what
  // parses as one of Livid's ranges), so there is nothing to clean there.
}

main()
  .catch((e) => {
    console.error(e);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed", e));
    await prisma.$disconnect();
    process.exit(fail ? 1 : 0);
  });
