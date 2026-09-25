"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// The drop sheet.
//
// Shaped around how a drop is actually made, which is not the order the old
// spreadsheet implied. The writing comes first and the photographs arrive
// afterwards: the shoot uploads to the share over the course of the day, so a
// row exists, gets its words, and only later gets its pictures. Hence
// "Load photos" is a button you press whenever, not a precondition.
//
// Four columns are never typed. Item number, SKU, handle and barcode are all
// computed from the drop's position in one long sequence — the barcode
// especially, because those codes are pre-assigned and may already be on
// printed labels. They are shown read-only rather than hidden, so what goes on
// the label is visible while the garment is being described.

type Shape = "tops" | "trousers" | "jeans";

interface Identity {
  itemNumber: string;
  sku: string;
  variantSku: string;
  handle: string;
  barcode: string;
  preassigned: boolean;
}

interface Photo {
  url: string;
  index: number;
  filename: string;
}

interface Row extends Identity {
  include: boolean;
  photos: Photo[];
  title: string;
  description: string;
  category: string;
  sourceProduct: string;
  originalBrand: string;
  taggedSize: string;
  approxSize: string;
  chestWidth: string;
  frontLength: string;
  waist: string;
  frontRise: string;
  inseam: string;
  price: string;
  cost: string;
  tags: string;
}

/**
 * Type mål, derived rather than asked for — exactly as the sheet derives it
 * (`=if(isblank(H),2,1)`). A garment is a top if it has a chest measurement.
 * Asking the operator to also declare it is asking the same question twice and
 * inviting the two answers to disagree.
 */
function shapeOf(r: Row): Shape {
  const isTop = r.chestWidth.trim() !== "" || r.frontLength.trim() !== "";
  if (isTop) return "tops";
  return r.approxSize.trim() ? "jeans" : "trousers";
}

function measurementType(r: Row): string {
  return shapeOf(r) === "tops" ? "1" : "2";
}

function rowProblems(r: Row): string[] {
  const p: string[] = [];
  if (!r.title.trim()) p.push("title");
  if (!r.description.trim()) p.push("description");
  if (!r.category.trim()) p.push("category");
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
  return p;
}

const INPUT =
  "w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring";
const MONO = "font-mono text-[11px] text-muted-foreground";

const STORAGE_KEY = "vintage-drop-sheet";

