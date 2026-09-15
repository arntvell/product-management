#!/usr/bin/env python3
"""Build Shopify fit guide page bodies from Threadflow measurement charts.

One page per style per season, named "<Style> <SEASON> - FitGuide".

The page is a mailto line and a table — nothing else. Per-style fit prose is
deliberately not carried over from earlier seasons.

Row selection is a fixed business rule (docs/fitguides-fw26.md §8):

  tops     Shoulders           Shoulder (across), else Shoulder Width
           Chest (pit-to-pit)  the "pit to pit" row; ONLY if the chart has none,
                               ½ Chest Width
           Bottom Opening      ½ Bottom Width, else ½ Hem
           Front Length        Front Length (from HPS)   (never "from collar")

  bottoms  Waist Thigh Knee Leg Rise Backrise

A style is skipped when a row it needs is absent, or when the row is ungraded —
one value repeated at every size, which means Threadflow's grading_increment is
still 0. Those are a source-side fix, not something to paper over here.

Writes a manifest and a preview; creates nothing. Use push.py to publish.
"""
import argparse, json, os, re, sys, urllib.request

MAILTO = "help@livid.no"
TABLE_WIDTH = 624

# A raglan has no shoulder seam, so no shoulder measurement exists to publish —
# the column is simply left off, as on the existing Abby / Centi / Mila / Tiki
# pages. Shoulders is therefore the one tops column allowed to be absent; the
# other three are always expected, and a chart missing one is a real gap.
OPTIONAL = {"Shoulders"}

TOPS = [
    ("Shoulders",          [r"Shoulder \(across\)", r"Shoulder Width"]),
    ("Chest (pit-to-pit)", [r"½ Width \(pit to pit\)", r"½ Chest Width"]),
    ("Bottom Opening",     [r"½ Bottom Width", r"½ Hem",
                            r"Bottom Width \(measured over the rib\)"]),
    ("Front Length",       [r"Front Length \(from HPS\)"]),
]
# Row names carry a qualifier on some templates — Fir's waist is "½ Waist
# (straight)", the Hayes suitpants' leg opening is "½ Leg Opening (10 cm up)".
# Same measurement, so accept the qualified form as a second choice. The
# waistband variants are deliberately NOT accepted: "½ Waist (Top of WB)" is a
# different measurement, not a differently-worded one.
BOTTOMS = [
    ("Waist",    [r"½ Waist", r"½ Waist \(straight\)"]),
    ("Thigh",    [r"½ Thigh"]),
    ("Knee",     [r"½ Knee.*"]),
    ("Leg",      [r"½ Leg Opening", r"½ Leg Opening \(.*\)"]),
    ("Rise",     [r"Front Rise \(without waistband\)", r"Front Rise.*"]),
    ("Backrise", [r"Back Rise \(without waistband\)", r"Back Rise.*"]),
]
# Skirts and dresses share the Bottom template but have no thigh/knee/rise.
# Columns follow the existing Blanche / Heist / Turnip pages.
SKIRT = [
    ("Waist",          [r"½ Waist"]),
    ("Hip",            [r"½ Hip \(20 ?cm from HPW\)", r"½ Hip.*"]),
    ("Bottom Opening", [r"½ Hem", r"½ Bottom Width"]),
    ("Total Length",   [r"Total Length from HPW to Hem.*", r"Total [Ll]ength.*"]),
]
SKIRT_CATEGORIES = {"Skirt", "Dress"}
# Scarves and the like: no body measurements at all. Columns follow the existing
# Lerke / Hilda pages. Unlike a garment, whichever of these the chart happens to
# carry is the whole table — a scarf with only a length is still a valid page —
# so this set is filtered to what exists rather than being all-or-nothing.
ACCESSORIES = [
    ("Length",     [r"Length", r"Total Length.*"]),
    ("Width",      [r"Width", r"½ Width"]),
    ("Rib height", [r"Rib [Hh]eight"]),
]


def fetch_season(season):
    base = os.environ["THREADFLOW_URL"].strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://" + base
    key = os.environ["THREADFLOW_API_KEY"]
    styles, cursor = [], None
    while True:
        url = (f"{base}/api/external/v1/products?seasonCode={season}"
               f"&includeMeasurements=true&limit=100")
        if cursor:
            url += f"&cursor={cursor}"
        req = urllib.request.Request(url, headers={"X-API-Key": key})
        page = json.load(urllib.request.urlopen(req, timeout=120))
        styles += page["data"]
        cursor = page.get("nextCursor")
        if not cursor:
            return styles


def pick(rows, patterns):
    """First row matching the highest-priority pattern. Order is the rule."""
    for pat in patterns:
        for r in rows:
            if re.fullmatch(pat, r["name"].strip(), re.I):
                return r
    return None


def num(v):
    """JSON numbers carry two decimals of stored precision; 40.0 reads as 40."""
    return str(int(v)) if float(v) == int(v) else f"{v:g}"


def build_table(headers, size_names, grid):
    w = round(TABLE_WIDTH / (len(headers) + 1))
    cell = f'<td style="height: 22px; width: {w}px;">'
    out = [f'<table style="width: {TABLE_WIDTH}px;">', "<thead>",
           '<tr style="height: 22px;">', f"{cell}Size</td>"]
    out += [f"{cell}{h}</td>" for h in headers]
    out += ["</tr>", "</thead>", "<tbody>"]
    for i, size in enumerate(size_names):
        out.append('<tr style="height: 22px;">')
        out.append(f"{cell}{size}</td>")
        out += [f"{cell}{grid[h][i]}</td>" for h in headers]
        out.append("</tr>")
    out += ["</tbody>", "</table>"]
    return "\n".join(out)


