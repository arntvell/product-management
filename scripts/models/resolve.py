#!/usr/bin/env python3
"""Turn matched heroes into (colorway, model, size-worn) rows ready to link.

Normalises the styling list's size against the colorway's actual variants —
the list says "S" where the garment is sized "XS/S", and omits the size for
one-size pieces. Anything that cannot be resolved is reported, never guessed.
"""
import json, re, sys
from collections import OrderedDict


def norm_size(stated, variant_sizes):
    """-> (size_to_publish, note) or (None, reason)."""
    if not variant_sizes:
        return None, "colorway has no variants"

    if stated is None:
        uniq = set(variant_sizes)
        if len(uniq) == 1:                      # one-size piece: nothing to state
            return variant_sizes[0], "one size"
        return None, "no size given and the garment has several"

    s = stated.upper().replace(" ", "")

    # Exact, then the two-dimensional forms: "30/34" against "W30/L34".
    for v in variant_sizes:
        if v.upper() == s:
            return v, "exact"
    flat = lambda x: re.sub(r"[WL]", "", x.upper())
    for v in variant_sizes:
        if flat(v) == flat(s):
            return v, "waist/length"

    # Combined alpha sizes: a listed "S" is the "XS/S" variant.
    for v in variant_sizes:
        if s in [p.strip() for p in v.upper().split("/")]:
            return v, f"combined size {v}"
    return None, f"size {stated} is not a variant ({','.join(variant_sizes)})"


def main():
    matched = json.load(open(sys.argv[1]))
    models = {}
    for line in open(sys.argv[2]):
        f = line.rstrip("\n").split("\t")
        if f[0] == "name" or not f[0]:
            continue
        models[f[0].upper()] = {"name": f[0].title(), "height": f[1]}

    ready, review = [], []
    for r in matched:
        if r["state"] != "confident":
            # Only a hero that cannot be matched is worth reporting; a
            # supporting garment that does not resolve costs nothing, because
            # the product it belongs to gets its model info from its own look.
            if r.get("hero"):
                review.append({**r, "reason": r["state"]})
            continue
        c = r["candidates"][0]
        size, note = norm_size(r["size"], c["sizes"])
        if size is None:
            if r.get("hero"):
                review.append({**r, "reason": note})
            continue
        m = models.get(r["model"])
        if not m:
            review.append({**r, "reason": f"unknown model {r['model']}"})
            continue
        ready.append({
            "model": r["model"], "model_name": m["name"], "height": m["height"],
            "look": r["look"], "raw": r["raw"], "hero": bool(r.get("hero")),
            "colorway_id": c["id"], "sku": c["sku"],
            "label": f"{c['style']} / {c['name']}",
            "size": size, "size_note": note,
        })

    # One metaobject per model+size, which is how the existing ones are keyed.
    pairs = OrderedDict()
    for r in ready:
        pairs.setdefault((r["model_name"], r["size"]),
                         {"model": r["model_name"], "height": r["height"],
                          "size": r["size"], "uses": 0})["uses"] += 1

    json.dump({"ready": ready, "review": review, "pairs": list(pairs.values())},
              open(sys.argv[3], "w"), indent=1, ensure_ascii=False)

    # A colorway worn by more than one model+size has to be settled by a person.
    by_cw = {}
    for r in ready:
        by_cw.setdefault(r["colorway_id"], set()).add((r["model_name"], r["size"]))
    clash = {k: v for k, v in by_cw.items() if len(v) > 1}
    print(f"ready: {len(ready)}   needs review: {len(review)}")
    print(f"distinct model+size metaobjects needed: {len(pairs)}")
    print(f"colorways worn by more than one model+size: {len(clash)}")
    return clash


if __name__ == "__main__":
    clash = main()
    for k, v in list(clash.items())[:10]:
        print("   ", k, sorted(v))
