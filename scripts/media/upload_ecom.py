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
import argparse, json, mimetypes, os, re, subprocess, sys, time, urllib.error, urllib.parse, urllib.request
from collections import OrderedDict, defaultdict

BLOB_API = "https://blob.vercel-storage.com"


def blob_put(pathname, data, content_type, token, attempts=5):
    """PUT one object, retrying the transient failures.

    Blob returns a 503 often enough over a run of several hundred files that
    one of them ending the whole upload is not acceptable — a crash halfway
    leaves the objects uploaded with no MediaAsset rows pointing at them."""
    # The shoot's filenames contain spaces ("… LIVID71261.jpg"), which are not
    # legal in a request line — quote the path, and Blob stores the decoded name.
    req_url = f"{BLOB_API}/{urllib.parse.quote(pathname)}"
    last = None
    for attempt in range(attempts):
        req = urllib.request.Request(
            req_url, data=data, method="PUT",
            headers={
                "authorization": f"Bearer {token}",
                "x-api-version": "7",
                "x-content-type": content_type,
                "x-add-random-suffix": "1",
                "x-cache-control-max-age": "31536000",
            })
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Blob PUT failed after {attempts} attempts: {last}")


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
    # Only the model shots count. A FLAT uploaded by upload_flats.py is a
    # different job, and counting it would make this script think the gallery
    # was already done.
    sql = ('select "colorwayId", count(*) from "MediaAsset" where role <> \'FLAT\' '
           'and "colorwayId" in (' + ",".join(q(i) for i in ids) + ') group by 1;')
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
    ap.add_argument("--only", help="only this folder name or colorwaySku")
    ap.add_argument("--skus", help="comma-separated colorwaySkus to limit to")
    ap.add_argument("--limit", type=int)
    args = ap.parse_args()

    token = os.environ["BLOB_READ_WRITE_TOKEN"]
    db = os.environ["ORIGO_DATABASE_URL_UNPOOLED"]

    rows = [r for r in json.load(open(args.match)) if r["state"] == "confident"]
    if args.only:
        rows = [r for r in rows if r["folder"] == args.only
                or r["candidates"][0]["sku"] == args.only]
    if args.skus:
        want = set(args.skus.split(","))
        rows = [r for r in rows if r["candidates"][0]["sku"] in want]
    if args.limit:
        rows = rows[: args.limit]

    # One colorway can be spread over several folders — the retouched REST set
    # often names it differently from the original ("MILA BUTTERNUT" vs "MILA
    # BUTTERNUT FADE OUT"). Group by colorway so every folder's files land on
    # the product, rather than the first folder winning and the rest being
    # skipped as "already has media".
    grouped = OrderedDict()
    for r in rows:
        c = r["candidates"][0]
        g = grouped.setdefault(c["id"], {
            "sku": c["sku"], "id": c["id"],
            "label": f"{c['style']} / {c['name']}",
            "folders": [], "by_gender": defaultdict(list)})
        g["folders"].append(r["folder"])
        for gender, files in r["files"].items():
            g["by_gender"][gender].extend(files)

    have = existing_media(db, list(grouped))
    plan, skipped = [], []
    for g in grouped.values():
        if have.get(g["id"]) and not args.replace:
            skipped.append((g["sku"], have[g["id"]]))
            continue
        shot_both = "DAME" in g["by_gender"] and "HERRE" in g["by_gender"]
        # HERRE before DAME so a men's-first gallery reads consistently; REST
        # is the ungendered retouched set and follows.
        items = []
        for gender in ("HERRE", "DAME", "REST"):
            for f in sorted(g["by_gender"].get(gender, []), key=lambda x: x["pos"]):
                if shot_both and args.unisex_roles and gender != "REST":
                    role = "MEN" if gender == "HERRE" else "WOMEN"
                else:
                    role = "GALLERY"
                items.append({**f, "gender": gender, "role": role})
        plan.append({**g, "shot_both": shot_both, "items": items})

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