export function VintageDropSheet({
  brands,
  categories,
}: {
  brands: string[];
  categories: { name: string; webCategory: string | null }[];
}) {
  const [drop, setDrop] = useState("");
  const [count, setCount] = useState("45");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<string[] | null>(null);
  const [numbering, setNumbering] = useState<string | null>(null);

  // 45 rows of typing is too much to lose to a reload. Per-browser only; the
  // master is the real store of record, once Create has run.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.drop) setDrop(s.drop);
      if (s.count) setCount(s.count);
      if (Array.isArray(s.rows)) setRows(s.rows);
    } catch {
      /* a corrupt draft is not worth a crash */
    }
  }, []);
  useEffect(() => {
    try {
      if (rows.length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ drop, count, rows }));
    } catch {
      /* private window, quota — the sheet still works */
    }
  }, [drop, count, rows]);

  const set = useCallback((n: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.itemNumber === n ? { ...r, ...patch } : r)));
  }, []);

  const fillDown = useCallback((field: keyof Row) => {
    setRows((rs) => {
      const first = rs.find((r) => r.include);
      if (!first) return rs;
      const v = first[field];
      return rs.map((r) => (r.include ? ({ ...r, [field]: v } as Row) : r));
    });
  }, []);

  async function call(label: string, url: string, body?: unknown, method = "POST") {
    setBusy(label);
    try {
      const res = await fetch(url, {
        method,
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
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

  async function onStart() {
    const n = Number(count);
    if (!drop.trim()) return toast.error("Which drop?");
    if (!Number.isInteger(n) || n < 1) return toast.error("How many garments?");
    const json = await call("Start", `/api/vintage/next?count=${n}`, undefined, "GET");
    if (!json) return;
    setNumbering(json.warning ?? null);
    const dropTag = `DROP${drop.replace(/\D/g, "")}`;
    setRows(
      (json.items as Identity[]).map((id) => ({
        ...id,
        include: true,
        photos: [],
        title: "",
        description: "",
        category: "",
        sourceProduct: "",
        originalBrand: "",
        taggedSize: "",
        approxSize: "",
        chestWidth: "",
        frontLength: "",
        waist: "",
        frontRise: "",
        inseam: "",
        price: "",
        cost: "",
        tags: `${dropTag}, rocket-hide, hide`,
      }))
    );
    setCreated(null);
    if (json.beyondPreassigned?.length)
      toast.warning(
        `${json.beyondPreassigned.length} number(s) are past the sheet's pre-assigned range — their barcodes are extrapolated, not recorded.`
      );
  }

  /** Re-read the share and attach whatever has been uploaded since. */
  async function onLoadPhotos() {
    const json = await call("Load photos", "/api/vintage/photos", undefined, "GET");
    if (!json) return;
    const byNumber = new Map<string, Photo[]>(
      (json.items as { itemNumber: string; photos: Photo[] }[]).map((i) => [i.itemNumber, i.photos])
    );
    let matched = 0;
    setRows((rs) =>
      rs.map((r) => {
        const p = byNumber.get(r.itemNumber);
        if (p?.length) matched++;
        return p?.length ? { ...r, photos: p } : r;
      })
    );
    const still = rows.filter((r) => r.include && !byNumber.get(r.itemNumber)?.length).length;
    toast.success(
      `${matched} garment(s) have photos on the share${still ? `; ${still} still waiting` : ""}.`
    );
  }

  const included = rows.filter((r) => r.include);
  const problems = included.flatMap((r) => {
    const p = rowProblems(r);
    return p.length ? [{ itemNumber: r.itemNumber, problems: p }] : [];
  });
  const withoutPhotos = included.filter((r) => !r.photos.length);
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
      measurementType: measurementType(r),
      barcode: r.barcode,
      originalBrand: r.originalBrand || null,
      tags: r.tags.split(",").map((t) => t.trim()).filter(Boolean),
      photoUrls: r.photos.map((p) => p.url),
    }));

  async function onCreate() {
    const json = await call("Create", "/api/vintage/drops", { drop: drop.trim(), items: payload() });
    if (!json) return;
    setCreated(json.colorwayIds ?? []);
    toast.success(`Created ${json.created} garment(s) in ${drop.trim()}.`);
  }

  async function onPushLoom() {
    if (!created?.length) return;
    const json = await call("Push to Loom", "/api/catalog/push/loom", {
      colorwayIds: created,
      seasonCode: "CONTINUITY",
      mode: "data",
    });
    if (json) toast.success("Sent to Loom's stock registry.");
  }

  async function onPushShopify() {
    if (!created?.length) return;
    if (withoutPhotos.length)
      return toast.error(
        `${withoutPhotos.length} garment(s) still have no photo. Load photos first — Shopify will refuse them anyway.`
      );
    const json = await call("Push to Shopify", "/api/catalog/push/shopify/bulk", {
      colorwayIds: created,
      seasonCode: "CONTINUITY",
    });
    if (json) toast.success("Pushed to Shopify.");
  }

  async function onMoveToTop() {
    if (!created?.length) return;
    const json = await call("Move to top", "/api/vintage/collection/top", { colorwayIds: created });
    if (json)
      toast.success(
        `Moved ${json.moved} to the top of the Vintage collection${json.settled ? "" : " (still settling)"}.`
      );
  }

  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  return (
    <div className="space-y-6">
      {/* --- Start a drop ------------------------------------------------ */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Drop</span>
          <input
            className={cn(INPUT, "w-32")}
            placeholder="DROP 187"
            value={drop}
            onChange={(e) => setDrop(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Garments</span>
          <input
            className={cn(INPUT, "w-24")}
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={onStart}
          disabled={busy !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
        >
          {busy === "Start" ? "Reserving…" : rows.length ? "Start over" : "Start drop"}
        </button>
        {rows.length > 0 && (
          <>
            <button
              type="button"
              onClick={onLoadPhotos}
              disabled={busy !== null}
              className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-40"
            >
              {busy === "Load photos" ? "Reading share…" : "Load photos from share"}
            </button>
            <p className="text-sm text-muted-foreground">
              {rows[0].itemNumber}–{rows[rows.length - 1].itemNumber} · {included.length} selected ·{" "}
              {included.length - withoutPhotos.length}/{included.length} photographed
            </p>
          </>
        )}
      </div>

      {numbering && (
        <p className="rounded-lg border border-sky-500/40 bg-sky-500/5 p-3 text-sm text-muted-foreground">
          {numbering}
        </p>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Pick the drop and how many garments are in it. The item numbers, SKUs, handles and
          barcodes are computed from there — none of them is typed, and the barcodes are the ones
          already assigned to those numbers, so they match whatever is on the labels.
        </p>
      )}

      {problems.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <p className="font-medium">{problems.length} garment(s) still need something.</p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {problems.slice(0, 6).map((p) => (
              <li key={p.itemNumber}>
                <span className="font-mono">{p.itemNumber}</span> — no {p.problems.join(", no ")}
              </li>
            ))}
            {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["category", "Category"],
              ["price", "Price"],
              ["cost", "Cost"],
              ["originalBrand", "Brand"],
              ["sourceProduct", "Original product"],
              ["tags", "Tags"],
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
      )}

      {/* --- The garments ------------------------------------------------ */}
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
                <div className="flex shrink-0 gap-1.5">
                  {r.photos.length ? (
                    r.photos.map((p) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={p.filename}
                        src={p.url}
                        alt={p.filename}
                        title={p.filename}
                        className="size-24 rounded border object-cover"
                      />
                    ))
                  ) : (
                    <div className="grid size-24 place-items-center rounded border border-dashed text-center text-[11px] leading-tight text-muted-foreground">
                      waiting for
                      <br />
                      the shoot
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-2">
                  {/* Computed identity — read-only, but visible. What is on
                      the label should be legible while describing the item. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => set(r.itemNumber, { include: e.target.checked })}
                      />
                      <span className="font-mono font-medium">{r.itemNumber}</span>
                    </label>
                    <span className={MONO}>{r.variantSku}</span>
                    <span className={MONO}>{r.barcode}</span>
                    <span className={MONO}>{r.handle}</span>
                    <span className="text-xs text-muted-foreground">
                      type mål {measurementType(r)} · {shape}
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
                      list="vintage-categories"
                      placeholder="Kategori"
                      value={r.category}
                      onChange={(e) => set(r.itemNumber, { category: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      list="vintage-brands"
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
                      className={cn(INPUT, "lg:col-span-2")}
                      placeholder="Opprinnelig produkt"
                      value={r.sourceProduct}
                      onChange={(e) => set(r.itemNumber, { sourceProduct: e.target.value })}
                    />
                  </div>

                  {/* Only the measurements this garment's body will print —
                      which is also what decides Type mål. */}
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
                    <input
                      className={cn(INPUT, "col-span-3 lg:col-span-3")}
                      placeholder="Tags, comma separated"
                      value={r.tags}
                      onChange={(e) => set(r.itemNumber, { tags: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <datalist id="vintage-brands">
        {brands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <datalist id="vintage-categories">
        {categoryNames.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {/* --- The four stages --------------------------------------------- */}
      {rows.length > 0 && (
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
              {created.length} created
              {withoutPhotos.length > 0 && ` · ${withoutPhotos.length} still without a photo`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
