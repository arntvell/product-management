// Resolve a stored image reference to a browser-loadable src.
// Threadflow images are relative, API-key-authed refs served via our proxy;
// Shopify (and other) images are absolute public URLs used directly.
export function catalogImageSrc(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (/^https?:\/\//i.test(ref)) return ref;
  return `/api/catalog/tf-image?ref=${encodeURIComponent(ref)}`;
}
