"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// The drop sheet. Deliberately shaped the opposite way round from the
// spreadsheet it replaces.
//
// The sheet started from a typed row and hoped a photograph existed. This
// starts from the SHARE: the shoot has already photographed the garments, so
// the rows are seeded from what is actually there and the job is to write the
// words. That is what makes "a photo with no row" impossible rather than
// invisible, and it is why the photos sit next to the fields — a wrong
// photo-to-row match was undetectable before.

type Shape = "tops" | "trousers" | "jeans";

interface SharePhoto {
  url: string;
  index: number;
  filename: string;
}

export interface ShareItem {
  itemNumber: string;
  photos: SharePhoto[];
  existing: { id: string; name: string } | null;
  missingBasePhoto: boolean;
}

interface Row {
  itemNumber: string;
  photos: SharePhoto[];
  include: boolean;
  title: string;
  description: string;
  category: string;
  taggedSize: string;
  approxSize: string;
  measurementType: string;
  chestWidth: string;
  frontLength: string;
  waist: string;
  frontRise: string;
  inseam: string;
  price: string;
  cost: string;
  barcode: string;
  originalBrand: string;
  sourceProduct: string;
}

function blankRow(item: ShareItem): Row {
  return {
    itemNumber: item.itemNumber,
    photos: item.photos,
    include: true,
    title: "",
    description: "",
    category: "",
    taggedSize: "",
    approxSize: "",
    measurementType: "1",
    chestWidth: "",
    frontLength: "",
    waist: "",
    frontRise: "",
    inseam: "",
    price: "",
    cost: "",
    barcode: "",
    originalBrand: "",
    sourceProduct: "",
  };
}

function shapeOf(r: Row): Shape {
  if (r.measurementType.trim() === "1") return "tops";
  return r.approxSize.trim() ? "jeans" : "trousers";
}

/** Fields that must be filled for the body template this row will take. */
function rowProblems(r: Row): string[] {
  const p: string[] = [];
  if (!r.title.trim()) p.push("title");
  if (!r.description.trim()) p.push("description");
  if (!r.category.trim()) p.push("category");
  if (!r.barcode.trim()) p.push("barcode");
  if (!r.price.trim()) p.push("price");
  if (!r.taggedSize.trim() && !r.approxSize.trim()) p.push("size");
  const shape = shapeOf(r);
  if (shape === "tops") {
    if (!r.chestWidth.trim()) p.push("chest width");
    if (!r.frontLength.trim()) p.push("front length");
  } else {
    if (!r.waist.trim()) p.push("waist");
    if (!r.frontRise.trim()) p.push("front rise");
    if (!r.inseam.trim()) p.push("inseam");
  }
  if (!r.photos.length) p.push("photo");
  return p;
}

const INPUT =
  "w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring";

