#!/usr/bin/env python3
"""Snapshot every platform's product data into ./snapshots/<date>/.

Read-only. Nothing is written to any external system. Run before reconcile.py.

    python3 scripts/reconcile/fetch.py            # all platforms
    python3 scripts/reconcile/fetch.py sitoo cin7 # a subset

Credentials come from .env.local (never committed). The master is read with psql
via ORIGO_POSTGRES_URL_NON_POOLING.
"""
import base64, csv, datetime, json, os, re, subprocess, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "snapshots", datetime.date.today().isoformat())

def env():
    e = {}
    with open(os.path.join(ROOT, ".env.local")) as f:
        for line in f:
            m = re.match(r'^([A-Z][A-Z0-9_]*)=(.*)$', line.strip())
            if m:
                e[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return e

def get_json(url, headers, tries=5, timeout=120):
    for a in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers),
                                        timeout=timeout) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and a < tries - 1:
                time.sleep(2.5 * (a + 1)); continue
            raise
        except Exception:
            if a == tries - 1: raise
            time.sleep(2 * (a + 1))

def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "w") as f:
        json.dump(data, f)
    print(f"  -> {name}  ({len(data):,} rows)")

# --------------------------------------------------------------------------
def fetch_sitoo(e):
    """Sitoo is site-scoped: /sites/{siteid}/... with the NUMERIC site id (1),
    not the GUID that /sites returns. Page size up to 1000."""
    base = e["SITOO_BASE_URL"].rstrip("/")
    auth = base64.b64encode(f'{e["SITOO_API_ID"]}:{e["SITOO_API_KEY"]}'.encode()).decode()
    H = {"Authorization": f"Basic {auth}"}
    fields = "productid,sku,barcode,title,variantparentid,active,activepos,moneyprice,manufacturerid"
    prods, start = [], 0
    while True:
        d = get_json(f"{base}/sites/1/products?start={start}&num=1000"
                     f"&fields={fields}&includeinactive=true", H)
        items = d.get("items", []); prods += items
        if not items or len(prods) >= d.get("totalcount", 0): break
        start += 1000; time.sleep(0.3)
    save("sitoo-products.json", prods)

    whs = get_json(f"{base}/sites/1/warehouses?start=0&num=100", H)["items"]
    stock = []
    for w in whs:
        start = 0
        while True:
            d = get_json(f"{base}/sites/1/warehouses/{w['warehouseid']}/warehouseitems"
                         f"?start={start}&num=1000"
                         f"&fields=sku,decimaltotal,decimalavailable,decimalreserved", H)
            items = d.get("items", [])
            for it in items:
                it["warehouseid"] = w["warehouseid"]; it["warehousename"] = w.get("name")
            stock += items
            if not items or len(items) < 1000: break
            start += 1000; time.sleep(0.2)
    save("sitoo-stock.json", stock)

def fetch_shopify(e):
    store = re.sub(r'^https?://', '', e["SHOPIFY_STORE_URL"]).rstrip("/")
    url = f"https://{store}/admin/api/2025-10/graphql.json"
    H = {"Content-Type": "application/json", "X-Shopify-Access-Token": e["SHOPIFY_ACCESS_TOKEN"]}
    Q = ("query P($cursor:String){ products(first:100, after:$cursor){ edges{ node{ "
         "id title handle status vendor productType "
         "variants(first:100){ edges{ node{ id sku barcode inventoryQuantity } } } } } "
         "pageInfo{ hasNextPage endCursor } } }")
    out, cur = [], None
    while True:
        body = json.dumps({"query": Q, "variables": {"cursor": cur}}).encode()
        req = urllib.request.Request(url, data=body, headers=H)
        with urllib.request.urlopen(req, timeout=90) as r:
            d = json.load(r)
        if "errors" in d: raise RuntimeError(str(d["errors"])[:400])
        p = d["data"]["products"]; out += [x["node"] for x in p["edges"]]
        if not p["pageInfo"]["hasNextPage"]: break
        cur = p["pageInfo"]["endCursor"]; time.sleep(0.35)
    save("shopify-products.json", out)

def fetch_cin7(e):
    BASE = "https://inventory.dearsystems.com/ExternalApi/v2"
    H = {"api-auth-accountid": e["CIN7_ACCOUNT_ID"],
         "api-auth-applicationkey": e["CIN7_API_KEY"], "Content-Type": "application/json"}
    def page(path, key):
        out, pg = [], 1
        while True:
            d = get_json(f"{BASE}{path}?Page={pg}&Limit=1000", H)
            rows = d.get(key) or []; out += rows
            if not rows or len(out) >= d.get("Total", 0): break
            pg += 1; time.sleep(0.6)
        return out
    save("cin7-products.json", page("/product", "Products"))
    save("cin7-availability.json", page("/ref/productavailability", "ProductAvailabilityList"))

def fetch_master(e):
    os.makedirs(OUT, exist_ok=True)
    sql = ('SELECT v."variantSku", COALESCE(v.barcode,\'\'), c."colorwaySku", c.name, '
           'c.source, COALESCE(c.vendor,\'\'), c.archived, '
           'COALESCE((SELECT string_agg(DISTINCT s.code, \',\') FROM "SeasonEntry" e '
           'JOIN "Season" s ON s.id=e."seasonId" WHERE e."colorwayId"=c.id), \'\') '
           'FROM "Variant" v JOIN "Colorway" c ON c.id=v."colorwayId";')
    path = os.path.join(OUT, "master-variants.tsv")
    with open(path, "w") as f:
        subprocess.run(["psql", "-t", "-A", "-F\t", e["ORIGO_POSTGRES_URL_NON_POOLING"],
                        "-c", sql], stdout=f, check=True)
    print(f"  -> master-variants.tsv  ({sum(1 for _ in open(path)):,} rows)")

if __name__ == "__main__":
    e = env()
    want = [a.lower() for a in sys.argv[1:]] or ["master", "sitoo", "shopify", "cin7"]
    for name in want:
        print(f"{name}:")
        {"sitoo": fetch_sitoo, "shopify": fetch_shopify,
         "cin7": fetch_cin7, "master": fetch_master}[name](e)
    print(f"\nsnapshot: {OUT}")
