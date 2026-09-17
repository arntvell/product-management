#!/usr/bin/env python3
"""Upload the FW26 flat-lays and record them as FLAT MediaAssets.

FLATS/FW26/{MENS,WOMENS}/<STYLE-COLOURWAY>.jpg (FLATS/ is those two combined,
so it is ignored). The flat is what the push uses as a unisex product's gallery,
and it becomes custom.flat on every product.

Matching is the same three-way contract as the e-com matcher: confident /
ambiguous / unmatched, never a guess.
"""
import argparse, json, mimetypes, os, re, subprocess, sys, urllib.parse, urllib.request
from collections import defaultdict

BLOB_API = "https://blob.vercel-storage.com"
ALIAS = {
    "porclain": "porcelain", "directorie": "directory", "viole": "voile",
    "paid": "plaid", "ckeck": "check", "coffe": "coffee", "pullover": "pull over",
}


def norm(s):
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    out = []
    for t in s.split():
        out.extend(ALIAS.get(t, t).split())
    return " ".join(out)


def blob_put(pathname, data, ct, token):
    req = urllib.request.Request(
        f"{BLOB_API}/{urllib.parse.quote(pathname)}", data=data, method="PUT",
        headers={"authorization": f"Bearer {token}", "x-api-version": "7",
                 "x-content-type": ct, "x-add-random-suffix": "1",
                 "x-cache-control-max-age": "31536000"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def q(v):
    return "'" + v.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--flats", required=True)
    ap.add_argument("--master", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only-skus", help="comma-separated colorwaySkus to limit to")
    args = ap.parse_args()

    import csv
    master = []
    for r in csv.reader(open(args.master), delimiter="\t"):
        if len(r) < 8:
            continue
        master.append({"id": r[0], "sku": r[1], "style": r[2], "name": r[3],
                       "unisex": r[4] == "t",
                       "full": norm(f"{r[2]} {r[3]}")})
    for m in master:
        m["toks"] = set(m["full"].split())

    files = []
    for gender in ("MENS", "WOMENS"):
        d = os.path.join(args.flats, gender)
        if not os.path.isdir(d):
            continue
        for fn in sorted(os.listdir(d)):
            if fn.startswith(".") or not fn.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            stem = re.sub(r"\s+\d+$", "", os.path.splitext(fn)[0])  # "… 1" duplicates
            files.append({"path": os.path.join(d, fn), "file": fn,
                          "gender": gender, "key": norm(stem)})

    only = set(args.only_skus.split(",")) if args.only_skus else None
    plan, unmatched, ambiguous = [], [], []
    for f in files:
        qt = set(f["key"].split())
        exact = [m for m in master if m["full"] == f["key"]]
        cands = exact or [m for m in master if qt and qt <= m["toks"]]
        if not cands:
            unmatched.append(f)
            continue
        if len(cands) > 1:
            by_extra = defaultdict(list)
            for m in cands:
                by_extra[len(m["toks"] - qt)].append(m)
            few = by_extra[min(by_extra)]
            if len(few) != 1:
                ambiguous.append((f, cands))
                continue
            cands = few
        m = cands[0]
        if only and m["sku"] not in only:
            continue
        plan.append({**f, "colorway": m})

    print(f"flat files: {len(files)}   matched: {len(plan)}   "
          f"ambiguous: {len(ambiguous)}   unmatched: {len(unmatched)}")
    if not args.apply:
        for p in plan[:10]:
            print(f"  {p['file']:44s} -> {p['colorway']['style']} / {p['colorway']['name']}")
        if unmatched:
            print("  unmatched:", ", ".join(f["file"] for f in unmatched[:10]))
        print("\nDry run — nothing uploaded.")
        return

    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    db = os.environ["ORIGO_DATABASE_URL_UNPOOLED"]
    done = 0
    for p in plan:
        cid = p["colorway"]["id"]
        # Skip if this colorway already has a FLAT.
        chk = subprocess.run(["psql", db, "-t", "-A", "-c",
            f'select count(*) from "MediaAsset" where "colorwayId"={q(cid)} and role=\'FLAT\';'],
            capture_output=True, text=True)
        if chk.stdout.strip() not in ("0", ""):
            continue
        ct = mimetypes.guess_type(p["path"])[0] or "image/jpeg"
        with open(p["path"], "rb") as fh:
            data = fh.read()
        stem = re.sub(r"[^A-Za-z0-9._-]+", "-", os.path.splitext(p["file"])[0]).strip("-")
        ext = os.path.splitext(p["file"])[1].lstrip(".") or "jpg"
        res = blob_put(f"colorways/{cid}/flat-{stem}.{ext}", data, ct, token)
        # Flats sort ahead of the model shots.
        sql = ('insert into "MediaAsset" ("id","colorwayId","url","source","role",'
               '"blobPathname","position","mediaType") select gen_random_uuid()::text,'
               f'{q(cid)},{q(res["url"])},\'BLOB\'::"MediaSource",\'FLAT\'::"MediaRole",'
               f'{q(res["pathname"])},-1,\'IMAGE\';')
        r = subprocess.run(["psql", db, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
                           capture_output=True, text=True)
        if r.returncode:
            raise RuntimeError(r.stderr.strip())
        done += 1
        print(f"  {p['colorway']['sku']:30s} <- {p['file']}")
    print(f"\nuploaded {done} flat(s)")


if __name__ == "__main__":
    sys.exit(main())
