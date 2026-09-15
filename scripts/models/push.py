#!/usr/bin/env python3
"""Create the model metaobjects on Shopify and link them to colorways.

A metaobject is one model AT one size ("Alfred - M", "Angelika - W26/L34"),
which is the convention the existing rows already use — a model wears S on top
and 26/34 in jeans, so height alone cannot carry it. push-shopify.ts renders it
as "Model is <height> tall and wearing a size <size>".

Heights are written with the unit, so the sentence reads "Model is 188cm tall".
The rows created before this script omitted it and read "Model is 188 tall";
an existing row that is reused gets its height corrected to match.

Where one colorway is heroed by several models, the first look in the styling
document wins and the rest are reported — the metafield holds one reference,
so that is a merchandising decision, not something to resolve here.

Dry run unless --apply.
"""
import argparse, json, os, sys, urllib.request
from collections import OrderedDict

API = "2025-10"
TYPE = "model"

LIST_Q = """
{ metaobjects(type: "model", first: 250) { nodes { id handle fields { key value } } } }
"""
CREATE = """
mutation($m: MetaobjectCreateInput!) {
  metaobjectCreate(metaobject: $m) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""
UPDATE = """
mutation($id: ID!, $m: MetaobjectUpdateInput!) {
  metaobjectUpdate(id: $id, metaobject: $m) {
    metaobject { id handle }
    userErrors { field message code }
  }
}
"""


def gql(query, variables=None):
    store = os.environ["SHOPIFY_STORE_URL"].replace("https://", "").replace("http://", "").strip("/")
    req = urllib.request.Request(
        f"https://{store}/admin/api/{API}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"X-Shopify-Access-Token": os.environ["SHOPIFY_ACCESS_TOKEN"],
                 "Content-Type": "application/json"},
    )
    out = json.load(urllib.request.urlopen(req, timeout=90))
    if "errors" in out:
        raise RuntimeError(out["errors"])
    return out["data"]


def existing_models():
    by_name = {}
    for n in gql(LIST_Q)["metaobjects"]["nodes"]:
        f = {x["key"]: x["value"] for x in n["fields"]}
        if f.get("name"):
            by_name[f["name"].strip().lower()] = {"id": n["id"], **f}
    return by_name


def sql_quote(v):
    return "'" + v.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resolved", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--sql-out")
    args = ap.parse_args()

    data = json.load(open(args.resolved))
    ready, pairs = data["ready"], data["pairs"]

    have = existing_models() if args.apply or True else {}
    print(f"model metaobjects on Shopify: {len(have)}\n")

    gids = {}
    for p in pairs:
        label = f"{p['model']} - {p['size']}"
        height = p["height"] if p["height"].lower().endswith("cm") else p["height"] + "cm"
        found = have.get(label.lower())
        fields = [{"key": "name", "value": label},
                  {"key": "height", "value": height},
                  {"key": "size_worn", "value": p["size"]}]
        if not args.apply:
            print(f"  {label:22s} {'would update (height ' + found['height'] + ' -> ' + height + ')' if found else 'would create'}")
            continue
        if found:
            if found.get("height") != height:
                gql(UPDATE, {"id": found["id"], "m": {"fields": fields}})
                print(f"  {label:22s} updated  {found['id']}")
            else:
                print(f"  {label:22s} reused   {found['id']}")
            gids[label] = found["id"]
        else:
            r = gql(CREATE, {"m": {"type": TYPE, "fields": fields}})["metaobjectCreate"]
            if r["userErrors"]:
                raise RuntimeError(f"{label}: {r['userErrors']}")
            gids[label] = r["metaobject"]["id"]
            print(f"  {label:22s} created  {gids[label]}")

    # One row per colorway: first look in document order wins.
    chosen, clashes = OrderedDict(), {}
    for r in ready:
        key = r["colorway_id"]
        label = f"{r['model_name']} - {r['size']}"
        if key in chosen:
            if chosen[key]["label"] != label:
                clashes.setdefault(key, [chosen[key]]).append(
                    {"label": label, "look": r["look"], "raw": r["raw"], "sku": r["sku"]})
            continue
        chosen[key] = {"label": label, "look": r["look"], "raw": r["raw"],
                       "sku": r["sku"], "name": r["label"]}

    print(f"\ncolorways to link: {len(chosen)}   of which contested: {len(clashes)}")

    if args.apply and args.sql_out:
        lines = []
        for cid, c in chosen.items():
            gid = gids[c["label"]]
            lines.append(
                f'UPDATE "Colorway" SET "modelInfoId" = {sql_quote(gid)}, '
                f'"updatedAt" = now() WHERE id = {sql_quote(cid)};')
        open(args.sql_out, "w").write("\n".join(lines) + "\n")
        print(f"linking SQL -> {args.sql_out}")

    json.dump({"chosen": [{"colorway_id": k, **v} for k, v in chosen.items()],
               "clashes": {k: v for k, v in clashes.items()}},
              open(args.resolved.replace(".json", "-links.json"), "w"),
              indent=1, ensure_ascii=False)
    if not args.apply:
        print("\nDry run — nothing written.")


if __name__ == "__main__":
    sys.exit(main())
