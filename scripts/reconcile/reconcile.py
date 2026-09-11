#!/usr/bin/env python3
"""Reconcile a snapshot across Origio, Sitoo, Shopify and Cin7.

    python3 scripts/reconcile/reconcile.py snapshots/2026-09-11

Writes typed findings next to the snapshot. Read-only; changes nothing anywhere.

Two things this gets right that a naive diff does not:

1. IDENTITY. Records are linked by shared barcode OR shared SKU, resolved with
   union-find. Keying on barcode alone splits a product whose master row has no
   barcode -- and the master is only ~58% covered -- reporting a present product
   as missing. That mistake inflated an early run by ~600 products.

2. SCOPE. Two whole categories of row are not merchandise and must not be
   reconciled as if they were:
     - Cin7 holds production inputs (buttons, samples, fabric). One SKU carries
       95,000+ units. Summing them makes stock figures meaningless.
     - A pre-season style has no stock because it has not been made yet. Gating
       on stock without checking the season retires the entire coming season.
"""
import collections, csv, json, os, re, sys, unicodedata

NON_MERCH = {"Button", "Sample", "SAMPLE PACK", "Service", "Non-inventory", "Fabric",
             "wrapin", "Storage", "lager", "Skredder", "Fitguide", "Shopify", "SAVED",
             "Gift Cards", "Stork"}
# Seasons whose products are not yet produced: absence of stock proves nothing.
PRESEASON = {"SS27"}

# Rows that carry stock but are not a product anyone sells as such. They are few
# -- ~31 of 4,583 -- but they hold enormous quantities (one sale bucket has 2,040
# units), so they dominate any "biggest first" list and would be imported as
# products by anyone working top-down. Flagged separately, never mixed in.
NON_PRODUCT = [
    (r"WBTST|WEBSHIPPER|-TEST-|^TEST",   "test data"),
    (r"SLGSV",                            "aggregate: sale bucket"),
    (r"^EXT-VN-NW-|^EXT-VN-[A-Z]+$",     "aggregate: vintage bulk lot"),
    (r"^LIV-IMP-[A-Z]+-OS$",             "aggregate: imperfect bucket"),
    (r"SMPL|^S-\d+$|SAMPLE",             "sample / consumable"),
    (r"^STORAGE-",                        "internal storage"),
    (r"PICKUP|PCKUP|REPS|REPARASJON",    "service: repair / pickup"),
    (r"GFTCRD|GIFT",                      "gift card"),
]

# Channel policy, measured rather than assumed. Vintage is a webshop line: 0 of
# it is in the POS against 3,762 in Shopify. Imperfects are a shop line: 1,197 in
# the POS against 18 in Shopify. Absence from the "wrong" channel is intent, not
# a gap, and reporting it as a gap buries the ~800 rows that do need a look under
# ~1,750 that do not.
CHANNEL_POLICY = {
    "sitoo":   [(r"^VN-ONLN|^VN-", "vintage is webshop-only")],
    "shopify": [(r"^IMP-",         "imperfects are shop-only")],
}

def policy_exempt(channel, skus):
    hay = " ".join(skus).upper()
    for pat, why in CHANNEL_POLICY.get(channel, []):
        if re.search(pat, hay): return why
    return None


def non_product(skus, title):
    hay = " ".join(skus).upper() + " " + (title or "").upper()
    for pat, label in NON_PRODUCT:
        if re.search(pat, hay): return label
    return None

def n(x): return (x or "").strip()

def usable(bc):
    """Normalised barcode, or "" if there isn't a usable one.

    A 12-digit UPC-A and its 13-digit EAN-13 form are THE SAME BARCODE -- the
    EAN-13 is the UPC-A with a leading zero. Systems store them both ways, and
    comparing the raw strings reported 21 of 180 "conflicts" that were nothing
    of the kind (most of Stutterheim and P.F. Candle). Compare on the 12-digit
    core. Invisible formatting characters are stripped for the same reason.
    """
    b = "".join(ch for ch in (bc or "") if unicodedata.category(ch) != "Cf").strip()
    if not b or b == "0" or b.lower() in ("none", "null"): return ""
    if len(b) == 13 and b.startswith("0"): b = b[1:]
    return b

