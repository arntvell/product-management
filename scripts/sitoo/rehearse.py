#!/usr/bin/env python3
"""Rehearse a Sitoo barcode push against the sandbox before running it live.

Written after 13 Barnes Japan Dawn products disappeared from production Sitoo
during a push on 2026-09-12. The API semantics had been checked in the sandbox
but the *write pattern* had not, and that is the gap this closes: it reproduces
the shape of a real run — how many families are touched, how many writes land in
the heaviest one, no delay between calls — and then verifies nothing was lost.

    SITOO_SBAPI_ID / SITOO_SBAPI_KEY / SITOO_SBBASE_URL must be set.
    python3 scripts/sitoo/rehearse.py

Checks, in order of what actually matters:
    product count unchanged
    no variant family changed size
    every barcode written landed
"""
import os,base64,json,urllib.request,time
from collections import defaultdict
base=os.environ["SITOO_SBBASE_URL"].rstrip("/")
auth=base64.b64encode(f'{os.environ["SITOO_SBAPI_ID"]}:{os.environ["SITOO_SBAPI_KEY"]}'.encode()).decode()
H={"Authorization":"Basic "+auth,"Content-Type":"application/json"}
def call(p,m="GET",b=None):
    r=urllib.request.Request(base+p,headers=H,method=m,data=json.dumps(b).encode() if b is not None else None)
    try:
        with urllib.request.urlopen(r) as x:
            t=x.read().decode(); return x.status,(json.loads(t) if t.strip() else None)
    except urllib.error.HTTPError as e: return e.code,e.read().decode()[:160]
def snapshot():
    out=[]
    for s in range(0,5000,1000):
        _,d=call(f"/sites/1/products?start={s}&num=1000"); it=d.get("items",[]); out+=it
        if len(it)<1000: break
    return out
def cd(d12):
    return str((10-sum(int(c)*(1 if i%2==0 else 3) for i,c in enumerate(d12))%10)%10)
def ean(n):
    b="7072536"+str(n).zfill(5); return b+cd(b)

before=snapshot()
fam=defaultdict(list)
for p in before:
    if p.get("variantparentid"): fam[p["variantparentid"]].append(p)
sizes_before={k:len(v) for k,v in fam.items()}
taken={p.get("barcode") for p in before if p.get("barcode")}
print(f"sandbox BEFORE: {len(before)} products, {len(fam)} families")

# mirror production: 8 families, one of them taking 15 writes
shape=[(174,15),(41,5),(150,3),(288,2),(337,2),(224,1),(268,1)]
seq=90000; writes=[]
for parent,n in shape:
    kids=sorted(fam.get(parent,[]),key=lambda p:p["productid"])[:n]
    for k in kids:
        while ean(seq) in taken: seq+=1
        writes.append((k["productid"],k.get("sku"),k.get("barcode"),ean(seq))); taken.add(ean(seq)); seq+=1
print(f"planned rehearsal writes: {len(writes)} across {len({p for p,_ in shape})} families")
print(f"   heaviest family: parent 174 with {sizes_before.get(174)} children, writing {shape[0][1]}\n")

t0=time.time()
fails=[]
for pid,sku,frm,to in writes:          # NO delay — exactly as the production push runs
    st,resp=call(f"/sites/1/products/{pid}","PUT",{"barcode":to})
    if st!=200: fails.append((pid,sku,st,resp))
print(f"applied {len(writes)-len(fails)}/{len(writes)} in {time.time()-t0:.1f}s, failures={len(fails)}")
for f in fails[:5]: print("   FAIL",f)

time.sleep(3)
after=snapshot()
fam2=defaultdict(list)
for p in after:
    if p.get("variantparentid"): fam2[p["variantparentid"]].append(p)
print(f"\nsandbox AFTER:  {len(after)} products, {len(fam2)} families")
lostp=({p['productid'] for p in before}-{p['productid'] for p in after})
print(f"   products LOST: {len(lostp)} {sorted(lostp) if lostp else ''}")
shrunk={k:(sizes_before[k],len(fam2.get(k,[]))) for k in sizes_before if len(fam2.get(k,[]))!=sizes_before[k]}
print(f"   families that changed size: {shrunk if shrunk else 'none'}")
byid={p['productid']:p for p in after}
ok=sum(1 for pid,_,_,to in writes if byid.get(pid,{}).get('barcode')==to)
print(f"   barcodes correct: {ok}/{len(writes)}")
