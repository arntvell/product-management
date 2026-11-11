"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tabItemClass, tabListClass } from "@/components/ui/tab-styles";
import { catalogImageSrc } from "@/lib/catalog-image";
import { cn } from "@/lib/utils";
import type { FlatRow } from "@/lib/master/flats";
import { OptionSearch } from "./references-panel";

type Tab = "shoot" | "waiting" | "done";
type Where = "all" | "warehouse" | "stores";

const WHERE_LABELS: Record<Where, string> = {
  all: "Anywhere",
  warehouse: "In the warehouse",
  stores: "In a store only",
};

function matchesWhere(r: FlatRow, w: Where) {
  if (w === "all") return true;
  const s = r.stock;
  if (w === "warehouse") return !!s && s.warehouse > 0;
  return !!s && s.warehouse === 0 && s.stores > 0;
}

// Nothing on hand: queued, but there is no garment to shoot. Stock is read on
// every load, so a product moves to To shoot by itself the day it arrives.
// Unknown stock (Loom unreadable) stays in To shoot rather than hiding.
const isWaiting = (r: FlatRow) => r.stock?.total === 0;

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";

export function FlatsBoard({
  open,
  done,
  canQueue,
  candidates,
}: {
  open: FlatRow[];
  done: FlatRow[];
  canQueue: boolean;
  candidates: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("shoot");
  const [q, setQ] = useState("");
  const [where, setWhere] = useState<Where>("all");

  const shoot = useMemo(() => open.filter((r) => !isWaiting(r)), [open]);
  const waiting = useMemo(() => open.filter(isWaiting), [open]);
  const rows = tab === "shoot" ? shoot : tab === "waiting" ? waiting : done;
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(
      (r) =>
        (tab !== "shoot" || matchesWhere(r, where)) &&
        words.every((w) => `${r.product} ${r.sku} ${r.gender}`.toLowerCase().includes(w))
    );
  }, [rows, q, where, tab]);

  return (
    <div className="space-y-4">
      {canQueue && <QueueBar candidates={candidates} openIds={open.map((r) => r.colorwayId)} onDone={() => router.refresh()} />}

      <div className="flex flex-wrap items-center gap-3">
        <nav className={tabListClass} aria-label="Flats">
          <button type="button" className={tabItemClass(tab === "shoot")} onClick={() => setTab("shoot")}>
            To shoot ({shoot.length})
          </button>
          <button type="button" className={tabItemClass(tab === "waiting")} onClick={() => setTab("waiting")}>
            Waiting for stock ({waiting.length})
          </button>
          <button type="button" className={tabItemClass(tab === "done")} onClick={() => setTab("done")}>
            Done ({done.length})
          </button>
        </nav>
        <Input className="w-64" placeholder="Search product or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        {tab === "shoot" && (
          <select
            value={where}
            onChange={(e) => setWhere(e.target.value as Where)}
            className="border bg-background px-2 py-1.5 text-body"
            aria-label="Where the garment is"
          >
            {(Object.keys(WHERE_LABELS) as Where[]).map((w) => (
              <option key={w} value={w}>
                {WHERE_LABELS[w]}
              </option>
            ))}
          </select>
        )}
        <span className="text-fine text-muted-foreground">{shown.length} shown</span>
      </div>

      {shown.length === 0 ? (
        <p className="text-body text-muted-foreground">
          {tab === "shoot"
            ? "Nothing to shoot."
            : tab === "waiting"
              ? "Nothing waiting for stock."
              : "No flats uploaded in the last 30 days."}
        </p>
      ) : (
        <div className="divide-y border">
          {shown.map((r) =>
            tab !== "done" ? (
              <OpenRow key={r.id} row={r} canQueue={canQueue} onChange={() => router.refresh()} />
            ) : (
              <DoneRow key={r.id} row={r} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function Thumb({ url, label }: { url: string | null; label: string }) {
  const src = catalogImageSrc(url);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={label} loading="lazy" className="h-24 w-20 shrink-0 bg-muted object-cover" />
  ) : (
    <div className="flex h-24 w-20 shrink-0 items-center justify-center bg-muted text-fine text-muted-foreground">
      No image
    </div>
  );
}

function StockLine({ row: r }: { row: FlatRow }) {
  if (!r.stock) return <span className="text-muted-foreground">Stock unknown</span>;
  if (!r.stock.total) return <span className="text-muted-foreground">None on hand</span>;
  return (
    <span>
      {r.stock.byLocation.map((l) => `${l.location.replace(/^Livid\s+/i, "")} ${l.onHand}`).join(" · ")}
    </span>
  );
}

function OpenRow({ row: r, canQueue, onChange }: { row: FlatRow; canQueue: boolean; onChange: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState(r.note ?? "");

  async function send(file: File) {
    if (!file.type.startsWith("image/")) return toast.error("That is not an image.");
    setBusy("Uploading…");
    try {
      const blob = await upload(`flats/${r.colorwayId}/${crypto.randomUUID()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/vintage/flats/token",
        clientPayload: JSON.stringify({ requestId: r.id }),
      });
      setBusy("Sending to Shopify…");
      const res = await fetch(`/api/vintage/flats/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, pathname: blob.pathname }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      if (json.done) toast.success(`Flat uploaded for ${r.product}.`);
      else toast.error(json.error ?? "Uploaded, but Shopify did not take it.", { duration: Infinity });
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("Sending to Shopify…");
    try {
      const res = await fetch(`/api/vintage/flats/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retry: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.done) throw new Error(json.error ?? "Shopify did not take it.");
      toast.success(`Flat is on Shopify for ${r.product}.`);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Take ${r.product} off the flats list?`)) return;
    const res = await fetch(`/api/catalog/flats/${r.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Could not remove it.");
    onChange();
  }

  async function saveNote() {
    if (note === (r.note ?? "")) return;
    const res = await fetch(`/api/catalog/flats/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!res.ok) toast.error("Could not save the note.");
  }

  return (
    <div
      className={cn("flex flex-wrap items-start gap-4 p-3", drag && "bg-muted")}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f && !busy) void send(f);
      }}
    >
      <Thumb url={r.thumb} label={r.product} />
      <div className="min-w-0 flex-1 space-y-1 text-body">
        <div>
          {r.product}
          {r.gender && <span className="ml-2 text-fine text-muted-foreground">{r.gender}</span>}
        </div>
        <div className="font-mono text-fine text-muted-foreground">{r.sku}</div>
        <div className="text-fine">
          <StockLine row={r} />
        </div>
        {canQueue ? (
          <Input
            className="max-w-md"
            placeholder="Note for the shoot"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
          />
        ) : (
          r.note && <div className="text-fine">{r.note}</div>
        )}
        {r.shopifyError && <div className="text-fine text-destructive">{r.shopifyError}</div>}
        <div className="text-fine text-muted-foreground">
          Added {day(r.createdAt)}
          {r.requestedBy ? ` by ${r.requestedBy}` : ""}
          {r.shopifyAdminUrl && (
            <>
              {" · "}
              <a href={r.shopifyAdminUrl} target="_blank" rel="noreferrer" className="underline">
                Shopify
              </a>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void send(f);
          }}
        />
        {r.shopifyError && r.uploadedAt ? (
          <Button size="sm" variant="outline" disabled={!!busy} onClick={retry}>
            {busy ?? "Retry Shopify"}
          </Button>
        ) : null}
        <Button size="sm" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy ?? (r.uploadedAt ? "Upload again" : "Upload flat")}
        </Button>
        <span className="text-fine text-muted-foreground">or drop an image on the row</span>
        {canQueue && (
          <button type="button" className="text-fine text-muted-foreground underline" disabled={!!busy} onClick={remove}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function DoneRow({ row: r }: { row: FlatRow }) {
  return (
    <div className="flex flex-wrap items-start gap-4 p-3">
      <Thumb url={r.thumb} label={r.product} />
      <Thumb url={r.flat} label={`${r.product} flat`} />
      <div className="min-w-0 flex-1 space-y-1 text-body">
        <div>{r.product}</div>
        <div className="font-mono text-fine text-muted-foreground">{r.sku}</div>
        <div className="text-fine text-muted-foreground">
          Flat {day(r.doneAt)}
          {r.uploadedBy ? ` by ${r.uploadedBy}` : ""}
          {r.shopifyAdminUrl ? (
            <>
              {" · "}
              <a href={r.shopifyAdminUrl} target="_blank" rel="noreferrer" className="underline">
                Shopify
              </a>
            </>
          ) : (
            " · not on Shopify yet; the first push carries it"
          )}
        </div>
      </div>
    </div>
  );
}

/** Admins and Product managers: queue one product by search, or many by SKU. */
function QueueBar({
  candidates,
  openIds,
  onDone,
}: {
  candidates: { id: string; label: string }[];
  openIds: string[];
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [paste, setPaste] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add(body: { ids?: string[]; skus?: string[] }) {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/flats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, note }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not add");
      const parts = [`Added ${json.added}.`];
      if (json.alreadyOpen) parts.push(`${json.alreadyOpen} already on the list.`);
      if (json.notFound?.length) parts.push(`Not found: ${json.notFound.join(", ")}.`);
      (json.notFound?.length ? toast.warning : toast.success)(parts.join(" "));
      setPaste(null);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body">Add to the list</span>
        <OptionSearch
          className="w-80"
          options={candidates}
          exclude={openIds}
          placeholder="Search Livid products"
          onPick={(o) => void add({ ids: [o.id] })}
        />
        <Input className="w-64" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPaste(paste === null ? "" : null)}>
          Paste SKUs
        </Button>
      </div>
      {paste !== null && (
        <div className="flex flex-wrap items-end gap-2">
          <textarea
            className="h-24 w-96 max-w-full border bg-background p-2 font-mono text-fine"
            placeholder="One SKU per line, or separated by commas"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !paste.trim()}
            onClick={() => void add({ skus: paste.split(/[\s,;]+/).filter(Boolean) })}
          >
            {busy ? "Adding…" : "Add SKUs"}
          </Button>
        </div>
      )}
    </div>
  );
}