def build_body(headers, size_names, grid):
    return (
        "<br>\n"
        f'<p><a href="mailto:{MAILTO}" class="text-sm underline">'
        "Need help with sizing?</a></p>\n"
        "<br>\n"
        + build_table(headers, size_names, grid)
        + "\n<p><br></p>"
    )


def render(style, season):
    """-> (page dict, None) or (None, reason skipped)."""
    mc = style.get("measurement_chart")
    if not mc:
        return None, "no measurement chart"
    rows = [r for r in mc["rows"] if not r["is_title"]]
    # Pick the column set from the chart TEMPLATE and the garment, not from
    # size_system: Agra is a skirt on the Bottom template with alpha sizes
    # (size_system "tops"), and Fir is a suitpant on Bottom with EU sizes.
    # size_system describes the size labels, not the shape of the garment.
    if mc["chart_template_name"] == "Accessories":
        spec = [c for c in ACCESSORIES if pick(rows, c[1]) is not None]
    elif style.get("category") in SKIRT_CATEGORIES:
        spec = SKIRT
    elif mc["chart_template_name"] == "Bottom" or mc["size_system"] == "bottoms":
        spec = BOTTOMS
    else:
        spec = TOPS
    sizes = [z["name"] for z in sorted(mc["sizes"], key=lambda z: z["sort_order"])]

    # For a garment the chart's size range is the spec and is shown as-is, even
    # where it differs from what is sold (ThreadFlow handover §7). A one-size
    # accessory is the exception: its chart often carries the template's whole
    # size run with the same value on every row, which would render as five
    # identical lines. Show only the sizes it is actually sold in.
    if mc["chart_template_name"] == "Accessories":
        sold = {v["dimensions"].get("size")
                for c in style["colorways"] for v in c["variants"]}
        kept = [s for s in sizes if s in sold]
        if kept:
            sizes = kept

    # A one-size accessory has the same length at every size by definition, so
    # the ungraded check below would reject a chart that is perfectly correct.
    graded_required = mc["chart_template_name"] != "Accessories"

    headers, grid, missing, flat, used = [], {}, [], [], {}
    for label, patterns in spec:
        r = pick(rows, patterns)
        if r is None:
            if label not in OPTIONAL:
                missing.append(label)
            continue
        by_size = {v["size_name"]: v["value"] for v in r["values"]}
        values = [by_size.get(s) for s in sizes]
        if any(v is None for v in values):
            missing.append(f"{label} (no value at some size)")
            continue
        # One value at every size means grading_increment is still 0 upstream.
        if graded_required and len(set(values)) == 1:
            flat.append(label)
            continue
        headers.append(label)
        grid[label] = [num(v) for v in values]
        used[label] = r["name"]

    if missing or flat:
        why = []
        if missing:
            why.append("missing: " + ", ".join(missing))
        if flat:
            why.append("ungraded: " + ", ".join(flat))
        return None, "; ".join(why)

    return {
        "style_sku": style["style_sku"],
        "style_name": style["style_name"],
        "style_id": style["style_id"],
        "size_system": mc["size_system"],
        "chart_template": mc["chart_template_name"],
        "style_chart_id": mc["style_chart_id"],
        "title": f"{style['style_name']} {season} - FitGuide",
        "handle": re.sub(r"[^a-z0-9]+", "-",
                         f"{style['style_name']} {season} fitguide".lower()).strip("-"),
        "rows_used": used,
        "sizes": sizes,
        "body": build_body(headers, sizes, grid),
    }, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="FW26")
    ap.add_argument("--out", required=True, help="directory for manifest + preview")
    args = ap.parse_args()

    styles = fetch_season(args.season)
    pages, skipped = [], []
    for s in sorted(styles, key=lambda x: x["style_name"]):
        page, reason = render(s, args.season)
        (pages if page else skipped).append(page or
            {"style_sku": s["style_sku"], "style_name": s["style_name"], "reason": reason})

    os.makedirs(args.out, exist_ok=True)
    man = os.path.join(args.out, f"{args.season.lower()}-fitguides.json")
    json.dump({"season": args.season, "pages": pages, "skipped": skipped},
              open(man, "w"), indent=1, ensure_ascii=False)

    prev = os.path.join(args.out, f"{args.season.lower()}-preview.html")
    with open(prev, "w") as f:
        f.write("<meta charset='utf-8'><style>body{font:14px system-ui;max-width:760px;"
                "margin:2rem auto}table{border-collapse:collapse;margin:1rem 0}"
                "td{border:1px solid #ccc;padding:4px 8px}h2{margin-top:2.5rem}"
                "code{color:#666;font-size:12px}</style>")
        for p in pages:
            f.write(f"<h2>{p['title']}</h2><code>{p['style_sku']} · "
                    f"{p['chart_template']} · {p['size_system']}<br>"
                    + "<br>".join(f"{k} &larr; {v}" for k, v in p["rows_used"].items())
                    + f"</code>{p['body']}")

    print(f"{args.season}: {len(styles)} styles -> {len(pages)} pages, {len(skipped)} skipped")
    print(f"  manifest {man}")
    print(f"  preview  {prev}")
    if skipped:
        print("\n  skipped:")
        for s in skipped:
            print(f"    {s['style_sku']:26s} {s['style_name'][:22]:22s} {s['reason']}")


if __name__ == "__main__":
    sys.exit(main())
