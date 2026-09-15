import { NextResponse } from "next/server";
import { getIdentityGapCounts, listIdentityGaps } from "@/lib/master/identity-report";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const filter = {
    brandId: url.searchParams.get("brandId") ?? undefined,
    includeArchived: url.searchParams.get("includeArchived") === "1",
  };
  const [counts, page] = await Promise.all([
    getIdentityGapCounts(filter),
    listIdentityGaps(filter, {
      skip: Number(url.searchParams.get("skip") ?? 0),
      take: Number(url.searchParams.get("take") ?? 100),
    }),
  ]);
  return NextResponse.json({ counts, ...page });
}
