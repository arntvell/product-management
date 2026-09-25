// Finding a vintage garment's photographs.
//
// The shoot uploads to an sFTP share hosted at one.com (the team works it
// through Cyberduck) and the same directory is served publicly, which is where
// the product images are pulled from on push.
//
// Naming, verified against the store's own CDN filenames: `<n>.jpg` is the
// base photo, `<n>-2.jpg` and `<n>-3.jpg` are the others. HOW MANY THERE ARE
// IS RECORDED NOWHERE. It varies per garment — 13761 has two, 13762 has three
// — so the count must come from the directory and never from a formula. The
// old sheet assumed one, which is why most items imported with a single photo.
//
// Listing beats probing for two reasons. The public host rate-limits: a burst
// of ~25 HEAD requests returned 429. And only a listing can answer the
// question that matters most — "is there a photo here with no row in the
// drop?" — because probing can only confirm photos for rows you already have.
// A photo with no row means a garment the shoot captured and nobody entered.
//
// THE SHARE ROTATES. It is a working area for the drop being prepared, not an
// archive: on 2026-09-25 it held items 13643-13722, while 13760-13762 — pushed
// live a week earlier — were already gone. So a photo URL here has a limited
// life, and the order of operations matters: push to Shopify BEFORE the share
// is cleared. Once pushed it is safe, because `fileCreate` copies the bytes to
// Shopify's own CDN rather than hotlinking, and the cached file GID on
// `MediaAsset.shopifyMediaId` is what later pushes reuse. A MediaAsset whose
// URL has rotated away but which has a `shopifyMediaId` is still fine; one
// without has lost its image.
import SftpClient from "ssh2-sftp-client";

/** `13762-2.jpg` -> { itemNumber: "13762", index: 2 }. Base photo is index 0. */
const FILENAME = /^(\d+)(?:-(\d+))?\.(jpe?g|png|webp)$/i;

export interface VintagePhoto {
  itemNumber: string;
  /** 0 for the base photo, then 2, 3 … as the filename says. */
  index: number;
  filename: string;
  /** The public URL the Shopify push will upload from. */
  url: string;
}

export interface SftpConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  /** Directory holding the photos, absolute on the server. */
  remotePath: string;
  /** Public base the same directory is served at. */
  publicBase: string;
}

export class VintagePhotoError extends Error {}

/**
 * `sftp://ssh.lividjeans.com/some/path` -> `ssh.lividjeans.com`.
 *
 * Accepts what a person would copy out of Cyberduck: a scheme, a trailing
 * slash, a path, a `user@` prefix, or a bare hostname already.
 */
