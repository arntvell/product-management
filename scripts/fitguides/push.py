#!/usr/bin/env python3
"""Create fit guide pages on Shopify and link them to the season's colorways.

Reads the manifest from generate.py. Dry run unless --apply is passed.

Two steps per style:
  1. pageCreate (or pageUpdate when a page with that handle already exists, so
     a re-run corrects rather than duplicates).
  2. Colorway.fitguidePageId = the page GID, for every colorway of that style
     in the season. A page is per style; the metafield is per colorway, so one
     page fans out. Styles are matched on Style.threadflowId.

The existing Shopify push (src/lib/master/push-shopify.ts) already sends
fitguidePageId as a page_reference, so nothing else is needed to get the link
onto the product.
"""
import argparse, json, os, sys, urllib.request

API_VERSION = "2025-10"  # matches src/lib/shopify/client.ts

PAGE_BY_HANDLE = """
query($q: String!) { pages(first: 5, query: $q) { nodes { id title handle } } }
"""
PAGE_CREATE = """
mutation($page: PageCreateInput!) {
  pageCreate(page: $page) {
    page { id title handle }
    userErrors { field message }
  }
}
"""
PAGE_UPDATE = """
mutation($id: ID!, $page: PageUpdateInput!) {
  pageUpdate(id: $id, page: $page) {
    page { id title handle }
    userErrors { field message }
  }
}
"""


def gql(query, variables=None):
    store = os.environ["SHOPIFY_STORE_URL"].replace("https://", "").replace("http://", "").strip("/")
    token = os.environ["SHOPIFY_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://{store}/admin/api/{API_VERSION}/graphql.json",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
    )
    out = json.load(urllib.request.urlopen(req, timeout=90))
    if "errors" in out:
        raise RuntimeError(out["errors"])
    return out["data"]


def find_page(handle):
    nodes = gql(PAGE_BY_HANDLE, {"q": f"handle:{handle}"})["pages"]["nodes"]
    return next((n for n in nodes if n["handle"] == handle), None)


def upsert(page, publish):
    """-> (gid, 'created'|'updated')"""
    existing = find_page(page["handle"])
    body = {"title": page["title"], "body": page["body"]}
    if existing:
        res = gql(PAGE_UPDATE, {"id": existing["id"], "page": body})["pageUpdate"]
        action = "updated"
    else:
        body["handle"] = page["handle"]
        body["isPublished"] = publish
        res = gql(PAGE_CREATE, {"page": body})["pageCreate"]
        action = "created"
    if res["userErrors"]:
        raise RuntimeError(f"{page['title']}: {res['userErrors']}")
    return res["page"]["id"], action


def link_sql(season, pairs):
    """UPDATE statements setting fitguidePageId on the season's colorways."""
    out = []
    for style_id, gid in pairs:
        out.append(
            'UPDATE "Colorway" c SET "fitguidePageId" = {gid}, "updatedAt" = now() '
            'FROM "Style" st, "SeasonEntry" se, "Season" s '
            'WHERE c."styleId" = st.id AND se."colorwayId" = c.id '
            'AND s.id = se."seasonId" AND s.code = {season} '
            'AND st."threadflowId" = {sid} AND NOT c.archived;'.format(
                gid=quote(gid), season=quote(season), sid=quote(style_id))
        )
    return "\n".join(out)


def quote(v):
    return "'" + v.replace("'", "''") + "'"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--apply", action="store_true", help="actually write to Shopify")
    ap.add_argument("--publish", action="store_true",
                    help="create pages published (default: unpublished drafts)")
    ap.add_argument("--sql-out", help="write the colorway-linking SQL here")
    ap.add_argument("--limit", type=int, help="only the first N pages (for a trial run)")
    args = ap.parse_args()

    man = json.load(open(args.manifest))
    pages = man["pages"][: args.limit] if args.limit else man["pages"]
    season = man["season"]

    print(f"{season}: {len(pages)} page(s), "
          f"{'PUBLISHED' if args.publish else 'unpublished draft'}, "
          f"{'APPLY' if args.apply else 'DRY RUN'}\n")

    pairs = []
    for p in pages:
        if not args.apply:
            existing = find_page(p["handle"])
            state = f"would update {existing['id']}" if existing else "would create"
            print(f"  {p['title']:42s} {state}")
            continue
        gid, action = upsert(p, args.publish)
        pairs.append((p["style_id"], gid))
        print(f"  {p['title']:42s} {action} {gid}")

    if pairs and args.sql_out:
        with open(args.sql_out, "w") as f:
            f.write(link_sql(season, pairs) + "\n")
        print(f"\nlinking SQL -> {args.sql_out}")
    elif not args.apply:
        print("\nDry run — nothing written. Re-run with --apply to create.")


if __name__ == "__main__":
    sys.exit(main())
