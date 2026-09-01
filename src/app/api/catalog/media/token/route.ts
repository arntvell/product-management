import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Mints a short-lived client upload token so the browser can upload large
// images directly to Blob without the server handling the bytes (and without
// exposing BLOB_READ_WRITE_TOKEN). The MediaAsset row is created separately by
// the client once the upload resolves (onUploadCompleted doesn't fire on
// localhost).
export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => ({
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
        maximumSizeInBytes: 25 * 1024 * 1024,
        tokenPayload: clientPayload ?? undefined,
      }),
      onUploadCompleted: async () => {
        /* no-op: the client records the MediaAsset after upload */
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload token failed" },
      { status: 400 }
    );
  }
}