function bareHost(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  return (
    v
      .replace(/^[a-z0-9+.-]+:\/\//i, "") // scheme
      .replace(/^[^/@]*@/, "") // user@
      .split("/")[0] // path
      .split(":")[0] // :port — VINTAGE_SFTP_PORT owns that
      .trim() || undefined
  );
}

/**
 * Config from the environment. Nothing is defaulted except the port and the
 * one.com path recorded in `docs/vintage-workflow.md`, because a wrong guess
 * at a credential fails confusingly and a wrong guess at a host can reach
 * something else entirely.
 */
export function sftpConfigFromEnv(): SftpConfig {
  // Cyberduck shows the server as `sftp://ssh.lividjeans.com/...`, so that is
  // what gets pasted into the variable. ssh2 wants a bare hostname and fails
  // with ENOTFOUND on anything else. Same treatment `shopify/client.ts` gives
  // SHOPIFY_STORE_URL.
  const host = bareHost(process.env.VINTAGE_SFTP_HOST);
  const username = process.env.VINTAGE_SFTP_USER;
  const password = process.env.VINTAGE_SFTP_PASSWORD;
  const privateKey = process.env.VINTAGE_SFTP_PRIVATE_KEY;

  const missing = [
    !host && "VINTAGE_SFTP_HOST",
    !username && "VINTAGE_SFTP_USER",
    !password && !privateKey && "VINTAGE_SFTP_PASSWORD or VINTAGE_SFTP_PRIVATE_KEY",
  ].filter(Boolean);
  if (missing.length)
    throw new VintagePhotoError(
      `sFTP is not configured — set ${missing.join(", ")}. ` +
        `Host and user are what Cyberduck connects with.`
    );

  return {
    host: host!,
    port: Number(process.env.VINTAGE_SFTP_PORT ?? 22),
    username: username!,
    password,
    privateKey,
    remotePath:
      process.env.VINTAGE_SFTP_PATH ??
      "/customers/7/4/b/c2pr36q0g/users/c2pr36q0g_ssh/webroots/by-route/vintage.lividjeans.com_",
    publicBase: (process.env.VINTAGE_PHOTO_BASE_URL ?? "https://vintage.lividjeans.com").replace(
      /\/+$/,
      ""
    ),
  };
}

function toPhoto(filename: string, publicBase: string): VintagePhoto | null {
  const m = FILENAME.exec(filename);
  if (!m) return null;
  return {
    itemNumber: m[1],
    index: m[2] ? Number(m[2]) : 0,
    filename,
    url: `${publicBase}/${filename}`,
  };
}

/**
 * Every photo in the share, grouped by item number and ordered base-first.
 *
 * One connection for the whole drop. The ordering is done here rather than
 * left to the directory because `MediaAsset.position` is assigned in insertion
 * order and position 0 is the storefront's featured image — product
 * `13762-vintage` is live with its photos in the order 1, 3, 2 precisely
 * because the old import trusted the listing order.
 */
export async function listVintagePhotos(
  config: SftpConfig = sftpConfigFromEnv()
): Promise<Map<string, VintagePhoto[]>> {
  const sftp = new SftpClient();
  try {
    await sftp.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      ...(config.password ? { password: config.password } : {}),
      ...(config.privateKey ? { privateKey: config.privateKey } : {}),
    });
    const entries = await sftp.list(config.remotePath);

    const byItem = new Map<string, VintagePhoto[]>();
    for (const e of entries) {
      if (e.type !== "-") continue; // files only
      const photo = toPhoto(e.name, config.publicBase);
      if (!photo) continue;
      const list = byItem.get(photo.itemNumber) ?? [];
      list.push(photo);
      byItem.set(photo.itemNumber, list);
    }
    for (const list of byItem.values()) list.sort((a, b) => a.index - b.index);
    return byItem;
  } catch (err) {
    throw new VintagePhotoError(
      `Could not list the vintage photo share at ${config.host}:${config.remotePath} — ` +
        `${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    await sftp.end().catch(() => {
      /* already closed */
    });
  }
}

export interface PhotoMatch {
  /** Item numbers in the drop, with their ordered photo URLs. */
  photos: Map<string, string[]>;
  /** Entered but unphotographed — fatal, a product page with no image. */
  rowsWithoutPhotos: string[];
  /** Photographed but not entered — a garment nobody wrote up. */
  photosWithoutRows: string[];
  /** Photographed, but the base `<n>.jpg` is absent. */
  missingBasePhoto: string[];
}

/**
 * Match a drop's item numbers against the share.
 *
 * `photosWithoutRows` is the capability the spreadsheet never had. It is
 * reported rather than thrown: a photo with no row is usually a garment still
 * being written up, which is a prompt, not an error. The other two are
 * failures the validator treats as fatal.
 */
export function matchPhotosToItems(
  itemNumbers: string[],
  byItem: Map<string, VintagePhoto[]>
): PhotoMatch {
  const wanted = new Set(itemNumbers.map((n) => n.trim()));
  const photos = new Map<string, string[]>();
  const rowsWithoutPhotos: string[] = [];
  const missingBasePhoto: string[] = [];

  for (const n of wanted) {
    const list = byItem.get(n) ?? [];
    if (!list.length) {
      rowsWithoutPhotos.push(n);
      continue;
    }
    if (list[0].index !== 0) missingBasePhoto.push(n);
    photos.set(n, list.map((p) => p.url));
  }

  const photosWithoutRows = [...byItem.keys()].filter((n) => !wanted.has(n)).sort();
  return { photos, rowsWithoutPhotos, photosWithoutRows, missingBasePhoto };
}

/**
 * HTTPS fallback, for when sFTP is unavailable.
 *
 * Strictly worse and deliberately limited: it probes the base plus `-2`…`-5`
 * per item, cannot see a photo with no row, and the host 429s under load — so
 * it goes one item at a time with a pause between. Use the listing.
 */
export async function probeVintagePhotos(
  itemNumbers: string[],
  publicBase = (process.env.VINTAGE_PHOTO_BASE_URL ?? "https://vintage.lividjeans.com").replace(/\/+$/, ""),
  opts: { maxExtra?: number; pauseMs?: number } = {}
): Promise<Map<string, string[]>> {
  const maxExtra = opts.maxExtra ?? 5;
  const pauseMs = opts.pauseMs ?? 250;
  const out = new Map<string, string[]>();

  for (const raw of itemNumbers) {
    const n = raw.trim();
    const urls: string[] = [];
    for (const suffix of ["", ...Array.from({ length: maxExtra - 1 }, (_, i) => `-${i + 2}`)]) {
      const url = `${publicBase}/${n}${suffix}.jpg`;
      const res = await fetch(url, { method: "HEAD" });
      if (res.status === 429)
        throw new VintagePhotoError(
          `The photo host rate-limited the probe at ${url}. Use the sFTP listing instead.`
        );
      if (res.ok && (res.headers.get("content-type") ?? "").startsWith("image/")) urls.push(url);
      else if (suffix !== "") break; // numbering is contiguous; stop at the first gap
      await new Promise((r) => setTimeout(r, pauseMs));
    }
    if (urls.length) out.set(n, urls);
  }
  return out;
}
