// Read-only run of the size-systems partner calls through the lib functions
// (no HTTP, no token). Every PATCH here is dry_run: true — nothing is written.
//
//   npx dotenv -e .env.local -- npx tsx --tsconfig tsconfig.json scripts/partner/dry-run-size-systems.ts
import { getSizeSystems, patchSizeSystem } from "../../src/lib/partner/size-systems";
import { addColorwaySizes } from "../../src/lib/partner/colorway-sizes";

const show = (label: string, v: unknown) => console.log(label, JSON.stringify(v, null, 1));

async function main() {
  const byCw = await getSizeSystems({ colorway_sku: "EXT-PRB-CMB-NR" });
  const uk = byCw.systems[0];
  show("GET colorway", { ...byCw, systems: byCw.systems.map((s) => ({ ...s, sizes: `${s.sizes.length} sizes, in use: ${s.sizes.filter((x) => x.in_use).map((x) => x.label).join(" ")}` })) });
  const byBrand = await getSizeSystems({ brand: "paraboot" });
  show("GET brand", byBrand.systems.map((s) => [s.id, s.name, s.reason, s.brands]));
  show("GET unknowns", [await getSizeSystems({ colorway_sku: "EXT-NOPE" }), await getSizeSystems({ brand: "Nobody Brand" })]);
  const shared = await getSizeSystems({ brand: "Converse" });
  show("GET Converse", shared.systems.map((s) => [s.id, s.name, s.brands]));

  if (uk) {
    const add = await patchSizeSystem(uk.id, { dry_run: true, ops: [{ op: "add", label: "14", after: "13" }] });
    show("PATCH dry add 14", { ...add, system: add.system?.sizes.map((x) => x.label).join(" ") });
    const re = await patchSizeSystem(uk.id, { dry_run: true, ops: [{ op: "reorder", labels: uk.display_order }] });
    show("PATCH dry reorder natural", { ...re, system: re.system?.sizes.map((x) => x.label).join(" ") });
    show("PATCH dry add existing", await patchSizeSystem(uk.id, { dry_run: true, ops: [{ op: "add", label: "12" }] }).then((r) => ({ ...r, system: undefined })));
    show("PATCH rename", await patchSizeSystem(uk.id, { dry_run: true, ops: [{ op: "rename" }] }));
  }
  if (shared.systems[0]) show("PATCH shared, no confirm", await patchSizeSystem(shared.systems[0].id, { dry_run: true, ops: [{ op: "add", label: "50" }] }));

  const cs = await addColorwaySizes({ dry_run: true, items: [{ loom_key: "z", colorway_sku: "EXT-PRB-CMB-NR", sizes: ["46"], cost_nok: 1, msrp_nok: 1 }] });
  show("colorway-sizes 46", cs.items);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
