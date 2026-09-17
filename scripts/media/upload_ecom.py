#!/usr/bin/env python3
"""Upload the matched e-commerce photos to Vercel Blob and record MediaAssets.

Reads match_ecom.py's output. For each confidently matched folder, uploads its
files to Blob under the same prefix adoptMedia uses (colorways/<id>/...) and
inserts one MediaAsset per file, ordered by the position in the filename so the
shoot's own running order (main, hover, then the keeps) becomes the gallery
order.

Roles. The push routes product media by Style.unisex:
    non-unisex -> GALLERY becomes the product gallery
    unisex     -> FLAT becomes the gallery; MEN/WOMEN become
                  custom.men_images / custom.women_images
Six products were shot on both a woman and a man, but none of them is flagged
unisex in the master. Tagging those MEN/WOMEN today would leave them with no
gallery at all, so they default to GALLERY (HERRE first, then DAME) and are
listed for a decision. --unisex-roles switches them to MEN/WOMEN for when the
flag and the flat-lays are in place.

Uploads nothing without --apply. Re-running is safe: a colorway that already has
MediaAsset rows is skipped unless --replace is given.
"""
import argparse, json, mimetypes, os, re, subprocess, sys, urllib.parse, urllib.request
from collections import defaultdict

BLOB_API = "https://blob.vercel-storage.com"


def blob_put(pathname, data, content_type, token):
    # The shoot's filenames contain spaces ("… LIVID71261.jpg"), which are not
    # legal in a request line — quote the path, and Blob stores the decoded name.
    req = urllib.request.Request(
        f"{BLOB_API}/{urllib.parse.quote(pathname)}", data=data, method="PUT",
        headers={
            "authorization": f"Bearer {token}",
            "x-api-version": "7",
            "x-content-type": content_type,
            "x-add-random-suffix": "1",
            "x-cache-control-max-age": "31536000",
        })
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def psql(sql, db):
    p = subprocess.run(["psql", db, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
                       capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(p.stderr.strip())
    return p.stdout


def q(v):
    return "'" + v.replace("'", "''") + "'"


def existing_media(db, ids):
    if not ids:
        return {}
    sql = ('select "colorwayId", count(*) from "MediaAsset" where "colorwayId" in ('
           + ",".join(q(i) for i in ids) + ') group by 1;')
    p = subprocess.run(["psql", db, "-t", "-A", "-F", "\t", "-c", sql],
                       capture_output=True, text=True)
    return {l.split("\t")[0]: int(l.split("\t")[1])
            for l in p.stdout.strip().split("\n") if l.strip()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="upload even where the colorway already has media")
    ap.add_argument("--unisex-roles", action="store_true",
                    help="tag shot-both products MEN/WOMEN instead of GALLERY")
    ap.add_argument("--only", help="only this folder name (for a trial run)")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    db = os.environ["ORIGO_DATABASE_URL_UNPOOLED"]

    rows = [r for r in json.load(open(args.match)) if r["state"] == "confident"]
    if args.only:
        rows = [r for r in rows if r["folder"] == args.only]
    if args.limit:
        rows = rows[: args.limit]

    have = existing_media(db, [r["candidates"][0]["id"] for r in rows])
    plan, skipped = [], []
    for r in rows:
        c = r["candidates"][0]
        if have.get(c["id"]) and not args.replace:
            skipped.append((c["sku"], have[c["id"]]))
            continue
        # HERRE before DAME so a men's-first gallery reads consistently.
        items = []
        for gender in ("HERRE", "DAME"):
            for f in r["files"].get(gender, []):
                if r["shot_both"] and args.unisex_roles:
                    role = "MEN" if gender == "HERRE" else "WOMEN"
                else:
                    role = "GALLERY"
                items.append({**f, "gender": gender, "role": role})
        plan.append({"sku": c["sku"], "id": c["id"],
                     "label": f"{c['style']} / {c['name']}",
                     "shot_both": r["shot_both"], "items": items})

    total = sum(len(p["items"]) for p in plan)
    print(f"colorways: {len(plan)}   files: {total}   "
          f"skipped (already have media): {len(skipped)}")
    if skipped:
        for s, n in skipped[:8]:
            print(f"    {s} already has {n}")
    if not args.apply:
        for p in plan[:6]:
            roles = defaultdict(int)
            for i in p["items"]:
                roles[i["role"]] += 1
            print(f"  {p['sku']:30s} {len(p['items']):3d} files  {dict(roles)}"
                  f"{'  [shot both]' if p['shot_both'] else ''}")
        if len(plan) > 6:
            print(f"  … and {len(plan)-6} more")
        print("\nDry run — nothing uploaded. Re-run with --apply.")
        return

    done = 0
    for p in plan:
        values = []
        for pos, it in enumerate(p["items"]):
            ct = mimetypes.guess_type(it["path"])[0] or "image/jpeg"
            ext = os.path.splitext(it["path"])[1].lstrip(".") or "jpg"
            with open(it["path"], "rb") as fh:
                data = fh.read()
            stem = re.sub(r"[^A-Za-z0-9._-]+", "-",
                          it["file"].rsplit(".", 1)[0]).strip("-")
            res = blob_put(f"colorways/{p['id']}/{stem}.{ext}", data, ct, token)
            values.append(
                f"({q(p['id'])}, {q(res['url'])}, 'BLOB', {q(it['role'])}, "
                f"{q(res['pathname'])}, {pos}, 'IMAGE')")
            done += 1
        psql('insert into "MediaAsset" ("id","colorwayId","url","source","role",'
             '"blobPathname","position","mediaType") select gen_random_uuid()::text, '
             'v.a, v.b, v.c::"MediaSource", v.d::"MediaRole", v.e, v.f, v.g '
             'from (values ' + ",".join(values) +
             ') as v(a,b,c,d,e,f,g);', db)
        print(f"  {p['sku']:30s} {len(p['items']):3d} uploaded")
    print(f"\nuploaded {done} file(s) across {len(plan)} colorway(s)")


if __name__ == "__main__":
    sys.exit(main())
