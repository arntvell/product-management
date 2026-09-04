import { NextResponse } from "next/server";
import { pushColorwayToShopify } from "@/lib/master/push-shopify";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/catalog/colorways/[id]/push — LIVE write: create/update the Shopify
// product from this colorway.
//
// clearEmptied defaults to false: a field left blank in the master is left alone
// on Shopify rather than deleted. See pushColorwayToShopify.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let seasonCode: string | undefined;
  let allowIncomplete = false;
  let clearEmptied = false;
  try {
    const body = (await req.json()) as {
      seasonCode?: string;
      allowIncomplete?: boolean;
      clearEmptied?: boolean;
    };
    seasonCode = body?.seasonCode;
    allowIncomplete = !!body?.allowIncomplete;
    clearEmptied = !!body?.clearEmptied;
  } catch {
    /* no body is fine — push without a season scope */
  }
  try {
    const result = await pushColorwayToShopify(id, seasonCode, allowIncomplete, clearEmptied);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Push failed" },
      { status: 502 }
    );
  }
}
