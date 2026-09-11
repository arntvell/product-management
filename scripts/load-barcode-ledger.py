#!/usr/bin/env python3
"""Load the CFO barcode list into Origio's BarcodeAllocation ledger.

The ledger is what makes allocation safe: `max(sequence) + 1` only works if the
master knows every number already issued. Every barcode is
`range + zero-padded sequence + EAN-13 check digit`, verified against all 9,822
rows of the list with zero mismatches.

    python3 scripts/load-barcode-ledger.py \
        snapshots/2026-09-11/worklists/barcodes-2026-09-11.csv \
        --authority cfo-list-2026-09-11 [--apply]

Prints the SQL by default. --apply posts it through the app's own API so the
same validation runs as for any other write.
"""
import argparse, csv, json, os, sys, urllib.request

RANGES = ("7072536", "7000000")


def check_digit(first12: str) -> str:
    return str((10 - sum(int(c) * (1 if i % 2 == 0 else 3)
                         for i, c in enumerate(first12)) % 10) % 10)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("csv_path")
    ap.add_argument("--authority", default="cfo-list")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--base-url", default=os.environ.get("ORIGIO_URL", "http://localhost:3000"))
    a = ap.parse_args()

    rows = list(csv.DictReader(open(a.csv_path)))
    entries, bad = [], []
    for r in rows:
        ean = (r.get("EAN") or "").strip()
        sku = (r.get("SKU") or "").strip()
        if len(ean) != 13 or not ean.isdigit() or check_digit(ean[:12]) != ean[12]:
            bad.append((sku, ean, "bad check digit or not 13 digits"))
            continue
        if not any(ean.startswith(p) for p in RANGES):
            bad.append((sku, ean, "outside Livid's ranges — not ours to track"))
            continue
        entries.append({"barcode": ean, "sku": sku, "authority": a.authority})

    print(f"{len(entries)} loadable, {len(bad)} skipped", file=sys.stderr)
    for b in bad[:10]:
        print(f"  skip {b[0]} {b[1]} — {b[2]}", file=sys.stderr)

    if not a.apply:
        print("-- dry run; re-run with --apply to load", file=sys.stderr)
        print(json.dumps({"entries": entries[:5], "total": len(entries)}, indent=2))
        return 0

    url = a.base_url.rstrip("/") + "/api/catalog/barcodes/ledger"
    loaded = 0
    for i in range(0, len(entries), 1000):
        chunk = entries[i:i + 1000]
        req = urllib.request.Request(
            url, data=json.dumps({"entries": chunk}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as res:
            body = json.load(res)
        loaded += body.get("recorded", 0)
        print(f"  {i + len(chunk)}/{len(entries)} — recorded {body.get('recorded')}", file=sys.stderr)
    print(f"loaded {loaded}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
