// Bulk writes that do not blow the transaction budget.
//
// Prisma's $transaction([...]) sends one round trip per element. At a couple of
// hundred rows that exceeds the 5 s interactive-transaction limit, and the
// failure mode is nasty: earlier statements in the batch have already committed,
// so the caller is left half-applied.
//
// This has now bitten four times in one day — the kind classifier lost 206
// attributions, the Shopify linker lost 2,084 product mappings, the barcode
// applier failed outright at 175 rows, and loom/push.ts carries a comment
// warning about it that the other three did not read. One statement per chunk
// instead of one per row.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Set one column on many rows, matched by id.
 *
 * `UPDATE … FROM (VALUES …)` — a single statement per chunk, so 500 rows cost
 * one round trip rather than 500.
 */
export async function bulkUpdateById<T extends string | null>(
  table: string,
  column: string,
  rows: Array<{ id: string; value: T }>,
  chunk = 500
): Promise<number> {
  if (!rows.length) return 0;
  let touched = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((r) => Prisma.sql`(${r.id}, ${r.value})`);
    touched += await prisma.$executeRaw`
      UPDATE ${Prisma.raw(`"${table}"`)} t
      SET ${Prisma.raw(`"${column}"`)} = v.val
      FROM (VALUES ${Prisma.join(values)}) AS v(id, val)
      WHERE t."id" = v.id
    `;
  }
  return touched;
}

/** The same, matched on a unique text column other than id. */
export async function bulkUpdateByKey<T extends string | null>(
  table: string,
  keyColumn: string,
  column: string,
  rows: Array<{ key: string; value: T }>,
  chunk = 500
): Promise<number> {
  if (!rows.length) return 0;
  let touched = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((r) => Prisma.sql`(${r.key}, ${r.value})`);
    touched += await prisma.$executeRaw`
      UPDATE ${Prisma.raw(`"${table}"`)} t
      SET ${Prisma.raw(`"${column}"`)} = v.val
      FROM (VALUES ${Prisma.join(values)}) AS v(k, val)
      WHERE t.${Prisma.raw(`"${keyColumn}"`)} = v.k
    `;
  }
  return touched;
}