export function VintageDropSheet({ items }: { items: ShareItem[] }) {
  const entered = useMemo(() => items.filter((i) => i.existing), [items]);
  const [rows, setRows] = useState<Row[]>(() =>
    items.filter((i) => !i.existing).map(blankRow)
  );
  const [drop, setDrop] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);

  const set = useCallback((n: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.itemNumber === n ? { ...r, ...patch } : r)));
  }, []);

  /** Copy one column down every included row — the sheet's fill-down. */
  const fillDown = useCallback((field: keyof Row) => {
    setRows((rs) => {
      const first = rs.find((r) => r.include);
      if (!first) return rs;
      const v = first[field];
      return rs.map((r) => (r.include ? { ...r, [field]: v } : r));
    });
  }, []);

  const included = rows.filter((r) => r.include);
  const problems = included.flatMap((r) =>
    rowProblems(r).length ? [{ itemNumber: r.itemNumber, problems: rowProblems(r) }] : []
  );
  const ready = drop.trim() !== "" && included.length > 0 && problems.length === 0;

  const payload = () =>
    included.map((r) => ({
      itemNumber: r.itemNumber,
      title: r.title,
      description: r.description,
      category: r.category,
      sourceProduct: r.sourceProduct || null,
      price: r.price,
      cost: r.cost || null,
      chestWidth: r.chestWidth || null,
      frontLength: r.frontLength || null,
      waist: r.waist || null,
      frontRise: r.frontRise || null,
      inseam: r.inseam || null,
      taggedSize: r.taggedSize || null,
      approxSize: r.approxSize || null,
      measurementType: r.measurementType,
      barcode: r.barcode,
      originalBrand: r.originalBrand || null,
      photoUrls: r.photos.map((p) => p.url),
    }));

  async function call(label: string, url: string, body: unknown) {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? `${label} failed`);
        return null;
      }
      return json;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onCreate() {
    const json = await call("Create", "/api/vintage/drops", {
      drop: drop.trim(),
      items: payload(),
    });
    if (!json) return;
    setCreated(json.colorwayIds ?? []);
    toast.success(`Created ${json.created} garment(s) in drop ${drop.trim()}.`);
  }

  async function onPushLoom() {
    if (!created?.length) return;
    const json = await call("Push to Loom", "/api/catalog/push/loom", {
      colorwayIds: created,
      seasonCode: "CONTINUITY",
      // The stock registry, not the wholesale catalogue — vintage is
      // one-of-one and is never wholesaled, but its stock must reconcile.
      mode: "data",
    });
    if (json) toast.success("Sent to Loom's registry.");
  }

  async function onPushShopify() {
    if (!created?.length) return;
    const json = await call("Push to Shopify", "/api/catalog/push/shopify/bulk", {
      colorwayIds: created,
      seasonCode: "CONTINUITY",
    });
    if (json) toast.success("Pushed to Shopify.");
  }

  async function onMoveToTop() {
    if (!created?.length) return;
    const json = await call("Move to top", "/api/vintage/collection/top", {
      colorwayIds: created,
    });
    if (!json) return;
    toast.success(
      `Moved ${json.moved} to the top of the Vintage collection${json.settled ? "" : " (still settling)"}.`
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Drop</span>
          <input
            className={cn(INPUT, "w-32")}
            placeholder="Drop 7"
            value={drop}
            onChange={(e) => setDrop(e.target.value)}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          {rows.length} on the share and not yet entered
          {entered.length > 0 && `, ${entered.length} already in the master`}.
          {" "}
          {included.length} selected.
        </p>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">
            {problems.length} garment(s) are not ready. Each is fatal — the
            spreadsheet exported these happily and they went live broken.
          </p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {problems.slice(0, 8).map((p) => (
              <li key={p.itemNumber}>
                <span className="font-mono">{p.itemNumber}</span> — no{" "}
                {p.problems.join(", no ")}
              </li>
            ))}
            {problems.length > 8 && <li>…and {problems.length - 8} more</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["category", "Category"],
            ["price", "Price"],
            ["cost", "Cost"],
            ["originalBrand", "Brand"],
            ["measurementType", "Type mål"],
          ] as const
        ).map(([field, label]) => (
          <button
            key={field}
            type="button"
            onClick={() => fillDown(field)}
            className="rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted"
          >
            Fill {label} down
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {rows.map((r) => {
          const shape = shapeOf(r);
          const probs = r.include ? rowProblems(r) : [];
          return (
            <div
              key={r.itemNumber}
              className={cn(
                "rounded-lg border p-3",
                !r.include && "opacity-50",
                probs.length > 0 && "border-amber-500/40"
              )}
            >
              <div className="flex gap-4">
                {/* The photographs, beside the fields. The capability the
                    spreadsheet never had. */}
                <div className="flex shrink-0 gap-1.5">
                  {r.photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={p.filename}
                      src={p.url}
                      alt={p.filename}
                      title={p.filename}
                      className="size-24 rounded border object-cover"
                    />
                  ))}
                  {!r.photos.length && (
                    <div className="grid size-24 place-items-center rounded border border-dashed text-xs text-muted-foreground">
                      no photo
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => set(r.itemNumber, { include: e.target.checked })}
                      />
                      <span className="font-mono font-medium">{r.itemNumber}</span>
                    </label>
                    <span className="text-xs text-muted-foreground">
                      {r.photos.length} photo(s) · {shape}
                    </span>
                    {probs.length > 0 && (
                      <span className="text-xs text-amber-600">no {probs.join(", no ")}</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <input
                      className={cn(INPUT, "lg:col-span-2")}
                      placeholder="Tittel"
                      value={r.title}
                      onChange={(e) => set(r.itemNumber, { title: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Kategori"
                      value={r.category}
                      onChange={(e) => set(r.itemNumber, { category: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="BRAND"
                      value={r.originalBrand}
                      onChange={(e) => set(r.itemNumber, { originalBrand: e.target.value })}
                    />
                  </div>

                  <textarea
                    className={cn(INPUT, "min-h-[3rem] resize-y")}
                    placeholder="Beskrivelse — opens the product body"
                    value={r.description}
                    onChange={(e) => set(r.itemNumber, { description: e.target.value })}
                  />

                  <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
                    <select
                      className={INPUT}
                      value={r.measurementType}
                      onChange={(e) => set(r.itemNumber, { measurementType: e.target.value })}
                    >
                      <option value="1">Type mål 1 — top</option>
                      <option value="2">Type mål 2 — bottom</option>
                    </select>
                    <input
                      className={INPUT}
                      placeholder="Størrelse"
                      value={r.taggedSize}
                      onChange={(e) => set(r.itemNumber, { taggedSize: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Approx size"
                      value={r.approxSize}
                      onChange={(e) => set(r.itemNumber, { approxSize: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Pris nett"
                      value={r.price}
                      onChange={(e) => set(r.itemNumber, { price: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Cost"
                      value={r.cost}
                      onChange={(e) => set(r.itemNumber, { cost: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Barcode"
                      value={r.barcode}
                      onChange={(e) => set(r.itemNumber, { barcode: e.target.value })}
                    />
                  </div>

                  {/* Only the measurements this row's template will print.
                      Showing all five is how a bandana ended up with an empty
                      waist on the live store. */}
                  <div className="grid grid-cols-3 gap-2">
                    {shape === "tops" ? (
                      <>
                        <input
                          className={INPUT}
                          placeholder="Chest width (cm)"
                          value={r.chestWidth}
                          onChange={(e) => set(r.itemNumber, { chestWidth: e.target.value })}
                        />
                        <input
                          className={INPUT}
                          placeholder="Front length (cm)"
                          value={r.frontLength}
                          onChange={(e) => set(r.itemNumber, { frontLength: e.target.value })}
                        />
                      </>
                    ) : (
                      <>
                        <input
                          className={INPUT}
                          placeholder="Waist (cm)"
                          value={r.waist}
                          onChange={(e) => set(r.itemNumber, { waist: e.target.value })}
                        />
                        <input
                          className={INPUT}
                          placeholder="Front rise (cm)"
                          value={r.frontRise}
                          onChange={(e) => set(r.itemNumber, { frontRise: e.target.value })}
                        />
                        <input
                          className={INPUT}
                          placeholder="Inseam (cm)"
                          value={r.inseam}
                          onChange={(e) => set(r.itemNumber, { inseam: e.target.value })}
                        />
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* One button per stage, in the order they must happen. Nothing is
          enabled until the step before it has actually run. */}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 py-3 backdrop-blur">
        <button
          type="button"
          disabled={!ready || busy !== null || created !== null}
          onClick={onCreate}
          className="rounded-md border bg-foreground px-3 py-1.5 text-sm font-medium text-background disabled:opacity-40"
        >
          {busy === "Create" ? "Creating…" : `Create ${included.length} in Origio`}
        </button>
        <span className="text-muted-foreground">→</span>
        <button
          type="button"
          disabled={!created?.length || busy !== null}
          onClick={onPushLoom}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy === "Push to Loom" ? "Sending…" : "Push to Loom"}
        </button>
        <span className="text-muted-foreground">→</span>
        <button
          type="button"
          disabled={!created?.length || busy !== null}
          onClick={onPushShopify}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy === "Push to Shopify" ? "Pushing…" : "Push to Shopify"}
        </button>
        <span className="text-muted-foreground">→</span>
        <button
          type="button"
          disabled={!created?.length || busy !== null}
          onClick={onMoveToTop}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {busy === "Move to top" ? "Moving…" : "Move to top of collection"}
        </button>
        {created !== null && (
          <span className="text-sm text-muted-foreground">
            {created.length} created — push before the share rotates.
          </span>
        )}
      </div>
    </div>
  );
}
