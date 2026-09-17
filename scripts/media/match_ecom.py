#!/usr/bin/env python3
"""Match the e-commerce photo delivery to master colorways.

Layout (CONTENT/FW26/ECOMMERCE_MEDIA):

    DAME|HERRE|REST / <STYLE COLOURWAY>[ F|M|2] / <id>_<pos>_<role>_<original>.jpg

`pos` is the gallery order and `role` is one of main | hover | keep | extra-N.

Gender comes from the top folder for DAME/HERRE. REST is the retouched final
selection and is not split by folder — it marks gender with a trailing " F" or
" M" on the product name instead, and " 2" for a second set of the same thing.
A product that ends up with both a women's and a men's source was shot on a
woman and a man: that is the unisex case the push routes to custom.men_images /
custom.women_images.

A folder whose name carries a note rather than a colourway ("… MISSING IMAGES")
is reported, never matched.

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


NOTE_RE = re.compile(r"\b(MISSING|TBC|TODO|NO)\s+IMAGES?\b", re.I)
SUFFIX_RE = re.compile(r"\s+(F|M|\d+)$", re.I)


def split_suffix(name):
    """"UTMOST GREEN PLAID F" -> ("UTMOST GREEN PLAID", "DAME").

    A trailing F or M is the gender of the shot; a trailing number is just a
    second set of the same product and carries no gender."""
    m = SUFFIX_RE.search(name)
    if not m:
        return name, None
    base = name[: m.start()].strip()
    tag = m.group(1).upper()
    return base, {"F": "DAME", "M": "HERRE"}.get(tag)


def scan(root):
    """-> {folder_name: {gender: [ {path,pos,role,file}, ... ] }}"""
    out = defaultdict(lambda: defaultdict(list))
    notes = []
    for top in ("DAME", "HERRE", "REST"):
        gdir = os.path.join(root, top)
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
            if NOTE_RE.search(folder):
                notes.append(os.path.join(top, raw))
                continue
            if top == "REST":
                folder, tagged = split_suffix(folder)
                gender = tagged or "REST"
            else:
                gender = top
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
    return out, notes


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
    folders, notes = scan(root)
    # Folder names a person has settled: confirmed decisions and typos the
    # matcher must not guess at.
    ov_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "overrides.json")
    overrides = {}
    if os.path.exists(ov_path):
        overrides = {norm(k): v for k, v in json.load(open(ov_path)).items()
                     if not k.startswith("_")}
    by_sku = {m["sku"]: m for m in master}

    rows = []
    for folder, by_gender in sorted(folders.items()):
        forced = overrides.get(norm(folder))
        if forced and forced in by_sku:
            cands, state = [by_sku[forced]], "confident"
        else:
            cands, state = match(folder, master)
        # Women's and men's sources, however they were marked.
        womens = "DAME" in by_gender
        mens = "HERRE" in by_gender
        shot_both = womens and mens
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
    if notes:
        print(f"folders skipped — the name is a note, not a colourway: {len(notes)}")
        for n in notes:
            print(f"    {n}")
        print()
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
