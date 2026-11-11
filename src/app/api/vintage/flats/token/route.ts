import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { openFlatRequest } from "@/lib/master/flats";

export const dynamic = "force-dynamic";

// POST /api/vintage/flats/token — a Blob upload token for one flat.
//
// The Vintage role writes Livid products here, which the rest of the vintage
// routes refuse it (assertVintageOnly). What makes this one safe is scope, not
// trust: a token is only minted for an OPEN flat request, so the photographer
// can put a flat on a product an Admin or Product manager queued, and nothing
// else. The upload route checks the same thing again.
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        let requestId: string | undefined;
        try {
          requestId = JSON.parse(clientPayload ?? "{}").requestId;
        } catch {
          /* falls through to the refusal */
        }
        if (!requestId || !(await openFlatRequest(requestId)))
          throw new Error("This product is not on the flats list.");
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
          maximumSizeInBytes: 25 * 1024 * 1024,
          tokenPayload: clientPayload ?? undefined,
        };
      },
      onUploadCompleted: async () => {
        /* no-op: the client records the flat after upload (this does not fire on localhost) */
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload token failed" }, { status: 400 });
  }
}
