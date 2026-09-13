#!/usr/bin/env python3
"""Fill Origio's blank barcodes from what a channel already holds.

Origio is the master, but it was populated late and holds no barcode for 4,324
variants. Where a channel already carries a good code for the same SKU, that code
is the product's identity — it is printed on the garment and it scans at a till.
Reading it back into the master is not a peer-to-peer correction; it is the master
learning a value it never received.

Two guards beyond the apply route's own:

  * a barcode a channel holds on MORE THAN ONE live variant is refused. Shopify
    has no uniqueness constraint and holds 41 such codes; a scan cannot tell those
    garments apart, so the value does not identify anything and must not become
    identity in the master.
  * GS1 restricted ranges (prefix 2, 99) are refused. Those are shop-printed
    labels — what scans locally, not what the product is. See the Norda case.

    python3 scripts/fill-barcodes-from-channel.py shopify \
        snapshots/2026-09-12/shopify-products.json [--apply]

Prints a plan by default. --apply posts through the app's own API so the same
canonical-form, check-digit, collision and attribution rules run as for any other
barcode write.
"""
import argparse, json, os, re, subprocess, sys, urllib.request
from collections import defaultdict


def check_digit(first12: str) -> str:
    return str((10 - sum(int(c) * (1 if i % 2 == 0 else 3)
                         for i, c in enumerate(first12)) % 10) % 10)


def canonical(raw):
    """Mirror src/lib/master/barcode.ts canonical(): UPC-A -> EAN-13, else validate."""
    if not raw:
        return None
    s = re.sub(r"[​-‏‪-‮⁦-⁩﻿\s]", "", str(raw))
    if not s.isdigit():
        return None
    if len(s) == 12:
        s = "0" + s
    if len(s) != 13 or set(s) == {"0"}:
        return None
    if check_digit(s[:12]) != s[12]:
        return None
    return s


def restricted(bc: str) -> bool:
    # GS1: prefix 2 is in-store/variable-measure, 99 is coupon. Neither is identity.
    return bc.startswith("2") or bc.startswith("99")


def norm_sku(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def load_shopify(path):
    """-> (sku -> barcode) for live variants, and barcodes held more than once."""
    products = json.load(open(path))
    by_sku, holders = {}, defaultdict(set)
    for p in products:
        if p.get("status") == "ARCHIVED":
            continue
        for e in p.get("variants", {}).get("edges", []):
            n = e["node"]
            bc = canonical(n.get("barcode"))
            if not bc:
                continue
            holders[bc].add(n["id"])
            sku = norm_sku(n.get("sku"))
            if sku:
                by_sku.setdefault(sku, (n.get("sku"), bc))
    dupes = {b for b, ids in holders.items() if len(ids) > 1}
    return by_sku, dupes


def load_sitoo(path):
    products = json.load(open(path))
    by_sku, holders = {}, defaultdict(set)
    for p in products:
        bc = canonical(p.get("barcode"))
        if not bc:
            continue
        holders[bc].add(p.get("productid"))
        sku = norm_sku(p.get("sku"))
        if sku:
            by_sku.setdefault(sku, (p.get("sku"), bc))
    dupes = {b for b, ids in holders.items() if len(ids) > 1}
    return by_sku, dupes


def origio_blanks(pgurl):
    sql = ("select v.\"variantSku\" from \"Variant\" v "
           "where v.barcode is null and v.\"variantSku\" is not null")
    out = subprocess.run(["psql", pgurl, "-At", "-c", sql],
                         capture_output=True, text=True, check=True).stdout
    return [l for l in out.splitlines() if l.strip()]


def origio_taken(pgurl):
    out = subprocess.run(["psql", pgurl, "-At", "-c",
                          "select barcode from \"Variant\" where barcode is not null"],
                         capture_output=True, text=True, check=True).stdout
    return set(l.strip() for l in out.splitlines() if l.strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("channel", choices=["shopify", "sitoo"])
    ap.add_argument("snapshot")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--out", help="write the correction list here")
    ap.add_argument("--base-url", default=os.environ.get("ORIGIO_URL", "http://localhost:3000"))
    a = ap.parse_args()

    pgurl = None
    for line in open(".env.local"):
        if line.startswith("ORIGO_DATABASE_URL="):
            pgurl = line.split("=", 1)[1].strip().strip('"')
    if not pgurl:
        print("ORIGO_DATABASE_URL not found in .env.local", file=sys.stderr)
        return 1

    by_sku, dupes = (load_shopify if a.channel == "shopify" else load_sitoo)(a.snapshot)
    blanks = origio_blanks(pgurl)
    taken = origio_taken(pgurl)

    corrections, skipped = [], defaultdict(list)
    seen_target = {}
    for sku in blanks:
        hit = by_sku.get(norm_sku(sku))
        if not hit:
            skipped["not in channel"].append(sku)
            continue
        channel_sku, bc = hit
        if bc in dupes:
            skipped["channel holds it on >1 variant"].append(f"{sku} {bc}")
        elif restricted(bc):
            skipped["GS1 restricted range — a shop label, not identity"].append(f"{sku} {bc}")
        elif bc in taken:
            skipped["already on another Origio variant"].append(f"{sku} {bc}")
        elif bc in seen_target:
            skipped["two blanks claim it"].append(f"{sku} {bc} vs {seen_target[bc]}")
        else:
            seen_target[bc] = sku
            corrections.append({"variantSku": sku, "barcode": bc,
                                "channelSku": channel_sku})

    print(f"blank in Origio      {len(blanks):>6}")
    print(f"{a.channel} has a code for  {len(corrections) + sum(len(v) for k, v in skipped.items() if k != 'not in channel'):>6}")
    print(f"fillable             {len(corrections):>6}")
    for reason, rows in sorted(skipped.items()):
        if reason == "not in channel":
            print(f"  skipped, {reason:<42} {len(rows):>6}")
            continue
        print(f"  skipped, {reason:<42} {len(rows):>6}")
        for r in rows[:8]:
            print(f"      {r}")
        if len(rows) > 8:
            print(f"      ... and {len(rows) - 8} more")

    diff_sku = [c for c in corrections if norm_sku(c["variantSku"]) != norm_sku(c["channelSku"])]
    if diff_sku:
        print(f"\n  note: {len(diff_sku)} matched on a differently-spelled SKU")

    if a.out:
        json.dump(corrections, open(a.out, "w"), indent=1)
        print(f"\nwrote {a.out}")

    if not corrections:
        return 0

    payload = {
        "corrections": [{"variantSku": c["variantSku"], "barcode": c["barcode"]}
                        for c in corrections],
        "authority": a.channel,
        "evidence": f"{a.snapshot} — blank in the master, {a.channel} already held it",
        "dryRun": not a.apply,
    }
    req = urllib.request.Request(
        f"{a.base_url}/api/catalog/barcodes/apply",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        res = json.load(r)
    print(f"\n{'APPLIED' if a.apply else 'DRY RUN'}: "
          f"fill={len(res.get('fill', []))} change={len(res.get('change', []))} "
          f"applied={res.get('applied')} rejected={len(res.get('rejected', []))} "
          f"collisions={len(res.get('collisions', []))} unknownSku={len(res.get('unknownSku', []))}")
    for k in ("rejected", "collisions"):
        for row in res.get(k, [])[:10]:
            print(f"  {k}: {row}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
