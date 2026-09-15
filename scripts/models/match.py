#!/usr/bin/env python3
"""Match the styling list's hero garments to master colorways and variants.

Each look names garments as "<style> <colourway> <size>" in the styling team's
shorthand, which is not the master's wording: sizes are appended, words are
abbreviated ("Hayes Grey 32/34"), and there are typos.

The output is deliberately three-way — confident / ambiguous / unmatched —
rather than a best guess per row. A wrong model-info line is worse than a
missing one: "Model is 189cm and wears 32/34" against the wrong garment is
silently misleading on a product page, and nothing downstream would catch it.
"""
import csv, json, re, sys, unicodedata
from collections import defaultdict

# Typos and shorthand in the styling list, mapped to the master's spelling.
TYPO = {
    "ckeck": "check", "delibrate": "deliberate", "athoi": "atohi",
    "porcalain": "porcelain", "singel": "single", "brested": "breasted",
    "westernshirt": "western shirt", "doble": "double", "coffe": "coffee",
    "vince": "vinc", "paige": "page", "washout": "wash out",
    "terminal": "thermal",
}

SIZE_RE = re.compile(
    r"\s+((?:W?\d{2}\s*/\s*L?\d{2})|(?:XS|S|M|L|XL|XXL|2XL|3XL)|(?:3[0-9]|4[0-2]))$",
    re.I)


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower())
    out = []
    for t in s.split():
        out.extend(TYPO.get(t, t).split())
    return " ".join(out)


def split_size(raw):
    m = SIZE_RE.search(raw.strip())
    if m:
        return raw[:m.start()].strip(), re.sub(r"\s+", "", m.group(1))
    return raw.strip(), None


def load_master(path):
    rows = []
    for r in csv.reader(open(path), delimiter="\t"):
        if len(r) < 7:
            continue
        rows.append({
            "id": r[0], "sku": r[1], "style": r[2], "name": r[3], "cat": r[4],
            "sizes": [x for x in r[5].split(",") if x],
            "seasons": [x for x in r[6].split(",") if x],
            "full": norm(f"{r[2]} {r[3]}"),
        })
    for m in rows:
        m["toks"] = set(m["full"].split())
    return rows


def candidates(query, master, season):
    """Every colorway the query could plausibly name, narrowed as far as the
    evidence allows — never past it."""
    q = norm(query)
    qt = set(q.split())

    exact = [m for m in master if m["full"] == q]
    if exact:
        pool = exact
    else:
        # The styling name is shorthand, so its words should all appear in the
        # master's — not the other way round.
        pool = [m for m in master if qt and qt <= m["toks"]]
    if not pool:
        return [], "none"

    # A look belongs to a season; prefer that season when it decides anything.
    in_season = [m for m in pool if season in m["seasons"]]
    if in_season:
        pool = in_season

    if len(pool) == 1:
        return pool, "confident"

    # Several left: if exactly one has the fewest extra words, it is the closest
    # reading of the shorthand; otherwise this needs a human.
    by_extra = defaultdict(list)
    for m in pool:
        by_extra[len(m["toks"] - qt)].append(m)
    fewest = by_extra[min(by_extra)]
    if len(fewest) == 1:
        return fewest, "confident"
    return sorted(pool, key=lambda m: len(m["toks"] - qt)), "ambiguous"


def fuzzy(query, master, season, limit=4):
    qt = set(norm(query).split())
    scored = []
    for m in master:
        inter = len(qt & m["toks"])
        if not inter:
            continue
        s = inter / len(qt | m["toks"]) + (0.05 if season in m["seasons"] else 0)
        scored.append((s, m))
    scored.sort(key=lambda x: -x[0])
    return [m for _, m in scored[:limit]]


def main():
    looks = json.load(open(sys.argv[1]))
    master = load_master(sys.argv[2])
    season = sys.argv[3]
    out = []
    for look in looks:
        for item in look["items"]:
            if not item["hero"]:
                continue
            name, size = split_size(item["raw"])
            cands, state = candidates(name, master, season)
            if state == "none":
                cands, state = fuzzy(name, master, season), "unmatched"
            rec = {
                "model": look["model"], "look": look["look"], "raw": item["raw"],
                "query": name, "size": size, "state": state,
                "candidates": [{k: c[k] for k in
                                ("id", "sku", "style", "name", "cat", "sizes", "seasons")}
                               for c in cands],
            }
            if state == "confident":
                c = cands[0]
                rec["size_on_variant"] = size is not None and any(
                    size.upper() == s.upper().replace("W", "").replace("L", "")
                    or size.upper() == s.upper() for s in c["sizes"])
            out.append(rec)
    json.dump(out, open(sys.argv[4], "w"), indent=1, ensure_ascii=False)
    from collections import Counter
    print(Counter(r["state"] for r in out))
    return out


if __name__ == "__main__":
    main()
