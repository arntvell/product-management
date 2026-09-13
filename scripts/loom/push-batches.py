#!/usr/bin/env python3
"""Push a large colorway set to Loom in batches, one job at a time.

The route caps at 300 s and a 900-variant batch runs ~2-4 minutes, so a full
catalogue push has to be split. Batches are a JSON array of arrays of colorway ids.

    python3 scripts/loom/push-batches.py batches.json --season CONTINUITY
    python3 scripts/loom/push-batches.py batches.json --only 7 --event-id retry-1

Two things learned the hard way on 2026-09-13, both encoded here:

1. READ THE ERROR BODY. Our route answers 502 whenever Loom's job comes back
   `ok: false`, and the body carries the reason — including Loom's per-item
   errors. The first version of this script caught HTTPError and logged only
   "HTTP Error 502: Bad Gateway", which sent me looking for a gateway problem
   when Loom had actually named the offending product in one line.

2. A RETRY NEEDS A NEW EVENT ID. The delivery id is derived from the contents, so
   resending the same set carries the same id and Loom returns `deduped: true`
   with the ORIGINAL job — including its original failure. Correct after a
   connection drop, useless when you want the work re-attempted. --event-id
   overrides it.
"""
import argparse, json, sys, time, urllib.error, urllib.request


def post(url, payload, timeout=900):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as x:
            return json.loads(x.read().decode()), None
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:2000]
        try:
            return json.loads(body), e.code
        except Exception:
            return {"raw": body}, e.code


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("batches")
    ap.add_argument("--season", default="CONTINUITY")
    ap.add_argument("--mode", default="data", choices=["data", "full"])
    ap.add_argument("--base-url", default="http://localhost:3000")
    ap.add_argument("--only", type=int, help="run a single 1-based batch")
    ap.add_argument("--event-id", help="override the delivery id (needed to re-attempt)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--stop-after", type=int, default=3, help="give up after N failures")
    a = ap.parse_args()

    batches = json.load(open(a.batches))
    if a.only:
        batches = [batches[a.only - 1]]
    url = f"{a.base_url}/api/catalog/push/loom"
    tot = {"sent": 0, "created": 0, "updated": 0, "errors": 0}

    print(f"{len(batches)} batch(es), {sum(len(b) for b in batches)} colorways -> season {a.season}")
    for i, b in enumerate(batches, 1):
        payload = {
            "colorwayIds": b,
            "seasonCode": a.season,
            "mode": a.mode,
            "dryRun": a.dry_run,
        }
        if a.event_id:
            payload["eventId"] = f"{a.event_id}-{i}" if len(batches) > 1 else a.event_id
        t0 = time.time()
        r, code = post(url, payload)
        j = r.get("job") or {}
        took = time.time() - t0
        if code:
            tot["errors"] += 1
            print(f"batch {i:>2}  HTTP {code} after {took:.0f}s  job={r.get('jobId')} "
                  f"status={j.get('status')} created={j.get('created')} updated={j.get('updated')}")
            if r.get("raw"):
                print(f"    loom said: {str(r['raw'])[:300]}")
            for ie in (j.get("itemErrors") or [])[:10]:
                print(f"    itemError: {ie}")
            if tot["errors"] >= a.stop_after:
                print("*** too many failures, stopping ***")
                break
            continue
        tot["sent"] += r.get("sent") or 0
        for k in ("created", "updated"):
            tot[k] += j.get(k) or 0
        print(f"batch {i:>2}  ok sent={r.get('sent')} created={j.get('created')} "
              f"updated={j.get('updated')} status={j.get('status')} {took:.0f}s job={r.get('jobId')}")
    print(f"\nTOTAL sent={tot['sent']} created={tot['created']} updated={tot['updated']} "
          f"errors={tot['errors']}")
    return 1 if tot["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
