// Loom push for the M.O.P buttons: registry mode, season STORAGE (exactly — Loom
// sends STORAGE products on to Pio without barcodes).
//   node scripts/mop-buttons/push.mjs            dry run (payload only)
//   node scripts/mop-buttons/push.mjs --apply    send, with an explicit event id
import { writeFileSync } from "node:fs";
const apply = process.argv.includes("--apply");
const ids = [
  "f4908b0b-199a-4d2e-83d5-b0e8061a2482", // 2526-1208-511
  "9da63c2e-c67d-4e9f-9cf5-acfea3d6b682", // 2526-1208-5120
  "8c813393-5b2e-46a3-a16a-0529012e2b99", // 2526-1208-515
  "36763763-b1b7-4360-b595-dbd8983d6606", // 2526-1208-516
  "9fe1705c-393e-4ae6-9039-31213111895d", // 2526-1208-517
];
const body = {
  colorwayIds: ids,
  seasonCode: "STORAGE",
  mode: "data",
  dryRun: !apply,
  ...(apply ? { eventId: `mop-buttons-storage-2026-10-07-${Date.now()}` } : {}),
};
const res = await fetch("http://localhost:3000/api/catalog/push/loom", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const j = await res.json().catch(async () => ({ text: await res.text() }));
writeFileSync(new URL(`./loom-${apply ? "live" : "dry"}.json`, import.meta.url), JSON.stringify(j, null, 2));
console.log(res.status, JSON.stringify(j, null, 1).slice(0, 5000));