class Union:
    def __init__(self): self.p = {}
    def find(self, x):
        self.p.setdefault(x, x)
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]; x = self.p[x]
        return x
    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb: self.p[ra] = rb

def load(d):
    j = lambda f: json.load(open(os.path.join(d, f)))
    master = [r for r in csv.reader(open(os.path.join(d, "master-variants.tsv")),
                                    delimiter="\t") if len(r) >= 7]
    return (j("sitoo-products.json"), j("sitoo-stock.json"), j("shopify-products.json"),
            j("cin7-products.json"), j("cin7-availability.json"), master)

def run(d):
    sitoo, sstock, shop, c7, c7av, master = load(d)
    c7_by_sku = {n(p.get("SKU")): p for p in c7 if n(p.get("SKU"))}
    def merch(sku):
        p = c7_by_sku.get(n(sku))
        return True if not p else (p.get("Category") not in NON_MERCH and p.get("Type") == "Stock")

    st_sitoo, st_c7, st_c7_bc = (collections.defaultdict(float) for _ in range(3))
    for r in sstock:
        q = float(r.get("decimaltotal") or 0)
        if q > 0: st_sitoo[n(r["sku"])] += q
    for r in c7av:
        q = float(r.get("OnHand") or 0)
        if q > 0 and merch(r.get("SKU")):
            st_c7[n(r.get("SKU"))] += q
            if usable(r.get("Barcode")): st_c7_bc[usable(r.get("Barcode"))] += q

    rows = []
    for rec in master:
        vs, bc, cs, name, src, vendor, arch = rec[:7]
        seasons = rec[7] if len(rec) > 7 else ""
        rows.append(dict(sys="origio", bc=usable(bc), sku=n(vs), title=n(name),
                         merch=True, cat="", active=(arch != "t"), seasons=n(seasons)))
    for p in sitoo:
        if p.get("variantparentid") is None and not usable(p.get("barcode")): continue
        rows.append(dict(sys="sitoo", bc=usable(p.get("barcode")), sku=n(p.get("sku")),
                         title=n(p.get("title")), merch=True, cat="",
                         active=bool(p.get("active")), seasons=""))
    for prod in shop:
        for e in prod["variants"]["edges"]:
            v = e["node"]
            rows.append(dict(sys="shopify", bc=usable(v.get("barcode")), sku=n(v.get("sku")),
                             title=n(prod.get("title")), merch=True, cat="",
                             active=(prod.get("status") == "ACTIVE"), seasons=""))
    for p in c7:
        if not n(p.get("SKU")): continue
        cat = p.get("Category") or ""
        rows.append(dict(sys="cin7", bc=usable(p.get("Barcode")), sku=n(p.get("SKU")),
                         title=n(p.get("Name")), cat=cat,
                         merch=(cat not in NON_MERCH and p.get("Type") == "Stock"),
                         active=(n(p.get("Status")) == "Active"), seasons=""))

    uf = Union()
    for i, r in enumerate(rows):
        uf.find(("r", i))
        if r["bc"]:  uf.union(("r", i), ("bc", r["bc"]))
        if r["sku"]: uf.union(("r", i), ("sku", r["sku"]))

    G = collections.defaultdict(lambda: dict(sys=set(), sku=set(), bc=set(), title="",
                                             merch=True, cat="", seasons=set()))
    for i, r in enumerate(rows):
        g = G[uf.find(("r", i))]
        g["sys"].add(r["sys"])
        if r["bc"]:  g["bc"].add(r["bc"])
        if r["sku"]: g["sku"].add(r["sku"])
        if r["title"] and not g["title"]: g["title"] = r["title"][:58]
        if not r["merch"]: g["merch"] = False
        if r["cat"] and not g["cat"]: g["cat"] = r["cat"]
        for s in filter(None, r["seasons"].split(",")): g["seasons"].add(s)
    for g in G.values():
        g["qty_sitoo"] = sum(st_sitoo.get(s, 0.0) for s in g["sku"])
        g["qty_cin7"] = (sum(st_c7.get(s, 0.0) for s in g["sku"]) +
                         sum(st_c7_bc.get(b, 0.0) for b in g["bc"]))
        g["stocked"] = g["qty_sitoo"] > 0 or g["qty_cin7"] > 0
        g["preseason"] = bool(g["seasons"]) and g["seasons"] <= PRESEASON

    merch_g = {k: g for k, g in G.items() if g["merch"]}
    stocked = {k: g for k, g in merch_g.items() if g["stocked"]}
    findings = collections.defaultdict(list)
    for k, g in merch_g.items():
        rec = dict(sku=sorted(g["sku"])[:6], barcode=sorted(g["bc"])[:4], title=g["title"],
                   cat=g["cat"], qty_sitoo=g["qty_sitoo"], qty_cin7=g["qty_cin7"],
                   systems=sorted(g["sys"]), seasons=sorted(g["seasons"]))
        np = non_product(sorted(g["sku"]), g["title"])
        if np:
            rec["reason"] = np
            findings["NON_PRODUCT"].append(rec)
            continue
        if g["stocked"] and "origio" not in g["sys"]:
            findings["MISSING_FROM_ORIGIO"].append(rec)
        if "origio" in g["sys"] and not g["stocked"] and not g["preseason"]:
            findings["RETIRE_CANDIDATE"].append(rec)
        if g["stocked"] and "origio" in g["sys"]:
            for s in ("sitoo", "shopify", "cin7"):
                if s in g["sys"]: continue
                why = policy_exempt(s, sorted(g["sku"]))
                if why:
                    findings["CHANNEL_POLICY"].append({**rec, "channel": s, "reason": why})
                else:
                    findings[f"MISSING_FROM_{s.upper()}"].append(rec)
        if "origio" in g["sys"] and not g["bc"] and not g["preseason"]:
            findings["NO_BARCODE"].append(rec)

    per = collections.defaultdict(lambda: collections.defaultdict(set))
    for r in rows:
        if r["bc"] and r["sku"]: per[("bc", r["bc"])][r["sys"]].add(r["sku"])
    for key, m in per.items():
        if len(m) > 1:
            vals = list(m.values())
            if any(not (a & b) for i, a in enumerate(vals) for b in vals[i+1:]):
                findings["SKU_CONFLICT"].append({"barcode": key[1],
                                                 "per_system": {s: sorted(v) for s, v in m.items()}})
    per2 = collections.defaultdict(lambda: collections.defaultdict(set))
    for r in rows:
        if r["bc"] and r["sku"]: per2[("sku", r["sku"])][r["sys"]].add(r["bc"])
    for key, m in per2.items():
        if len(m) > 1:
            vals = list(m.values())
            if any(not (a & b) for i, a in enumerate(vals) for b in vals[i+1:]):
                findings["BARCODE_CONFLICT"].append({"sku": key[1],
                                                     "per_system": {s: sorted(v) for s, v in m.items()}})

    print(f"identities {len(G):,}   merchandise {len(merch_g):,}   stocked {len(stocked):,}")
    print(f"units  sitoo {sum(g['qty_sitoo'] for g in stocked.values()):>10,.0f}"
          f"   cin7 {sum(g['qty_cin7'] for g in stocked.values()):>10,.0f}\n")
    for k in sorted(findings, key=lambda k: -len(findings[k])):
        print(f"   {k:<24}{len(findings[k]):>7,}")
    out = os.path.join(d, "findings.json")
    json.dump({k: v for k, v in findings.items()}, open(out, "w"), indent=1)
    print(f"\nwritten: {out}")

if __name__ == "__main__":
    run(sys.argv[1] if len(sys.argv) > 1 else ".")
