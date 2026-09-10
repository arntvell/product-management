#!/usr/bin/env python3
"""Turn findings.json into CSV worklists a person can actually work through.

    python3 scripts/reconcile/worklists.py snapshots/2026-09-11

One CSV per finding type, sorted so the highest-value rows come first. Written
next to the snapshot, gitignored with it.
"""
import csv, json, os, sys

def rows_for(kind, items):
    if kind in ("SKU_CONFLICT", "BARCODE_CONFLICT"):
        key = "barcode" if kind == "SKU_CONFLICT" else "sku"
        systems = ["origio", "sitoo", "shopify", "cin7"]
        yield [key] + systems + ["disagreement"]
        for f in items:
            per = f["per_system"]
            vals = {s: "|".join(per.get(s, [])) for s in systems}
            present = [v for v in vals.values() if v]
            yield [f[key]] + [vals[s] for s in systems] + \
                  ["all agree" if len(set(present)) == 1 else "DIFFERS"]
        return
    yield ["sku", "barcode", "title", "category", "qty_sitoo", "qty_cin7",
           "systems", "seasons"]
    for f in items:
        yield ["|".join(f.get("sku", [])), "|".join(f.get("barcode", [])),
               f.get("title", ""), f.get("cat", ""),
               f"{f.get('qty_sitoo', 0):.0f}", f"{f.get('qty_cin7', 0):.0f}",
               "+".join(f.get("systems", [])), ",".join(f.get("seasons", []))]

def main(d):
    findings = json.load(open(os.path.join(d, "findings.json")))
    out = os.path.join(d, "worklists"); os.makedirs(out, exist_ok=True)
    for kind, items in sorted(findings.items()):
        if kind not in ("SKU_CONFLICT", "BARCODE_CONFLICT"):
            items = sorted(items, key=lambda f: -(f.get("qty_sitoo", 0) + f.get("qty_cin7", 0)))
        path = os.path.join(out, f"{kind.lower()}.csv")
        with open(path, "w", newline="") as fh:
            csv.writer(fh).writerows(rows_for(kind, items))
        print(f"   {kind:<24}{len(items):>7,}  -> {os.path.relpath(path)}")

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
