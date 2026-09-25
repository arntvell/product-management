// Proves the Sitoo create path against the SANDBOX (account 91624).
//
//   npx dotenv -e .env.local -- npx tsx scripts/check-sitoo-create.ts
//
// This is the claim that most needed testing: docs/sitoo-barnes-recreate.md says
// a create path "does not exist" because variantparentid is rejected. It IS
// rejected — it is readOnly — but POST /products creates, and
// PUT /products/{parent}/productvariants sets the family. This script creates a
// 3-size family, reads it back, and checks that variantparentid is set on all
// three by the second call.
//
// Sandbox only. It refuses to touch production, and it reports the account's
// product count before and after.

import {
  deleteProduct,
  listProducts,
  createProducts,
  findProductsBySku,
  getProductVariants,
  setProductVariants,
  productCount,
} from "../src/lib/sitoo/client.ts";

const TARGET = "sandbox" as const;
const TAG = "ZZAPI" + Date.now().toString(36).toUpperCase().slice(-5);
const SIZES = ["41", "42", "43"];
const SKUS = SIZES.map((s) => `EXT-${TAG}-TST-${s}`);

let fail = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${detail ? "  — " + detail : ""}`);
};

async function main() {
  // Clear anything a previous failed run stranded, so the count means something.
  const strays = (await listProducts(TARGET)).filter((p) => p.sku?.startsWith("EXT-ZZAPI"));
  for (const p of strays) await deleteProduct(p.productid, TARGET);
  if (strays.length) console.log(`cleared ${strays.length} stray test products first`);

  const before = await productCount(TARGET);
  console.log(`sandbox product count before: ${before}\n`);

  // 1. Nothing exists yet.
  const pre = await findProductsBySku(SKUS, TARGET);
  check("SKUs are free before we start", pre.length === 0, `found ${pre.length}`);

  // 2. POST /products creates.
  const created = await createProducts(
    SKUS.map((sku, i) => ({
      sku,
      title: `ZZ API Test ${SIZES[i]}`,
      moneyprice: "1000.00",
      moneypricein: "400.00",
      vatid: 2,
      activepos: false,
      stockcountenable: true,
    })),
    TARGET
  );
  check(
    "POST /products created 3 products",
    created.length === 3 && created.every((r) => r.statuscode === 200 && r.return),
    JSON.stringify(created)
  );

  const found = await findProductsBySku(SKUS, TARGET);
  check("all 3 readable by SKU", found.length === 3, `found ${found.length}`);
  check(
    "none is a variant yet (variantparentid null)",
    found.every((f) => !f.variantparentid),
    JSON.stringify(found.map((f) => f.variantparentid))
  );

  // 3. PUT productvariants sets the family.
  const byS = new Map(found.map((f) => [f.sku, f]));
  const parentId = byS.get(SKUS[0])!.productid;
  const rows = SKUS.map((sku, i) => ({
    productid: byS.get(sku)!.productid,
    sku,
    active: true,
    deliverystatus: "1",
    activepos: false,
    title: `ZZ API Test ${SIZES[i]}`,
    attributes: [SIZES[i]],
    moneyprice: "1000.00",
    moneypriceorg: "1000.00",
    moneyofferprice: "0.00",
    moneypricein: "400.00",
    barcode: "",
    friendly: sku.toLowerCase(),
  }));
  const ok = await setProductVariants(
    parentId,
    { groups: [{ name: "Size", options: SIZES }], variants: rows },
    TARGET
  );
  check("PUT productvariants accepted", ok);

  // 4. Read it back — this is the assertion the doc said was impossible.
  const after = await findProductsBySku(SKUS, TARGET);
  const parents = after.map((a) => a.variantparentid);
  check(
    "all 3 now carry a variantparentid",
    after.length === 3 && after.every((a) => a.variantparentid),
    JSON.stringify(parents)
  );
  check(
    "they share one parent, which is the main variant itself",
    new Set(parents).size === 1 && parents[0] === parentId,
    `parents=${JSON.stringify(parents)} expected=${parentId}`
  );

  const family = await getProductVariants(parentId, TARGET);
  check(
    "the size group exists with all 3 options",
    !!family && family.groups?.[0]?.options?.length === 3,
    JSON.stringify(family?.groups)
  );

  // 5. The account did not lose anything.
  const afterCount = await productCount(TARGET);
  console.log(`\nsandbox product count after: ${afterCount}`);
  check(
    "account grew by exactly 3, nothing vanished",
    before !== null && afterCount !== null && afterCount === before + 3,
    `${before} -> ${afterCount}`
  );

  console.log(
    fail
      ? `\n${fail} FAILURES`
      : "\nall assertions passed — Sitoo CAN create a variant family via the API"
  );
  // Clean up after ourselves — the sandbox is shared and a pile of ZZ rows makes
  // the next person's product count meaningless.
  if (process.argv.includes("--keep")) {
    console.log(`\nLeft in the SANDBOX for inspection: ${SKUS.join(", ")} (parent ${parentId}).`);
  } else {
    // Delete the PARENT first. A child of a variant family cannot be removed on
    // its own — DELETE on one returns `Invalid productid`, because the family
    // owns it. Removing the main variant dissolves the family.
    const parentFirst = [...after].sort((a, b) =>
      a.productid === parentId ? -1 : b.productid === parentId ? 1 : 0
    );
    for (const p of parentFirst) {
      try {
        await deleteProduct(p.productid, TARGET);
      } catch {
        // Expected for the children: removing the parent already dissolved the
        // family and took them with it. The count assertion below is the proof.
      }
    }
    const finalCount = await productCount(TARGET);
    check("cleaned up, count back to where it started", finalCount === before, `${finalCount} vs ${before}`);
  }

  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(String(e).slice(0, 800));
  process.exit(1);
});
