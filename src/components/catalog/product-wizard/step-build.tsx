"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { buildVariantSku } from "@/lib/master/sku";
import type { ColorwayHit } from "@/lib/master/builder-search";
import type { DraftColorway, DraftVariant } from "@/lib/master/draft-payload";
import type { SizeSystemView } from "@/lib/master/size-systems";
import type { StepProps } from "./types";
import { newKey } from "./types";
import { restyleColorway } from "./sku-tools";
import { StepStyle } from "./step-style";
import { CustomsCard } from "./customs-card";
import { ColorwayCard } from "./colorway-card";

/**
 * Step 2: the style and everything under it, top to bottom.
 *
 * Style → customs → one card per colourway (name, sizes, prices, barcodes).
 * This replaces five steps — Style, Colourways, Sizes, Prices, Barcodes — that
 * each walked the whole colourway list again. The state changes below are the
 * ones those steps made, unchanged; only where they are shown has moved.
 */
export function StepBuild({
  payload,
  update,
  options,
  draftId,
  revision,
  onImported,
}: StepProps & {
  draftId: string;
  revision: number;
  onImported: (payload: StepProps["payload"], revision: number) => void;
}) {
  const style = payload.style;
  const systems = options.sizeSystems.filter((s) => !s.archived);
  const [existing, setExisting] = useState<ColorwayHit[]>([]);
  const [bulk, setBulk] = useState("");

  // Show what this style already has, so a duplicate name is visible before it
  // becomes a SKU collision. The effect only sets state from the fetch; the
  // "no existing style" case is derived at render time below.
  const styleId = style?.mode === "existing" ? style.id : null;
  useEffect(() => {
    if (!styleId) return;
    let cancelled = false;
    fetch(`/api/catalog/builder/colorways?styleId=${styleId}`)
      .then((r) => r.json())
      .then((j) => {
        if (!cancelled) setExisting(j.colorways ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [styleId]);
  const existingHere = styleId ? existing : [];
  const taken = new Map(existingHere.map((e) => [e.name.trim().toLowerCase(), e]));

  // --- colourways ----------------------------------------------------------

  function addColorways(names: string[]) {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (!clean.length || !style) return;
    update((p) => ({
      ...p,
      colorways: [
        ...p.colorways,
        ...clean.map((name) =>
          restyleColorway(
            {
              key: newKey(),
              name,
              color: name,
              swatchHex: null,
              colorwaySku: "",
              manualSku: false,
              kind: null,
              // Inherits the batch's category. Only the importer sets a
              // per-colourway one, from the file's Category column.
              categoryId: null,
              category: null,
              // The brand's default size system, so the card opens with a run
              // already chosen rather than an empty picker.
              sizeSystemId: payload.template.defaultSizeSystemId || null,
              variants: [],
              prices: {},
            },
            style.styleSku
          )
        ),
      ],
    }));
  }

  function mapColorway(key: string, fn: (cw: DraftColorway) => DraftColorway) {
    update((p) => ({ ...p, colorways: p.colorways.map((cw) => (cw.key === key ? fn(cw) : cw)) }));
  }

  function patch(key: string, changes: Partial<DraftColorway>) {
    mapColorway(key, (cw) => {
      const next = { ...cw, ...changes };
      // The colour starts as the name. While nobody has given it a value of its
      // own, it follows renames, so "New colourway" does not stay as the colour.
      if (changes.name !== undefined && changes.color === undefined && (cw.color ?? "") === cw.name)
        next.color = changes.name || null;
      // A rename re-derives the SKU, unless someone has taken it over by hand.
      return changes.name !== undefined && !next.manualSku
        ? restyleColorway(next, style!.styleSku)
        : next;
    });
  }

  // --- sizes ---------------------------------------------------------------

  function setSystem(key: string, systemId: string) {
    mapColorway(key, (cw) => ({ ...cw, sizeSystemId: systemId || null, variants: [] }));
  }

  function toggleSize(key: string, system: SizeSystemView, entryId: string) {
    const entry = system.entries.find((e) => e.id === entryId);
    if (!entry) return;
    mapColorway(key, (cw) => {
      const has = cw.variants.some((v) => v.entryId === entryId);
      const variants = has
        ? cw.variants.filter((v) => v.entryId !== entryId)
        : [...cw.variants, makeVariant(cw.colorwaySku, entry)].sort(byPosition(system));
      // Picking a size settles the system too. Without this a colourway that
      // merely INHERITED the brand default would keep a null systemId, and the
      // next render's fallback could move under it.
      return { ...cw, sizeSystemId: system.id, variants };
    });
  }

  function setAllSizes(key: string, system: SizeSystemView, on: boolean) {
    mapColorway(key, (cw) => ({
      ...cw,
      sizeSystemId: system.id,
      variants: on
        ? system.entries
            .filter((e) => !e.archived)
            .map((e) => cw.variants.find((v) => v.entryId === e.id) ?? makeVariant(cw.colorwaySku, e))
        : [],
    }));
  }

  /** Copy the first colourway's sizes down. The speed lever. */
  function sizesToAll() {
    const first = payload.colorways[0];
    if (!first) return;
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw, i) =>
        i === 0
          ? cw
          : {
              ...cw,
              sizeSystemId: first.sizeSystemId,
              variants: first.variants.map((v) => ({
                ...v,
                key: newKey(),
                variantSku: buildVariantSku(cw.colorwaySku, v.skuToken),
                // Barcodes are per garment, never copied.
                barcode: null,
                barcodeSource: null,
              })),
            }
      ),
    }));
  }

  // --- prices --------------------------------------------------------------

  function setPrice(key: string, field: "COST" | "MSRP", value: string) {
    mapColorway(key, (cw) => ({ ...cw, prices: { ...cw.prices, [field]: value } }));
  }

  /** Fill every colourway's prices from the first — the bulk editor's fill-down. */
  function pricesToAll() {
    const first = payload.colorways[0];
    if (!first) return;
    update((p) => ({
      ...p,
      colorways: p.colorways.map((cw) => ({ ...cw, prices: { ...first.prices } })),
    }));
  }

  // --- barcodes ------------------------------------------------------------

  function setBarcode(cwKey: string, vKey: string, value: string) {
    mapColorway(cwKey, (cw) => ({
      ...cw,
      variants: cw.variants.map((v) =>
        v.key !== vKey ? v : { ...v, barcode: value || null, barcodeSource: value ? "brand" : null }
      ),
    }));
  }

  const allVariants = payload.colorways.flatMap((cw) => cw.variants);
  const blankBarcodes = allVariants.filter((v) => !v.barcode).length;

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h3 className="text-body">Style</h3>
        <StepStyle payload={payload} update={update} options={options} />
      </section>

      {style ? (
        <>
          <CustomsCard payload={payload} update={update} options={options} />

          <section className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-body">
                Colourways
                {payload.colorways.length ? (
                  <span className="ml-2 text-fine text-muted-foreground">
                    {payload.colorways.length} · {allVariants.length} sizes · all under{" "}
                    <code className="font-mono">{style.styleSku}</code>
                  </span>
                ) : null}
              </h3>
              {payload.colorways.length > 1 ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={sizesToAll}>
                    First colourway&apos;s sizes → all
                  </Button>
                  <Button size="sm" variant="outline" onClick={pricesToAll}>
                    First colourway&apos;s prices → all
                  </Button>
                </div>
              ) : null}
            </div>

            {existingHere.length ? (
              <div className="border bg-muted/30 p-3">
                <div className="text-fine">
                  {style.styleName} already has {existingHere.length} colourway
                  {existingHere.length === 1 ? "" : "s"}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {existingHere.map((e) => (
                    <span
                      key={e.id}
                      className="border bg-background px-2 py-0.5 text-fine"
                      title={e.colorwaySku}
                    >
                      {e.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            {!systems.length ? (
              <p className="border border-dashed p-4 text-center text-body text-muted-foreground">
                No size systems yet.{" "}
                <Link href="/catalog/size-systems" className="underline underline-offset-2">
                  Create one
                </Link>{" "}
                — sizes are minted from them, so the order and SKU tokens come from there.
              </p>
            ) : null}

            {payload.colorways.map((cw, i) => (
              <ColorwayCard
                key={cw.key}
                cw={cw}
                index={i}
                styleName={style.styleName}
                systems={systems}
                defaultSystemId={payload.template.defaultSizeSystemId}
                clash={taken.get(cw.name.trim().toLowerCase())}
                onPatch={(c) => patch(cw.key, c)}
                onResetSku={() =>
                  mapColorway(cw.key, (x) => restyleColorway({ ...x, manualSku: false }, style.styleSku))
                }
                onRemove={() =>
                  update((p) => ({ ...p, colorways: p.colorways.filter((x) => x.key !== cw.key) }))
                }
                onSetSystem={(id) => setSystem(cw.key, id)}
                onToggleSize={(s, e) => toggleSize(cw.key, s, e)}
                onSetAllSizes={(s, on) => setAllSizes(cw.key, s, on)}
                onSetPrice={(f, v) => setPrice(cw.key, f, v)}
                onSetBarcode={(vk, v) => setBarcode(cw.key, vk, v)}
              />
            ))}

            <div className="flex flex-wrap items-end gap-3">
              <Button size="sm" variant="outline" onClick={() => addColorways(["New colourway"])}>
                + Colourway
              </Button>
              <div className="min-w-[16rem] flex-1">
                <Label htmlFor="bulk" className="text-fine">
                  Or paste a list, one name per line
                </Label>
                <div className="mt-1.5 flex gap-2">
                  <Input
                    id="bulk"
                    value={bulk}
                    onChange={(e) => setBulk(e.target.value)}
                    placeholder="Dark Brown, Black, Marine"
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text");
                      if (!text.includes("\n")) return;
                      e.preventDefault();
                      addColorways(text.split(/\r?\n/));
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!bulk.trim()}
                    onClick={() => {
                      addColorways(bulk.split(/[,\n]/));
                      setBulk("");
                    }}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </section>

          {allVariants.length ? (
            <BarcodeFileTools
              draftId={draftId}
              revision={revision}
              onImported={onImported}
              total={allVariants.length}
              blank={blankBarcodes}
              toLoom={payload.channels.includes("LOOM")}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Barcodes for the whole draft at once, through a spreadsheet. */
function BarcodeFileTools({
  draftId,
  revision,
  onImported,
  total,
  blank,
  toLoom,
}: {
  draftId: string;
  revision: number;
  onImported: (payload: StepProps["payload"], revision: number) => void;
  total: number;
  blank: number;
  toLoom: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function importCsv(file: File) {
    setBusy(true);
    try {
      const csv = await file.text();
      const res = await fetch(`/api/catalog/drafts/${draftId}/barcodes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ csv, revision }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Import failed");
      const r = json.report;
      onImported(json.payload, json.revision);
      toast.success(
        `${r.filled} filled, ${r.unchanged} unchanged` + (r.cleared ? `, ${r.cleared} cleared` : "")
      );
      if (r.unknown.length)
        toast.error(`${r.unknown.length} row(s) not in this draft: ${r.unknown.slice(0, 3).join(", ")}`);
      for (const rej of r.rejected.slice(0, 5)) toast.error(`${rej.variantSku}: ${rej.reason}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <section className="space-y-2 border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body">Barcodes by file</span>
        <a
          href={`/api/catalog/drafts/${draftId}/barcodes`}
          className="border px-3 py-1.5 text-body transition-colors hover:bg-muted"
        >
          Export CSV
        </a>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? "Importing…" : "Import CSV"}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
          }}
        />
        <span className="text-fine text-muted-foreground">
          {blank ? `${blank} of ${total} still blank` : `all ${total} have a barcode`}
        </span>
      </div>
      <p className="text-fine text-muted-foreground">
        Optional. External brands carry their own EAN — type it in each colourway above, or
        export the file, fill the barcode column in Excel and import it back. The import joins
        on variant SKU, so sorting or filtering the file first is harmless.
      </p>
      {toLoom && blank ? (
        <p className="border border-ink bg-paper px-3 py-2 text-meta normal-case tracking-normal text-ink">
          Loom&apos;s stock registry carries barcoded variants only, so the {blank} blank size
          {blank === 1 ? "" : "s"} will not reach it until a code is filled in. The product is
          still created, and re-pushing later picks them up.
        </p>
      ) : null}
    </section>
  );
}

function makeVariant(
  colorwaySku: string,
  entry: { id: string; sizeLabel: string; dim1: string; dim2: string | null; skuToken: string }
): DraftVariant {
  return {
    key: newKey(),
    entryId: entry.id,
    sizeLabel: entry.sizeLabel,
    dim1: entry.dim1,
    dim2: entry.dim2,
    skuToken: entry.skuToken,
    variantSku: buildVariantSku(colorwaySku, entry.skuToken),
    barcode: null,
    barcodeSource: null,
  };
}

/** Keep a run in the size system's order, not the order you clicked. */
function byPosition(system: SizeSystemView) {
  const pos = new Map(system.entries.map((e) => [e.id, e.position]));
  return (a: DraftVariant, b: DraftVariant) =>
    (pos.get(a.entryId ?? "") ?? 0) - (pos.get(b.entryId ?? "") ?? 0);
}
