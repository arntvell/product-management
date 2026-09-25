// Does the vintage photo share answer, and what is in it?
//
// Read-only. Run this first, before a drop — it is the fastest way to tell a
// credential problem from an empty folder from a path that has moved.
//
//   npx dotenv -e .env.local -- npx tsx scripts/vintage/check-sftp.ts
//   npx dotenv -e .env.local -- npx tsx scripts/vintage/check-sftp.ts 13760 13761 13762
//
// With item numbers it also reports the match: which rows have no photo,
// which photos have no row, and which are missing their base shot.
import {
  listVintagePhotos,
  matchPhotosToItems,
  sftpConfigFromEnv,
  VintagePhotoError,
} from "@/lib/vintage/photos";

async function main() {
  const wanted = process.argv.slice(2).filter((a) => /^\d+$/.test(a));

  const config = sftpConfigFromEnv();
  console.log(`host   ${config.username}@${config.host}:${config.port}`);
  console.log(`path   ${config.remotePath}`);
  console.log(`public ${config.publicBase}\n`);

  const byItem = await listVintagePhotos(config);
  const files = [...byItem.values()].reduce((n, l) => n + l.length, 0);
  console.log(`${byItem.size} item(s), ${files} file(s).\n`);

  const counts = new Map<number, number>();
  for (const list of byItem.values()) counts.set(list.length, (counts.get(list.length) ?? 0) + 1);
  console.log("photos per item:");
  for (const [n, items] of [...counts].sort((a, b) => a[0] - b[0]))
    console.log(`  ${n} photo(s)  ${items} item(s)`);

  const noBase = [...byItem.entries()].filter(([, l]) => l[0].index !== 0).map(([n]) => n);
  if (noBase.length)
    console.log(`\n${noBase.length} item(s) with no base <n>.jpg: ${noBase.slice(0, 20).join(", ")}`);

  const newest = [...byItem.keys()].sort((a, b) => Number(b) - Number(a)).slice(0, 5);
  console.log(`\nhighest item numbers: ${newest.join(", ")}`);
  for (const n of newest.slice(0, 2))
    console.log(`  ${n}: ${byItem.get(n)!.map((p) => p.filename).join(", ")}`);

  if (!wanted.length) return;

  const m = matchPhotosToItems(wanted, byItem);
  console.log(`\n--- match against ${wanted.length} item(s) ---`);
  for (const [n, urls] of m.photos) console.log(`  ${n}  ${urls.length} photo(s)`);
  if (m.rowsWithoutPhotos.length)
    console.log(`  NO PHOTO (fatal): ${m.rowsWithoutPhotos.join(", ")}`);
  if (m.missingBasePhoto.length)
    console.log(`  NO BASE PHOTO (fatal): ${m.missingBasePhoto.join(", ")}`);
  if (m.photosWithoutRows.length)
    console.log(
      `  photographed but not entered (${m.photosWithoutRows.length}): ` +
        m.photosWithoutRows.slice(0, 30).join(", ")
    );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof VintagePhotoError ? e.message : e);
    process.exit(1);
  }
);
