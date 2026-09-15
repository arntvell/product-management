#!/usr/bin/env python3
"""Parse the styling team's RTF look list into structured looks.

One line per garment; exactly one line per look is **bold** — the hero, i.e. the
style whose product page that shot belongs to. Bold is what carries the model
info, so the RTF has to be read as RTF: converting to plain text first loses it.

Two RTF details matter:
  * bold has to be tracked per character. The run ends (\\b0) before the line
    break is emitted, so testing the flag at end-of-line reports every line
    unbolded.
  * lines are broken by \\par, by a backslash-newline, AND by \\u8232
    (U+2028 LINE SEPARATOR), which is what a soft return in TextEdit produces.
    Miss the last one and looks silently merge.
"""
import json, re, sys

BREAKS = {"par", "line"}


def parse(path):
    raw = open(path, encoding="latin-1").read()
    body = raw.split("\\strokec2", 1)[-1]
    out, buf, bold, i = [], [], False, 0

    def flush():
        txt = "".join(c for c, _ in buf).strip()
        if txt:
            out.append((re.sub(r"\s+", " ", txt),
                        any(b for c, b in buf if not c.isspace())))
        buf.clear()

    while i < len(body):
        c = body[i]
        if c == "\\":
            m = re.match(r"\\'([0-9a-fA-F]{2})", body[i:])
            if m:
                buf.append((bytes.fromhex(m.group(1)).decode("latin-1"), bold))
                i += 4
                continue
            m = re.match(r"\\([a-zA-Z]+)(-?\d+)?[ ]?", body[i:])
            if m:
                word, num = m.group(1), m.group(2)
                if word == "b":
                    bold = num != "0"
                elif word in BREAKS:
                    flush()
                elif word == "u" and num in ("8232", "8233"):
                    flush()
                i += m.end()
                continue
            if body[i + 1] in "\\{}":
                buf.append((body[i + 1], bold))
                i += 2
                continue
            if body[i + 1] == "\n":
                flush()
                i += 2
                continue
            i += 1
            continue
        if c in "\n{}":
            i += 1
            continue
        buf.append((c, bold))
        i += 1
    flush()
    return out


def structure(lines, first_block_model, aliases):
    looks, cur, model = [], None, first_block_model
    for txt, bold in lines:
        header = re.match(r"^Looks\s+(.+)$", txt, re.I)
        if header:
            name = header.group(1).strip().upper()
            model = aliases.get(name, name)
            if cur:
                looks.append(cur)
                cur = None
            continue
        if re.match(r"^\d+\s*:?\s*$", txt):
            if cur:
                looks.append(cur)
            cur = {"model": model, "look": int(re.match(r"^(\d+)", txt).group(1)),
                   "items": []}
            continue
        if cur is not None:
            cur["items"].append({"raw": txt, "hero": bold})
    if cur:
        looks.append(cur)
    return looks


if __name__ == "__main__":
    src, dst = sys.argv[1], sys.argv[2]
    lines = parse(src)
    # The file opens with an unlabelled block; ALFRED is the one model of the
    # six that never gets a "Looks <name>" header. "Leonard" is Leo.
    looks = structure(lines, "ALFRED", {"LEONARD": "LEO"})
    json.dump(looks, open(dst, "w"), indent=1, ensure_ascii=False)
    bad = [l for l in looks if sum(1 for i in l["items"] if i["hero"]) != 1]
    from collections import Counter
    print("looks per model:", dict(Counter(l["model"] for l in looks)))
    print(f"looks: {len(looks)}  garment entries: {sum(len(l['items']) for l in looks)}")
    print(f"looks without exactly one hero: {len(bad)}")
    for l in bad:
        print(f"   {l['model']} #{l['look']}: {[i['raw'] for i in l['items']]}")
