#!/usr/bin/env python3
"""Turn the barcode authority rules into a concrete, per-system change set.

    python3 scripts/reconcile/resolve.py snapshots/2026-09-11              # preview
    python3 scripts/reconcile/resolve.py snapshots/2026-09-11 --write-origio

Authority, in order (see scripts/reconcile/decisions.json):
  1. an explicit per-SKU decision
  2. the CFO list, for any SKU it covers          -- Livid
  3. Sitoo, for everything else                   -- the only system where a wrong
                                                     barcode fails at the till

Preview is the default and prints nothing but counts and a sample. `--write-origio`
writes to OUR database only, inside a transaction, and never to Sitoo, Shopify or
Cin7 -- those get CSVs to feed through their own import tooling, because a bad
bulk write to a live sales channel is not recoverable from here.
"""
import collections, csv, json, os, re, subprocess, sys, unicodedata

def n(x): return (x or "").strip()

def norm(bc):
    """Same normalisation the reconciler uses: UPC-A and EAN-13 are one code."""
    b = "".join(ch for ch in (bc or "") if unicodedata.category(ch) != "Cf").strip()
    if not b or b == "0" or b.lower() in ("none", "null"): return ""
    if len(b) == 13 and b.startswith("0"): b = b[1:]
    return b

def load(d):
    j = lambda f: json.load(open(os.path.join(d, f)))
    cfo = {}
    for name in sorted(os.listdir(os.path.join(d, "worklists"))):
        if name.startswith("barcodes-") and name.endswith(".csv"):
            for r in csv.DictReader(open(os.path.join(d, "worklists", name))):
                cfo[n(r["SKU"])] = norm(r["EAN"])
    master = [r for r in csv.reader(open(os.path.join(d, "master-variants.tsv")),
                                    delimiter="\t") if len(r) >= 7]
    sysmap = {
        "origio":  {n(r[0]): norm(r[1]) for r in master if n(r[0]) and r[6] != "t"},
        "sitoo":   {n(p.get("sku")): norm(p.get("barcode"))
                    for p in j("sitoo-products.json") if n(p.get("sku"))},
        "shopify": {n(v["node"].get("sku")): norm(v["node"].get("barcode"))
                    for p in j("shopify-products.json")
                    for v in p["variants"]["edges"] if n(v["node"].get("sku"))},
        "cin7":    {n(p.get("SKU")): norm(p.get("Barcode"))
                    for p in j("cin7-products.json") if n(p.get("SKU"))},
    }
    return cfo, sysmap

def _internal_range(bc):
    """GS1 ranges reserved for in-store/internal use, not a brand's real EAN."""
    return bc.startswith("99") or (bc.startswith("2") and len(bc) == 13)


def authority(sku, cfo, sysmap, decisions):
    per = decisions.get("per_sku", {}).get(sku)
    if per: return norm(per["barcode"]), f"decision:{per['winner']}"
    if sku in cfo and cfo[sku]: return cfo[sku], "cfo_list"
    s = sysmap["sitoo"].get(sku)
    if s: return s, "sitoo"
    return None, None

