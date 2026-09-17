#!/usr/bin/env python3
"""Match the e-commerce photo delivery to master colorways.

Layout (CONTENT/FW26/ECOMMERCE_MEDIA):

    DAME|HERRE / <STYLE COLOURWAY> / <id>_<pos>_<role>_<original>.jpg

`pos` is the gallery order and `role` is one of main | hover | keep | extra-N.
A product folder appearing under BOTH DAME and HERRE was shot on a woman and a
man — that is the unisex case the push routes to custom.men_images /
custom.women_images.

Reports confident / ambiguous / unmatched rather than guessing: a photo on the
wrong product page is worse than a product with no photo, and nothing
downstream would catch it.
"""
import csv, json, os, re, sys, unicodedata
from collections import defaultdict

FILE_RE = re.compile(r"^(\d+)_(\d+)_([a-z0-9-]+)_(.+)$", re.I)

# Shoot spelling -> master spelling. Only genuine variants, not guesses.
ALIAS = {
    "coffe": "coffee", "porclain": "porcelain", "directorie": "directory",
    "viole": "voile", "paid": "plaid", "ckeck": "check",
    "thermsl": "thermal",
}
# Words that carry no identity and only get in the way of matching.
NOISE = {"the", "and"}


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", " ", s.lower())
    out = []
    for t in s.split():
        if t in NOISE:
            continue
        out.extend(ALIAS.get(t, t).split())
    return " ".join(out)


def load_master(path):
    rows = []
    for r in csv.reader(open(path), delimiter="\t"):
        if len(r) < 8:
            continue
        rows.append({
            "id": r[0], "sku": r[1], "style": r[2], "name": r[3],
            "unisex": r[4] == "t", "gender": r[5], "category": r[6],
            "media": int(r[7]),
            "full": norm(f"{r[2]} {r[3]}"),
        })
    for m in rows:
        m["toks"] = set(m["full"].split())
    return rows


def scan(root):
    """-> {folder_name: {gender: [ {path,pos,role,file}, ... ] }}"""
    out = defaultdict(lambda: defaultdict(list))
    for gender in ("DAME", "HERRE"):
        gdir = os.path.join(root, gender)
        if not os.path.isdir(gdir):
            continue
        for raw in sorted(os.listdir(gdir)):
            fdir = os.path.join(gdir, raw)
            if not os.path.isdir(fdir):
                continue
            # Trim: "PULL BLACK " (DAME) and "PULL BLACK" (HERRE) are the same
            # product shot twice. Untrimmed they read as two products and the
            # unisex pair is missed — the same whitespace trap the Threadflow
            # client documents on SKUs.
            folder = raw.strip()
            for fn in sorted(os.listdir(fdir)):
                if fn.startswith("."):
                    continue
                m = FILE_RE.match(fn)
                if not m:
                    out[folder][gender].append(
                        {"path": os.path.join(fdir, fn), "pos": 999,
                         "role": "unparsed", "file": fn})
                    continue
                out[folder][gender].append({
                    "path": os.path.join(fdir, fn),
                    "pos": int(m.group(2)),
                    "role": m.group(3).lower(),
                    "file": fn,
                })
    for f in out:
        for g in out[f]:
            out[f][g].sort(key=lambda x: x["pos"])
    return out


def match(folder, master):
    q = norm(folder)
    qt = set(q.split())
    exact = [m for m in master if m["full"] == q]
    if exact:
        return exact, "confident"
    # The folder name is the shoot's wording; every word of it should appear in
    # the master's style+colourway.
    sub = [m for m in master if qt and qt <= m["toks"]]
    if len(sub) == 1:
        return sub, "confident"
    if len(sub) > 1:
        by_extra = defaultdict(list)
        for m in sub:
            by_extra[len(m["toks"] - qt)].append(m)
        fewest = by_extra[min(by_extra)]
        return (fewest, "confident") if len(fewest) == 1 else (sub, "ambiguous")
    # Nothing contains every word — fall back to overlap, for the report only.
    scored = []
    for m in master:
        inter = len(qt & m["toks"])
        if inter:
            scored.append((inter / len(qt | m["toks"]), m))
    scored.sort(key=lambda x: -x[0])
    return [m for _, m in scored[:4]], "unmatched"


def main():
    root, master_tsv, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
    master = load_master(master_tsv)
    folders = scan(root)

    rows = []
    for folder, by_gender in sorted(folders.items()):
        cands, state = match(folder, master)
        shot_both = len(by_gender) > 1
        rows.append({
            "folder": folder,
            "genders": sorted(by_gender),
            "shot_both": shot_both,
            "state": state,
            "files": {g: by_gender[g] for g in by_gender},
            "n_files": sum(len(v) for v in by_gender.values()),
            "candidates": [{k: c[k] for k in
                            ("id", "sku", "style", "name", "unisex", "category", "media")}
                           for c in cands],
        })
    json.dump(rows, open(out_path, "w"), indent=1, ensure_ascii=False)

    from collections import Counter
    c = Counter(r["state"] for r in rows)
    print(f"photo folders: {len(rows)}   files: {sum(r['n_files'] for r in rows)}")
    print(f"  {dict(c)}")
    print(f"  shot on both DAME and HERRE: {sum(1 for r in rows if r['shot_both'])}")

    bad = [r for r in rows if r["state"] != "confident"]
    if bad:
        print("\nneeds a decision:")
        for r in bad:
            print(f"  {r['folder']:38s} [{r['state']}]")
            for c_ in r["candidates"][:4]:
                print(f"       {c_['style']} / {c_['name']}  ({c_['sku']})")

    # A master colorway matched by two different folders is a real problem.
    seen = defaultdict(list)
    for r in rows:
        if r["state"] == "confident":
            seen[r["candidates"][0]["sku"]].append(r["folder"])
    dup = {k: v for k, v in seen.items() if len(v) > 1}
    if dup:
        print("\nsame master colorway matched by more than one folder:")
        for k, v in dup.items():
            print(f"  {k}: {v}")


if __name__ == "__main__":
    main()
