import { fetchImage } from "@/lib/threadflow/client";

export const dynamic = "force-dynamic";

// GET /api/catalog/tf-image?ref=/api/external/v1/images/...
// Proxies an API-key-authed Threadflow image so the browser can render it
// without exposing the key. Only allows Threadflow image refs.
export async function GET(req: Request) {
  const ref = new URL(req.url).searchParams.get("ref");
  if (!ref || !ref.includes("/images/") || ref.includes("..")) {
    return new Response("Invalid image ref", { status: 400 });
  }

  const image = await fetchImage(ref);
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(image.body, {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
