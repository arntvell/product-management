"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SizeSystemView } from "@/lib/master/size-systems";

type Kind = "ONE_D" | "TWO_D" | "ONE_SIZE";

const KIND_LABELS: Record<Kind, string> = {
  ONE_D: "One dimension (S/M/L, 39–46)",
  TWO_D: "Waist × length",
  ONE_SIZE: "One size",
};

const KIND_HINTS: Record<Kind, string> = {
  ONE_D: 'e.g. "39-46" or "XS,S,M,L,XL"',
  TWO_D: 'e.g. "28-36 x 30,32,34"',
  ONE_SIZE: "No sizes to enter — the run is a single OS.",
};

export function SizeSystemManager({ initial }: { initial: SizeSystemView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const live = initial.filter((s) => !s.archived);
  const archived = initial.filter((s) => s.archived);

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          {creating ? "Cancel" : "New size system"}
        </Button>
      </div>

      {creating ? (
        <CreateForm
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : null}

      {live.length === 0 && !creating ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No size systems yet. The builder needs at least one before it can create variants.
        </p>
      ) : null}

      <div className="space-y-2">
        {live.map((s) => (
          <SystemRow
            key={s.id}
            system={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            onSaved={() => router.refresh()}
            disabled={pending}
            onArchive={() =>
              start(async () => {
                await save(s.id, { archived: true });
                router.refresh();
              })
            }
          />
        ))}
      </div>

      {archived.length ? (
        <details className="rounded-md border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {archived.length} archived
          </summary>
          <div className="mt-3 space-y-2">
            {archived.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {s.name} · {s.entries.filter((e) => !e.archived).length} sizes
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await save(s.id, { archived: false });
                      router.refresh();
                    })
                  }
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function SystemRow({
  system,
  open,
  onToggle,
  onSaved,
  onArchive,
  disabled,
}: {
  system: SizeSystemView;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
  onArchive: () => void;
  disabled: boolean;
}) {
  const activeEntries = system.entries.filter((e) => !e.archived);
  const retired = system.entries.filter((e) => e.archived);

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{system.name}</span>
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {KIND_LABELS[system.kind as Kind]}
            </span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {activeEntries.map((e) => e.sizeLabel).join(" · ") || "no sizes"}
          </p>
        </div>
        <div className="shrink-0 pl-4 text-right text-xs text-muted-foreground">
          <div>{activeEntries.length} sizes</div>
          {system.brands.length ? <div>{system.brands.length} brands</div> : null}
        </div>
      </button>

      {open ? (
        <div className="space-y-4 border-t px-4 py-4">
          {system.brands.length ? (
            <p className="text-xs text-muted-foreground">
              Default for {system.brands.map((b) => b.name).join(", ")}.
            </p>
          ) : null}

          <div>
            <Label className="text-xs">Sizes, in order</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeEntries.map((e) => (
                <span
                  key={e.id}
                  className="rounded border px-2 py-1 text-xs"
                  title={`SKU token: ${e.skuToken}`}
                >
                  {e.sizeLabel}
                  <span className="ml-1.5 text-muted-foreground">{e.skuToken}</span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              The grey value is what a variant SKU ends with. Waist/length folds to four
              digits so the Threadflow and Cin7 importers can read it back.
            </p>
          </div>

          {retired.length ? (
            <p className="text-xs text-muted-foreground">
              Retired: {retired.map((e) => e.sizeLabel).join(", ")}. Variants already using
              these keep them — a size is archived, never deleted.
            </p>
          ) : null}

          <AddSizes system={system} onSaved={onSaved} />

          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={disabled} onClick={onArchive}>
              Archive system
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AddSizes({ system, onSaved }: { system: SizeSystemView; onSaved: () => void }) {
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);
  if (system.kind === "ONE_SIZE") return null;

  async function add() {
    if (!range.trim()) return;
    setBusy(true);
    try {
      // Expand server-side, then append to the existing order. Sending the full
      // list is what keeps ids — and therefore history — on the sizes already here.
      const res = await fetch("/api/catalog/size-systems/" + system.id, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entries: [
            ...system.entries.map((e) => ({
              id: e.id,
              dim1: e.dim1,
              dim2: e.dim2,
              sizeLabel: e.sizeLabel,
              skuToken: e.skuToken,
              archived: e.archived,
            })),
            ...(await expand(range, system.kind)),
          ],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not add sizes");
      setRange("");
      toast.success("Sizes added");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add sizes");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Label htmlFor={`add-${system.id}`} className="text-xs">
        Add sizes
      </Label>
      <div className="mt-1.5 flex gap-2">
        <Input
          id={`add-${system.id}`}
          value={range}
          onChange={(e) => setRange(e.target.value)}
          placeholder={KIND_HINTS[system.kind as Kind]}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <Button size="sm" disabled={busy || !range.trim()} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("ONE_D");
  const [range, setRange] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/catalog/size-systems", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, kind, range: kind === "ONE_SIZE" ? undefined : range }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not create");
      toast.success(`Created "${name}"`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="ss-name" className="text-xs">
            Name
          </Label>
          <Input
            id="ss-name"
            className="mt-1.5"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="EU shoes 39–46"
          />
        </div>
        <div>
          <Label htmlFor="ss-kind" className="text-xs">
            Kind
          </Label>
          <select
            id="ss-kind"
            className="mt-1.5 h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {kind === "ONE_SIZE" ? (
        <p className="text-xs text-muted-foreground">{KIND_HINTS.ONE_SIZE}</p>
      ) : (
        <div>
          <Label htmlFor="ss-range" className="text-xs">
            Sizes
          </Label>
          <Input
            id="ss-range"
            className="mt-1.5"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder={KIND_HINTS[kind]}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Ranges expand: <code>39-46</code> gives eight sizes. Commas list them literally.
          </p>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={busy || !name.trim() || (kind !== "ONE_SIZE" && !range.trim())}
          onClick={create}
        >
          Create
        </Button>
      </div>
    </div>
  );
}

/** Expand a range client-side by asking the server, so both agree on the rule. */
async function expand(range: string, kind: Kind) {
  const res = await fetch("/api/catalog/size-systems/expand", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ range, kind }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not read that range");
  return json.entries as Array<{ dim1: string; dim2: string | null }>;
}

async function save(id: string, body: Record<string, unknown>) {
  const res = await fetch("/api/catalog/size-systems/" + id, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    toast.error(json.error ?? "Could not save");
  }
}
