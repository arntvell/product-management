import { NextResponse } from "next/server";
import { previewCarryPrices, runCarryPrices } from "@/lib/master/carry-prices";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/catalog/prices/carry-forward
//   { seasonCode, dryRun?, includeCore?, vendors?: string[] }
// Copy prices into a season for products carried forward into it, from the
// newest season where they are actually priced. Never overwrites.
export async function POST(req: Request) {
  let body: {
    seasonCode?: string;
    dryRun?: boolean;
    includeCore?: boolean;
    vendors?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.seasonCode) {
    return NextResponse.json({ error: "seasonCode is required" }, { status: 400 });
  }
  const opts = {
    seasonCode: body.seasonCode,
    includeCore: body.includeCore,
    vendors: body.vendors,
  };
  try {
    if (body.dryRun) {
      return NextResponse.json({ dryRun: true, ...(await previewCarryPrices(opts)) });
    }
    return NextResponse.json({ dryRun: false, ...(await runCarryPrices(opts)) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Carry-forward failed" },
      { status: 500 }
    );
  }
}