def main(d, write_origio=False):
    decisions = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            "decisions.json")))
    cfo, sysmap = load(d)
    all_skus = set().union(*(set(m) for m in sysmap.values())) | set(cfo)
    # barcode -> the SKUs that already hold it, per system
    held = {sysname: collections.defaultdict(set) for sysname in sysmap}
    for sysname, m in sysmap.items():
        for sku, bc in m.items():
            if bc: held[sysname][bc].add(sku)

    changes = collections.defaultdict(list)
    withheld = collections.defaultdict(list)
    for sku in sorted(all_skus):
        truth, src = authority(sku, cfo, sysmap, decisions)
        if not truth: continue
        for system, m in sysmap.items():
            if sku not in m: continue          # absent is a different problem
            cur = m[sku]
            if cur == truth: continue
            row = {"sku": sku, "from": cur, "to": truth, "authority": src,
                   "action": "fill" if not cur else "correct"}

            # GUARD 1 -- never create a scan ambiguity. If another SKU in this
            # system already holds the target barcode, writing it would put one
            # barcode on two products. Shopify has 34 of these, all its own
            # renamed duplicates (LIV-KR-BLCK-LNN-2432 vs LIV-KRI-BLKLN-2432):
            # the fix is to merge the duplicate product, not to give both the
            # same code.
            others = held[system].get(truth, set()) - {sku}
            if others:
                withheld[system].append({**row, "why": "collides",
                                         "detail": "|".join(sorted(others))})
                continue

            # GUARD 2 -- do not propagate a store-printed label beyond the shop.
            # Sitoo sometimes holds an internally printed barcode (GS1 99*/2*
            # ranges) rather than the brand's EAN -- Norda scans as 990497* in
            # store while every other system holds Norda's real 872236*. Both
            # are correct for different questions, so the POS keeps its label
            # and the master keeps the manufacturer's code.
            if src == "sitoo" and system != "sitoo" and _internal_range(truth):
                withheld[system].append({**row, "why": "sitoo_internal_label",
                                         "detail": "store-printed, not the brand EAN"})
                continue

            changes[system].append(row)
    print(f"{'system':<10}{'correct':>9}{'fill':>7}{'total':>8}   authority breakdown")
    for system in ("origio", "sitoo", "shopify", "cin7"):
        rows = changes[system]
        corr = sum(1 for r in rows if r["action"] == "correct")
        fill = len(rows) - corr
        by = collections.Counter(r["authority"] for r in rows)
        print(f"{system:<10}{corr:>9,}{fill:>7,}{len(rows):>8,}   "
              + ", ".join(f"{k}={v:,}" for k, v in by.most_common()))
    total_held = sum(len(v) for v in withheld.values())
    if total_held:
        print(f"\nWITHHELD {total_held:,} changes that would have caused harm:")
        for system, rows in sorted(withheld.items()):
            by = collections.Counter(r["why"] for r in rows)
            print(f"   {system:<9}" + ", ".join(f"{k}={v}" for k, v in by.most_common()))
        p = os.path.join(d, "worklists", "withheld.csv")
        with open(p, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["system", "sku", "current_barcode", "would_write", "why", "detail"])
            for system, rows in sorted(withheld.items()):
                for r in sorted(rows, key=lambda r: r["sku"]):
                    w.writerow([system, r["sku"], r["from"], r["to"], r["why"], r["detail"]])
        print(f"   -> {os.path.relpath(p)}")

    out = os.path.join(d, "worklists")
    for system, rows in changes.items():
        p = os.path.join(out, f"apply_{system}.csv")
        with open(p, "w", newline="") as f:
            w = csv.writer(f); w.writerow(["sku", "current_barcode", "new_barcode",
                                           "authority", "action"])
            for r in sorted(rows, key=lambda r: (r["action"], r["sku"])):
                w.writerow([r["sku"], r["from"], r["to"], r["authority"], r["action"]])
        print(f"   -> {os.path.relpath(p)}")

    if not write_origio:
        print("\npreview only — nothing written. --write-origio applies the Origio "
              "rows to our database.")
        return
    rows = changes["origio"]
    if not rows:
        print("\nnothing to write to Origio."); return
    # One transaction, matched on variantSku, and never blanking an existing value.
    stmts = ["BEGIN;"]
    for r in rows:
        sku = r["sku"].replace("'", "''"); bc = r["to"].replace("'", "''")
        stmts.append(f"UPDATE \"Variant\" SET barcode='{bc}' "
                     f"WHERE \"variantSku\"='{sku}';")
    stmts.append("COMMIT;")
    sql = "\n".join(stmts)
    path = os.path.join(d, "apply_origio.sql")
    open(path, "w").write(sql)
    print(f"\n{len(rows):,} UPDATE statements written to {os.path.relpath(path)}")
    print("run it with:  psql \"$ORIGO_POSTGRES_URL_NON_POOLING\" -f " + os.path.relpath(path))

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    main(args[0] if args else ".", "--write-origio" in sys.argv)
