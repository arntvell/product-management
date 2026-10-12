"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { ComboInput, type ComboOption } from "@/components/ui/combo-input";
import { normalizeVintageSize } from "@/lib/master/vintage-size";
import type { DraftRowView, DraftSummary, DraftView } from "@/lib/vintage/drafts";

// The drop sheet.
//
// Shaped around how a drop is actually made, which is not the order the old
// spreadsheet implied. The writing comes first and the photographs arrive
// afterwards: the shoot uploads to the share over the course of the day, so a
// row exists, gets its words, and only later gets its pictures. Hence
// "Load photos" is a button you press whenever, not a precondition.
//
// Drops being written are saved in Origo (src/lib/vintage/drafts.ts), several
// at a time, and autosave as they are typed. Four columns are never typed:
// item number, SKU, handle and barcode follow from where the drop sits in the
// numbering, which the server owns — growing an earlier drop renumbers the
// later ones, and Create takes the numbers from the server, not from here.

type Shape = "tops" | "trousers" | "jeans";

interface Photo {
  url: string;
  index: number;
  filename: string;
}

type Row = DraftRowView;

/**
 * Type mål, derived rather than asked for — the operator picks by typing in
 * the right measurement boxes, as they do in the sheet.
 *
 * TOPS IS THE DEFAULT, which is where this differs from the sheet's
 * `=if(isblank(H),2,1)`. Most vintage garments carry a chest width and a front
 * length and nothing else — jackets included — so a blank row is a top until a
 * trouser measurement says otherwise. Defaulting the other way is what let a
 * bomber jacket be written up with a waist: the row demanded Waist/Rise/Inseam
 * before a single measurement had been typed.
 */
function shapeOf(r: Row): Shape {
  const hasBottom =
    r.waist.trim() !== "" || r.frontRise.trim() !== "" || r.inseam.trim() !== "";
  const hasTop = r.chestWidth.trim() !== "" || r.frontLength.trim() !== "";
  if (hasBottom && !hasTop) return r.approxSize.trim() ? "jeans" : "trousers";
  return "tops";
}

/**
 * The title should not carry its own size — the size is appended when the
 * product is named, so typing it produces "… (L) (M)". Warned about rather
 * than silently stripped: only the person writing it knows which is right.
 */
function titleLooksSized(title: string): boolean {
  return /\([^()]{1,12}\)\s*$/.test(title.trim());
}

function measurementType(r: Row): string {
  return shapeOf(r) === "tops" ? "1" : "2";
}

function rowProblems(r: Row): string[] {
  const p: string[] = [];
  if (!r.title.trim()) p.push("no title");
  else if (titleLooksSized(r.title)) p.push("size is already in the title");
  if (!r.description.trim()) p.push("no description");
  if (!r.category.trim()) p.push("no category");
  if (!r.price.trim()) p.push("no price");
  if (!r.taggedSize.trim() && !r.approxSize.trim()) p.push("no size");
  const shape = shapeOf(r);
  if (shape === "tops") {
    if (!r.chestWidth.trim()) p.push("no chest width");
    if (!r.frontLength.trim()) p.push("no front length");
  } else {
    if (!r.waist.trim()) p.push("no waist");
    if (!r.frontRise.trim()) p.push("no front rise");
    if (!r.inseam.trim()) p.push("no inseam");
  }
  return p;
}

/** Has anyone typed anything into this row? Removing it would lose that. */
function rowHasContent(r: Row): boolean {
  return [
    r.title,
    r.description,
    r.category,
    r.originalBrand,
    r.taggedSize,
    r.approxSize,
    r.chestWidth,
    r.frontLength,
    r.waist,
    r.frontRise,
    r.inseam,
    r.composition,
    r.price,
    r.sourceProduct,
  ].some((v) => v.trim() !== "");
}

const INPUT =
  "w-full border bg-background px-2 py-1 text-body outline-none focus:ring-1 focus:ring-ring";
const MONO = "font-mono text-fine text-muted-foreground";
const BTN = "border px-3 py-1.5 text-body transition-colors hover:bg-muted disabled:opacity-40";
const SMALL_BTN = "border px-2.5 py-1 text-fine transition-colors hover:bg-muted disabled:opacity-40";

/** The old browser-only draft, brought across into Origo once. */
const LEGACY_KEY = "vintage-drop-sheet";
const ACTIVE_KEY = "vintage-drop-sheet:active";

type SortKey = "number" | "problems" | "photos" | "category" | "brand" | "price";
const SORTS: [SortKey, string][] = [
  ["number", "Item number"],
  ["problems", "Needs something first"],
  ["photos", "Without photos first"],
  ["category", "Category"],
  ["brand", "Brand"],
  ["price", "Price"],
];

interface Existing {
  id: string;
  itemNumber: string;
  sku: string;
  variantSku: string;
  handle: string;
  barcode: string | null;
  name: string;
  status: string;
  tags: string[];
  category: string | null;
  price: string | null;
  photos: { url: string; position: number; pushed: boolean }[];
  onLoom: boolean;
  onShopify: boolean;
}

export interface SourceProduct {
  name: string;
  sku: string | null;
  category: string | null;
  webCategory: string | null;
  retail: string | null;
  cost: string | null;
}

interface Moved {
  drop: string;
  from: string;
  to: string;
}

function movedMessage(moved: Moved[] | undefined): string | null {
  if (!moved?.length) return null;
  return `Renumbered ${moved.map((m) => `${m.drop} (${m.from} → ${m.to})`).join(", ")}.`;
}

export function VintageDropSheet({
  brands,
  categories,
  sourceProducts,
}: {
  brands: string[];
  categories: { name: string; webCategory: string | null }[];
  sourceProducts: SourceProduct[];
}) {
  const bySource = useMemo(
    () => new Map(sourceProducts.map((p) => [p.name.toLowerCase(), p])),
    [sourceProducts]
  );

  // ---- drafts ---------------------------------------------------------------
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [countInput, setCountInput] = useState("");
  const [newDrop, setNewDrop] = useState("");
  const [newCount, setNewCount] = useState("45");
  const [legacy, setLegacy] = useState<{ drop: string; rows: Partial<Row>[] } | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "pending" | "saving" | "error">("saved");
  const [sort, setSort] = useState<SortKey>("number");

  // ---- created garments -----------------------------------------------------
  const [busy, setBusy] = useState<string | null>(null);
  // The drop the stage buttons act on: the open draft's, or one loaded by name.
  const [dropName, setDropName] = useState("");
  const [created, setCreated] = useState<string[] | null>(null);
  // Garments already in the master for this drop. Separate from `rows`, which
  // are being written: these exist, and the only questions left are whether
  // they have reached Loom and Shopify.
  const [existing, setExisting] = useState<Existing[] | null>(null);

  // Autosave bookkeeping. `revision` is the server's, and a save names it so a
  // stale tab cannot overwrite a resize made elsewhere.
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;

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

  const refreshDrafts = useCallback(async () => {
    const res = await fetch("/api/vintage/drafts");
    const json = await res.json().catch(() => ({}));
    if (res.ok) setDrafts(json.drafts);
    return (json.drafts ?? []) as DraftSummary[];
  }, []);

  const adopt = useCallback((d: DraftView | null) => {
    setDraft(d);
    setRows(d?.rows ?? []);
    setCountInput(d ? String(d.rows.length) : "");
    revisionRef.current = d?.revision ?? 0;
    dirtyRef.current = false;
    setSaveState("saved");
    if (d) {
      setDropName(d.drop);
      try {
        localStorage.setItem(ACTIVE_KEY, d.id);
      } catch {
        /* a convenience only */
      }
    }
  }, []);

  const openDraft = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/vintage/drafts/${id}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error ?? "Could not open the drop");
        return;
      }
      adopt(json.draft);
      setCreated(null);
      setExisting(null);
    },
    [adopt]
  );

  // First load: the list, the drop last open here, and any browser-only draft
  // from before drafts were saved in Origo.
  useEffect(() => {
    let alive = true;
    (async () => {
      const list = await refreshDrafts();
      if (!alive) return;
      let last: string | null = null;
      try {
        last = localStorage.getItem(ACTIVE_KEY);
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.drop && Array.isArray(s.rows) && s.rows.length) {
            if (list.some((d) => d.drop.toLowerCase() === String(s.drop).trim().toLowerCase()))
              localStorage.removeItem(LEGACY_KEY);
            else setLegacy({ drop: String(s.drop).trim(), rows: s.rows });
          }
        }
      } catch {
        /* nothing to bring across */
      }
      const pick = list.find((d) => d.id === last) ?? list[0];
      if (pick) await openDraft(pick.id);
    })();
    return () => {
      alive = false;
    };
  }, [refreshDrafts, openDraft]);

  // ---- autosave -------------------------------------------------------------
  const save = useCallback(async () => {
    if (!draft || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/vintage/drafts/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: revisionRef.current,
          // Content only — the server keeps the numbers and which rows exist.
          rows: rowsRef.current.map((r) => ({
            rowId: r.rowId,
            include: r.include,
            photos: r.photos,
            title: r.title,
            description: r.description,
            category: r.category,
            sourceProduct: r.sourceProduct,
            originalBrand: r.originalBrand,
            taggedSize: r.taggedSize,
            approxSize: r.approxSize,
            chestWidth: r.chestWidth,
            frontLength: r.frontLength,
            waist: r.waist,
            frontRise: r.frontRise,
            inseam: r.inseam,
            composition: r.composition,
            price: r.price,
            cost: r.cost,
            tags: r.tags,
          })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        toast.warning(json.error ?? "This drop changed elsewhere — reloaded it.");
        await openDraft(draft.id);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      revisionRef.current = json.revision;
      setSaveState(dirtyRef.current ? "pending" : "saved");
    } catch (err) {
      dirtyRef.current = true;
      setSaveState("error");
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      savingRef.current = false;
    }
  }, [draft, openDraft]);

  // Debounced: a save shortly after typing stops, and again if more was typed
  // while one was in flight.
  useEffect(() => {
    if (saveState !== "pending") return;
    const t = setTimeout(() => void save(), 800);
    return () => clearTimeout(t);
  }, [rows, saveState, save]);

  const edit = useCallback((fn: (rs: Row[]) => Row[]) => {
    setRows(fn);
    dirtyRef.current = true;
    setSaveState("pending");
  }, []);

  const set = useCallback(
    (rowId: string, patch: Partial<Row>) => edit((rs) => rs.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r))),
    [edit]
  );

  /** Anything unsaved goes before an action that reloads the drop. */
  async function flush() {
    if (dirtyRef.current) await save();
  }

  // ---- draft actions --------------------------------------------------------
  async function onNewDrop(from?: { drop: string; rows: Partial<Row>[] }) {
    const drop = (from?.drop ?? newDrop).trim();
    const n = from ? from.rows.length : Number(newCount);
    if (!drop) return toast.error("Which drop? e.g. DROP 190");
    if (!Number.isInteger(n) || n < 1) return toast.error("How many garments?");
    await flush();
    const json = await call("New drop", "/api/vintage/drafts", {
      drop,
      count: n,
      ...(from ? { rows: from.rows } : {}),
    });
    if (!json) return;
    adopt(json.draft);
    setCreated(null);
    setExisting(null);
    setNewDrop("");
    await refreshDrafts();
    if (from) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        /* fine */
      }
      setLegacy(null);
      toast.success(`${drop} is saved in Origo now. Its numbers were checked again — load the photos once more.`);
    } else toast.success(`${drop} started: ${json.draft.rows[0].itemNumber}–${json.draft.rows.at(-1).itemNumber}.`);
    if (json.beyondPreassigned)
      toast.warning(
        `${json.beyondPreassigned} number(s) are past the sheet's pre-assigned range — their barcodes are extrapolated, not recorded.`
      );
  }

  async function onResize() {
    if (!draft) return;
    const n = Number(countInput);
    if (!Number.isInteger(n) || n < 1) return toast.error("How many garments?");
    if (n === rows.length) return;
    const losing = rows.slice(n).filter(rowHasContent);
    const later = (drafts ?? []).filter((d) => d.id !== draft.id && (d.first ?? 0) > Number(rows[0]?.itemNumber ?? 0));
    const msg = [
      n < rows.length
        ? `Take the last ${rows.length - n} garment(s) off ${draft.drop}?` +
          (losing.length ? ` ${losing.length} of them have been written up: ${losing.map((r) => r.itemNumber).join(", ")}.` : "")
        : `Add ${n - rows.length} garment(s) to ${draft.drop}?`,
      later.length
        ? `${later.map((d) => d.drop).join(", ")} will be renumbered to follow on, barcodes included.`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!confirm(msg)) return setCountInput(String(rows.length));
    await flush();
    const json = await call("Resize", `/api/vintage/drafts/${draft.id}/resize`, { count: n });
    if (!json) return;
    adopt(json.draft);
    await refreshDrafts();
    toast.success([`${draft.drop} now has ${n}.`, movedMessage(json.moved)].filter(Boolean).join(" "));
  }

  async function onRemoveRow(r: Row) {
    if (!draft) return;
    if (
      !confirm(
        `Take ${r.itemNumber}${r.title ? ` — ${r.title}` : ""} out of ${draft.drop}?\n\n` +
          "The garments after it, and any drops after this one, move up a number — barcodes included."
      )
    )
      return;
    await flush();
    const json = await call("Remove", `/api/vintage/drafts/${draft.id}/remove-rows`, { rowIds: [r.rowId] });
    if (!json) return;
    if (json.draft) adopt(json.draft);
    else adopt(null);
    await refreshDrafts();
    toast.success([`Removed ${r.itemNumber}.`, movedMessage(json.moved)].filter(Boolean).join(" "));
  }

  async function onDeleteDraft() {
    if (!draft) return;
    if (!confirm(`Discard the draft of ${draft.drop} (${rows.length} garments)? Nothing in it has been created.`)) return;
    const json = await call("Discard", `/api/vintage/drafts/${draft.id}`, undefined, "DELETE");
    if (!json) return;
    adopt(null);
    const list = await refreshDrafts();
    toast.success([`${draft.drop} discarded.`, movedMessage(json.moved)].filter(Boolean).join(" "));
    if (list[0]) await openDraft(list[0].id);
  }

  async function onClearNotice() {
    if (!draft) return;
    await flush();
    const res = await fetch(`/api/vintage/drafts/${draft.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: revisionRef.current, rows: [], clearNotice: true }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      revisionRef.current = json.revision;
      setDraft((d) => (d ? { ...d, notice: null } : d));
      void refreshDrafts();
    } else await openDraft(draft.id);
  }

  // ---- rows -----------------------------------------------------------------

  /**
   * Choosing the store product an online garment came out of.
   *
   * It supplies the economics, which is what "category fills in the price"
   * means: the category's retail becomes this garment's price, and its average
   * cost becomes the cost. Both are DEFAULTS — in the sheet's own history
   * roughly two thirds of recent garments sell at the category's retail and a
   * third are priced up — so anything already typed is left alone.
   */
  const pickSource = useCallback(
    (rowId: string, name: string) => {
      const p = bySource.get(name.trim().toLowerCase());
      edit((rs) =>
        rs.map((r) => {
          if (r.rowId !== rowId) return r;
          const next: Row = { ...r, sourceProduct: name };
          if (!p) return next;
          if (!r.category.trim()) next.category = p.webCategory || p.category || "";
          if (!r.price.trim() && p.retail) next.price = String(Math.round(Number(p.retail)));
          if (!r.cost.trim() && p.cost) next.cost = p.cost;
          return next;
        })
      );
    },
    [bySource, edit]
  );

  /**
   * Paste rows straight out of the INPUT sheet.
   *
   * The columns are the sheet's, in the sheet's order, so a block can be
   * copied from Excel and dropped in. Nummer is matched rather than trusted as
   * a position: a paste that skips a row, or starts halfway down, still lands
   * on the right garments. Rows whose number is not in this drop are reported
   * instead of silently ignored — which is also what a paste made before a
   * renumber looks like.
   *
   *   Nummer  Tittel  Beskrivelse  Kategori  Opprinnelig  Retail  Pris nett
   *   Chest   Front   Størrelse    Waist     Rise         Inseam  Approx  ...
   */
  const applyPaste = useCallback(
    (text: string) => {
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (!lines.length) return { applied: 0, unknown: [] as string[] };
      // A header row is common when copying with the titles; drop it.
      const start = /^\s*nummer\b/i.test(lines[0]) ? 1 : 0;
      const unknown: string[] = [];
      const updates = new Map<string, Partial<Row>>();
      const byNumber = new Map(rowsRef.current.map((r) => [r.itemNumber, r]));
      const num = (v: string | undefined) => (v || "").replace(/\.0+$/, "");
      for (const line of lines.slice(start)) {
        const c = line.split("\t").map((x) => x.trim());
        const n = num(c[0]);
        if (!n) continue;
        const row = byNumber.get(n);
        if (!row) {
          unknown.push(n);
          continue;
        }
        updates.set(row.rowId, {
          title: c[1] || row.title,
          description: c[2] || row.description,
          category: c[3] || row.category,
          sourceProduct: c[4] || row.sourceProduct,
          price: num(c[6]) || row.price,
          chestWidth: num(c[7]) || row.chestWidth,
          frontLength: num(c[8]) || row.frontLength,
          taggedSize: normalizeVintageSize(c[9]) || row.taggedSize,
          waist: num(c[10]) || row.waist,
          frontRise: num(c[11]) || row.frontRise,
          inseam: num(c[12]) || row.inseam,
          approxSize: normalizeVintageSize(c[13]) || row.approxSize,
          originalBrand: c[17] || row.originalBrand,
        });
      }
      if (updates.size) edit((rs) => rs.map((r) => (updates.has(r.rowId) ? { ...r, ...updates.get(r.rowId) } : r)));
      return { applied: updates.size, unknown };
    },
    [edit]
  );

  const selectAll = useCallback((include: boolean) => edit((rs) => rs.map((r) => ({ ...r, include }))), [edit]);

  /**
   * Keep only the garments the shoot has actually photographed.
   *
   * The common shape of a drop day: the writing is done for all 45, the
   * upload is halfway, and you want to push what is ready without hand-
   * unticking twenty rows.
   */
  const selectPhotographed = useCallback(
    () => edit((rs) => rs.map((r) => ({ ...r, include: r.photos.length > 0 }))),
    [edit]
  );

  /** Copy the first selected row's value to every selected row — in the order shown. */
  const fillDown = useCallback(
    (field: keyof Row, order: Row[]) => {
      const first = order.find((r) => r.include);
      if (!first) return;
      const v = first[field];
      edit((rs) => rs.map((r) => (r.include ? ({ ...r, [field]: v } as Row) : r)));
    },
    [edit]
  );

  /** Re-read the share and attach whatever has been uploaded since. */
  async function onLoadPhotos() {
    const json = await call("Load photos", "/api/vintage/photos", undefined, "GET");
    if (!json) return;
    const byNumber = new Map<string, Photo[]>(
      (json.items as { itemNumber: string; photos: Photo[] }[]).map((i) => [i.itemNumber, i.photos])
    );
    const matched = rows.filter((r) => byNumber.get(r.itemNumber)?.length).length;
    const still = rows.filter((r) => r.include && !byNumber.get(r.itemNumber)?.length).length;
    edit((rs) =>
      rs.map((r) => {
        const p = byNumber.get(r.itemNumber);
        return p?.length ? { ...r, photos: p } : r;
      })
    );
    toast.success(`${matched} garment(s) have photos on the share${still ? `; ${still} still waiting` : ""}.`);
  }

  // ---- created garments -----------------------------------------------------

  async function onReveal() {
    if (!created?.length) return;
    const json = await call("Reveal", "/api/vintage/reveal", { colorwayIds: created });
    if (!json) return;
    const w = (json.warnings ?? []) as string[];
    if (w.length) toast.warning(w[0]);
    toast.success(
      `Untagged ${json.untagged?.length ?? 0}, published ${json.published?.length ?? 0} to sales channels.`
    );
  }

  async function onSchedule() {
    if (!dropName.trim()) return toast.error("Which drop?");
    const when = prompt(
      `Open ${dropName.trim()} at? Local time, e.g. 2026-09-26 17:00`,
      new Date(Date.now() + 864e5).toISOString().slice(0, 16).replace("T", " ")
    );
    if (!when) return;
    const at = new Date(when.replace(" ", "T"));
    if (Number.isNaN(at.getTime())) return toast.error("Could not read that date.");
    const json = await call("Schedule", "/api/vintage/schedule", {
      drop: dropName.trim(),
      revealAt: at.toISOString(),
    });
    if (json) toast.success(`${dropName.trim()} opens ${at.toLocaleString()}.`);
  }

  /**
   * Pull back a drop that has already been created.
   *
   * Creating and pushing are not one act: a create can succeed and a push
   * fail, and photographs arrive through the day. Without this the sheet
   * could only push what it had created in the same browser session, so a
   * failed push left the drop stranded.
   */
  async function onLoadDrop(name = dropName) {
    if (!name.trim()) return toast.error("Which drop?");
    const json = await call(
      "Load drop",
      `/api/vintage/drops/${encodeURIComponent(name.trim())}`,
      undefined,
      "GET"
    );
    if (!json) return;
    setExisting(json.garments as Existing[]);
    setCreated((json.garments as Existing[]).map((g) => g.id));
    if (!json.garments.length) toast.info(`Nothing created for ${name.trim()} yet.`);
    else
      toast.success(
        `${json.garments.length} garment(s) in ${name.trim()} — ` +
          `${json.garments.filter((g: Existing) => g.onLoom).length} on Loom, ` +
          `${json.garments.filter((g: Existing) => g.onShopify).length} on Shopify.`
      );
  }

  /**
   * Attach the share's photographs to garments already in the master.
   *
   * The counterpart to "Load photos" for rows being written. Separate because
   * the target is different — these garments exist, so the pictures go into
   * MediaAsset rather than into the draft — and because it is pressed
   * repeatedly through the day as the shoot works through the rail.
   */
  async function onAttachPhotos() {
    if (!dropName.trim()) return toast.error("Which drop?");
    const json = await call("Attach photos", "/api/vintage/photos/attach", { drop: dropName.trim() });
    if (!json) return;
    toast.success(
      `Attached ${json.attached} photo(s) to ${json.garments} garment(s).` +
        (json.stillWaiting?.length ? ` ${json.stillWaiting.length} still unphotographed.` : "")
    );
    if (json.photosWithoutRows?.length)
      toast.warning(
        `${json.photosWithoutRows.length} photo(s) on the share have no garment: ` +
          json.photosWithoutRows.slice(0, 10).join(", ")
      );
    await onLoadDrop();
  }

  async function onDelete(g: Existing) {
    if (!confirm(`Delete ${g.sku} — ${g.name}? Its item number and barcode stay bound, so re-entering ${g.itemNumber} gets the same code back.`))
      return;
    const json = await call("Delete", `/api/vintage/garments/${g.id}`, undefined, "DELETE");
    if (!json) return;
    setExisting((xs) => (xs ?? []).filter((x) => x.id !== g.id));
    setCreated((c) => (c ?? []).filter((id) => id !== g.id));
    toast.success(`Deleted ${json.deleted}. Enter it again when you are ready.`);
  }

  const included = rows.filter((r) => r.include);
  const problems = included.flatMap((r) => {
    const p = rowProblems(r);
    return p.length ? [{ itemNumber: r.itemNumber, problems: p }] : [];
  });
  const withoutPhotos = included.filter((r) => !r.photos.length);
  const ready = !!draft && included.length > 0 && problems.length === 0;

  async function onCreate() {
    if (!draft) return;
    await flush();
    const json = await call("Create", "/api/vintage/drops", {
      draftId: draft.id,
      drop: draft.drop,
      items: included.map((r) => ({
        rowId: r.rowId,
        // Both re-taken from the server's numbering; sent for the validator.
        itemNumber: r.itemNumber,
        barcode: r.barcode,
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
        composition: r.composition || null,
        measurementType: measurementType(r),
        originalBrand: r.originalBrand || null,
        tags: r.tags.split(",").map((t) => t.trim()).filter(Boolean),
        photoUrls: r.photos.map((p) => p.url),
      })),
    });
    if (!json) return;
    const name = draft.drop;
    toast.success(
      `Created ${json.created} garment(s) in ${name}.` +
        (json.draftRemaining ? ` ${json.draftRemaining} unticked garment(s) stay in the draft.` : "")
    );
    if (json.draftRemaining) await openDraft(draft.id);
    else adopt(null);
    await refreshDrafts();
    setDropName(name);
    await onLoadDrop(name);
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
    const unphotographed = (existing ?? []).filter((g) => !g.photos.length).length;
    if (unphotographed)
      return toast.error(
        `${unphotographed} garment(s) still have no photo. Attach photos first — Shopify will refuse them anyway.`
      );
    const json = await call("Push to Shopify", "/api/catalog/push/shopify/bulk", {
      colorwayIds: created,
      seasonCode: "CONTINUITY",
    });
    if (!json) return;
    const failed = (json.results ?? []).filter((r: { ok: boolean }) => !r.ok).length;
    const warned = (json.results ?? []).flatMap((r: { warnings?: string[] }) => r.warnings ?? []);
    if (failed) toast.error(`Pushed ${json.ok}/${json.total} to Shopify — ${failed} failed.`);
    else if (warned.length) toast.warning(`Pushed to Shopify with ${warned.length} warning(s): ${warned.slice(0, 3).join(" · ")}`);
    else toast.success("Pushed to Shopify.");

    // Stage them on the sales channels now, while the tags still hide them.
    // Doing it here rather than at reveal means a failure shows up hours
    // before the drop opens instead of while it is opening.
    const ch = await call("Publish to channels", "/api/vintage/channels", {
      colorwayIds: created,
    });
    if (ch)
      toast.success(
        `Staged ${ch.published}/${ch.requested} on the sales channels — still hidden by their tags.`
      );
  }

  async function onMoveToTop() {
    if (!created?.length) return;
    const json = await call("Move to top", "/api/vintage/collection/top", { colorwayIds: created });
    if (json)
      toast.success(
        `Moved ${json.moved} to the top of the Vintage collection${json.settled ? "" : " (still settling)"}.`
      );
  }

  // ---- view -----------------------------------------------------------------

  // Sorting is a view: the stored order, the numbers and Create are untouched.
  const shown = useMemo(() => {
    if (sort === "number") return rows;
    const key = (r: Row): [number, string | number] => {
      switch (sort) {
        case "problems":
          return [rowProblems(r).length ? 0 : 1, Number(r.itemNumber)];
        case "photos":
          return [r.photos.length ? 1 : 0, Number(r.itemNumber)];
        case "category":
          return [r.category.trim() ? 0 : 1, r.category.toLowerCase()];
        case "brand":
          return [r.originalBrand.trim() ? 0 : 1, r.originalBrand.toLowerCase()];
        case "price":
          return [r.price.trim() ? 0 : 1, Number(r.price) || 0];
        default:
          return [0, Number(r.itemNumber)];
      }
    };
    return [...rows].sort((a, b) => {
      const [a1, a2] = key(a);
      const [b1, b2] = key(b);
      if (a1 !== b1) return a1 - b1;
      if (a2 < b2) return -1;
      if (a2 > b2) return 1;
      return Number(a.itemNumber) - Number(b.itemNumber);
    });
  }, [rows, sort]);

  const brandOptions = useMemo<ComboOption[]>(() => brands.map((b) => ({ value: b })), [brands]);
  const categoryOptions = useMemo<ComboOption[]>(
    () => categories.map((c) => ({ value: c.name })),
    [categories]
  );
  const sourceOptions = useMemo<ComboOption[]>(
    () =>
      sourceProducts.map((p) => ({
        value: p.name,
        hint: [p.webCategory ?? p.category, p.retail ? `${Math.round(Number(p.retail))} kr` : null]
          .filter(Boolean)
          .join(" · "),
      })),
    [sourceProducts]
  );

  const sizeInput = (r: Row, field: "taggedSize" | "approxSize", placeholder: string) => (
    <input
      className={INPUT}
      placeholder={placeholder}
      value={r[field]}
      onChange={(e) => set(r.rowId, { [field]: e.target.value })}
      // One spelling per size (M, XL, 2XL, One Size, S/M) — shown as soon as
      // the box is left, so nobody has to remember the house style.
      onBlur={(e) => {
        const v = normalizeVintageSize(e.target.value);
        if (v !== r[field]) set(r.rowId, { [field]: v });
      }}
    />
  );

  return (
    <div className="space-y-6">
      {/* --- Drops in progress --------------------------------------------- */}
      <div className="space-y-3 border p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(drafts ?? []).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={async () => {
                await flush();
                await openDraft(d.id);
              }}
              className={cn(
                "border px-3 py-1.5 text-left text-body transition-colors",
                draft?.id === d.id ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
              )}
            >
              <span>{d.drop}</span>
              <span className={cn("ml-2 text-fine", draft?.id === d.id ? "text-background/70" : "text-muted-foreground")}>
                {d.count} · {d.first}–{d.last}
                {d.notice ? " · renumbered" : ""}
              </span>
            </button>
          ))}
          {drafts?.length === 0 && (
            <span className="text-body text-muted-foreground">No drops in progress.</span>
          )}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onNewDrop();
          }}
        >
          <label className="text-body">
            <span className="mb-1 block text-fine text-muted-foreground">New drop</span>
            <input
              className={cn(INPUT, "w-32")}
              placeholder="DROP 190"
              value={newDrop}
              onChange={(e) => setNewDrop(e.target.value)}
            />
          </label>
          <label className="text-body">
            <span className="mb-1 block text-fine text-muted-foreground">Garments</span>
            <input
              className={cn(INPUT, "w-20")}
              inputMode="numeric"
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy !== null || !newDrop.trim()} className={BTN}>
            {busy === "New drop" ? "Reserving…" : "Start drop"}
          </button>
          <span className="max-w-md text-fine text-muted-foreground">
            Numbers follow on after every drop already started, so several can be written at once.
          </span>
        </form>
        {legacy && (
          <div className="flex flex-wrap items-center gap-3 border border-ink bg-paper p-3 text-body">
            <span>
              {legacy.drop} ({legacy.rows.length} garments) was written in this browser before drops were
              saved in Origo.
            </span>
            <button type="button" className={SMALL_BTN} disabled={busy !== null} onClick={() => onNewDrop(legacy)}>
              Save it in Origo
            </button>
            <button
              type="button"
              className={SMALL_BTN}
              onClick={() => {
                if (!confirm(`Throw away the browser copy of ${legacy.drop}?`)) return;
                try {
                  localStorage.removeItem(LEGACY_KEY);
                } catch {
                  /* fine */
                }
                setLegacy(null);
              }}
            >
              Discard
            </button>
          </div>
        )}
      </div>

      {/* --- Created drops --------------------------------------------------- */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-body">
          <span className="mb-1 block text-fine text-muted-foreground">Created drop</span>
          <input
            className={cn(INPUT, "w-32")}
            placeholder="DROP 189"
            value={dropName}
            onChange={(e) => setDropName(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => onLoadDrop()}
          disabled={busy !== null}
          className={BTN}
          title="Pull back garments already created for this drop, to push or fix them"
        >
          {busy === "Load drop" ? "Loading…" : "Load created garments"}
        </button>
      </div>

      {existing && existing.length > 0 && (
        <div className="border p-4">
          <p className="mb-3 text-body">
            {existing.length} garment(s) already created in {dropName.trim()}
          </p>
          <div className="space-y-1.5">
            {existing.map((g) => (
              <div
                key={g.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border px-2 py-1.5 text-body"
              >
                <span className="font-mono text-fine">{g.itemNumber}</span>
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className={MONO}>{g.barcode}</span>
                <span className="text-fine text-muted-foreground">
                  {g.photos.length} photo{g.photos.length === 1 ? "" : "s"}
                </span>
                <StatusBadge
                  status={g.onLoom ? "live" : "draft"}
                  label={g.onLoom ? "On Loom" : "Not on Loom"}
                />
                <StatusBadge
                  status={g.onShopify ? "live" : "draft"}
                  label={g.onShopify ? "On Shopify" : "Not on Shopify"}
                />
                <button
                  type="button"
                  onClick={() => onDelete(g)}
                  disabled={busy !== null || g.onShopify}
                  title={
                    g.onShopify
                      ? "Live on Shopify — archive it there first"
                      : "Delete so it can be entered again"
                  }
                  className="border px-2 py-0.5 text-fine transition-colors hover:bg-muted disabled:opacity-40"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onAttachPhotos} disabled={busy !== null} className={BTN}>
              {busy === "Attach photos" ? "Reading share…" : "Attach photos from share"}
            </button>
            <span className="text-fine text-muted-foreground">
              {existing.filter((g) => g.photos.length).length} of {existing.length} photographed
            </span>
          </div>
          <p className="mt-3 text-fine text-muted-foreground">
            The buttons at the bottom act on these. An item number stays bound to its barcode, so
            deleting and re-entering the same number gets the same code back.
          </p>
        </div>
      )}

      {/* --- The open draft ------------------------------------------------- */}
      {draft && (
        <div className="flex flex-wrap items-end gap-3 border-t pt-4">
          <div>
            <h2 className="text-section">{draft.drop}</h2>
            <p className="text-fine text-muted-foreground">
              {rows[0]?.itemNumber}–{rows.at(-1)?.itemNumber} · {included.length} of {rows.length} selected ·{" "}
              {included.length - withoutPhotos.length}/{included.length} photographed ·{" "}
              {saveState === "saved"
                ? "saved"
                : saveState === "saving"
                  ? "saving…"
                  : saveState === "error"
                    ? "not saved — retrying on the next edit"
                    : "unsaved"}
            </p>
          </div>
          <label className="ml-auto text-body">
            <span className="mb-1 block text-fine text-muted-foreground">Garments</span>
            <span className="flex gap-1.5">
              <input
                className={cn(INPUT, "w-20")}
                inputMode="numeric"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void onResize()}
              />
              <button
                type="button"
                className={SMALL_BTN}
                disabled={busy !== null || countInput === String(rows.length)}
                onClick={onResize}
              >
                {busy === "Resize" ? "…" : "Apply"}
              </button>
            </span>
          </label>
          <button type="button" onClick={onLoadPhotos} disabled={busy !== null} className={BTN}>
            {busy === "Load photos" ? "Reading share…" : "Load photos from share"}
          </button>
          <button type="button" onClick={onDeleteDraft} disabled={busy !== null} className={BTN}>
            Discard draft
          </button>
        </div>
      )}

      {draft?.notice && (
        <div className="flex flex-wrap items-center gap-3 border border-ink bg-paper p-3 text-body">
          <span className="flex-1">{draft.notice}</span>
          <button type="button" className={SMALL_BTN} onClick={onClearNotice}>
            Got it
          </button>
        </div>
      )}

      {!draft && drafts !== null && (
        <p className="text-body text-muted-foreground">
          Start a drop with its name and how many garments are in it. The item numbers, SKUs, handles
          and barcodes are computed from there — none of them is typed, and the barcodes are the ones
          already assigned to those numbers, so they match whatever is on the labels.
        </p>
      )}

      {problems.length > 0 && (
        <div className="border border-ink bg-paper p-4 text-body">
          <p className="text-meta uppercase">
            {problems.length} garment{problems.length === 1 ? "" : "s"} still need something
          </p>
          <ul className="mt-2 space-y-0.5 text-muted-foreground">
            {problems.slice(0, 6).map((p) => (
              <li key={p.itemNumber}>
                <span className="font-mono">{p.itemNumber}</span> — {p.problems.join(", ")}
              </li>
            ))}
            {problems.length > 6 && <li>…and {problems.length - 6} more</li>}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <details className="border p-3">
          <summary className="cursor-pointer text-body">Paste from the INPUT sheet</summary>
          <p className="mt-2 text-fine text-muted-foreground">
            Copy a block of rows out of Excel and paste it here — the sheet&rsquo;s own columns, in
            its own order, header row optional. Rows are matched on Nummer rather than position, so
            a partial paste still lands on the right garments.
          </p>
          <textarea
            className={cn(INPUT, "mt-2 min-h-[6rem] font-mono text-fine")}
            placeholder="13763&#9;Disneyland Epcot Bomber Jacket&#9;100% cotton…&#9;Jacket&#9;Bomber jacket&#9;499&#9;499&#9;60&#9;72&#9;L…"
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (!text.includes("\t")) return;
              e.preventDefault();
              const { applied, unknown } = applyPaste(text);
              if (applied) toast.success(`Filled ${applied} garment(s) from the sheet.`);
              if (unknown.length)
                toast.warning(
                  `${unknown.length} row(s) are not in this drop: ${unknown.slice(0, 8).join(", ")}`
                );
              if (!applied && !unknown.length) toast.error("Nothing recognisable in that paste.");
            }}
          />
        </details>
      )}

      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => selectAll(true)} className={SMALL_BTN}>
            Select all
          </button>
          <button type="button" onClick={() => selectAll(false)} className={SMALL_BTN}>
            Select none
          </button>
          <button
            type="button"
            onClick={selectPhotographed}
            disabled={!rows.some((r) => r.photos.length)}
            className={SMALL_BTN}
            title="Keep only the garments the shoot has uploaded"
          >
            Select photographed
          </button>
          <span className="mr-1 text-fine text-muted-foreground">
            {included.length} of {rows.length}
          </span>
          <span className="h-4 w-px bg-border" aria-hidden />
          {(
            [
              ["category", "Category"],
              ["price", "Price"],
              ["cost", "Cost"],
              ["originalBrand", "Brand"],
              ["sourceProduct", "Original product"],
              ["composition", "Composition"],
              ["tags", "Tags"],
            ] as const
          ).map(([field, label]) => (
            <button key={field} type="button" onClick={() => fillDown(field, shown)} className={SMALL_BTN}>
              Fill {label} down
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 text-fine text-muted-foreground">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="border bg-background px-2 py-1 text-fine text-foreground"
            >
              {SORTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* --- The garments ------------------------------------------------ */}
      <div className="space-y-3">
        {shown.map((r) => {
          const shape = shapeOf(r);
          const probs = r.include ? rowProblems(r) : [];
          const top = shape === "tops" && "ring-1 ring-ring/40";
          const bottom = shape !== "tops" && "ring-1 ring-ring/40";
          return (
            <div
              key={r.rowId}
              className={cn(
                "border border-line bg-paper p-3",
                !r.include && "opacity-50",
                probs.length > 0 && "border-ink"
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
                        className="size-24 border object-cover"
                      />
                    ))
                  ) : (
                    <div className="grid size-24 place-items-center border border-dashed text-center text-fine leading-tight text-muted-foreground">
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
                    <label className="flex items-center gap-1.5 text-body">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => set(r.rowId, { include: e.target.checked })}
                      />
                      <span className="font-mono">{r.itemNumber}</span>
                    </label>
                    <span className={MONO}>{r.variantSku}</span>
                    <span className={MONO}>{r.barcode}</span>
                    <span className={MONO}>{r.handle}</span>
                    <span className="text-fine text-muted-foreground">
                      type mål {measurementType(r)} · {shape}
                    </span>
                    {probs.length > 0 && (
                      <span className="text-meta normal-case tracking-normal text-ink">
                        {probs.join(", ")}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveRow(r)}
                      disabled={busy !== null}
                      className="ml-auto text-fine text-muted-foreground underline-offset-4 hover:underline disabled:opacity-40"
                      title="Take this garment out of the drop; the numbers after it close up"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <input
                      className={cn(INPUT, "lg:col-span-2")}
                      placeholder="Tittel"
                      value={r.title}
                      onChange={(e) => set(r.rowId, { title: e.target.value })}
                    />
                    <ComboInput
                      inputClassName={INPUT}
                      options={categoryOptions}
                      placeholder="Kategori"
                      value={r.category}
                      onChange={(v) => set(r.rowId, { category: v })}
                    />
                    <ComboInput
                      inputClassName={INPUT}
                      options={brandOptions}
                      placeholder="BRAND"
                      value={r.originalBrand}
                      onChange={(v) => set(r.rowId, { originalBrand: v })}
                    />
                  </div>

                  <textarea
                    className={cn(INPUT, "min-h-[3rem] resize-y")}
                    placeholder="Beskrivelse — opens the product body"
                    value={r.description}
                    onChange={(e) => set(r.rowId, { description: e.target.value })}
                  />

                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <input
                      className={INPUT}
                      placeholder="Pris nett"
                      value={r.price}
                      onChange={(e) => set(r.rowId, { price: e.target.value })}
                    />
                    <input
                      className={INPUT}
                      placeholder="Cost"
                      value={r.cost}
                      onChange={(e) => set(r.rowId, { cost: e.target.value })}
                    />
                    <ComboInput
                      className="col-span-2"
                      inputClassName={INPUT}
                      options={sourceOptions}
                      placeholder="Opprinnelig produkt — fills price & cost"
                      value={r.sourceProduct}
                      onChange={(v) => pickSource(r.rowId, v)}
                    />
                  </div>

                  {/* Measurements in the order they are taken off the
                      garment, with its size between the top's and the
                      bottom's. BOTH groups are always shown, as in the
                      spreadsheet: showing one and guessing which from what is
                      filled is how a jacket got written up with a waist
                      (13763). Type mål follows from whichever group is
                      filled. */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
                    <Field label="Chest width">
                      <input
                        className={cn(INPUT, top)}
                        placeholder="cm"
                        value={r.chestWidth}
                        onChange={(e) => set(r.rowId, { chestWidth: e.target.value })}
                      />
                    </Field>
                    <Field label="Front length">
                      <input
                        className={cn(INPUT, top)}
                        placeholder="cm"
                        value={r.frontLength}
                        onChange={(e) => set(r.rowId, { frontLength: e.target.value })}
                      />
                    </Field>
                    <Field label="Størrelse">{sizeInput(r, "taggedSize", "L")}</Field>
                    <Field label="Approx size">{sizeInput(r, "approxSize", "M")}</Field>
                    <Field label="Waist">
                      <input
                        className={cn(INPUT, bottom)}
                        placeholder="cm"
                        value={r.waist}
                        onChange={(e) => set(r.rowId, { waist: e.target.value })}
                      />
                    </Field>
                    <Field label="Front rise">
                      <input
                        className={cn(INPUT, bottom)}
                        placeholder="cm"
                        value={r.frontRise}
                        onChange={(e) => set(r.rowId, { frontRise: e.target.value })}
                      />
                    </Field>
                    <Field label="Inseam">
                      <input
                        className={cn(INPUT, bottom)}
                        placeholder="cm"
                        value={r.inseam}
                        onChange={(e) => set(r.rowId, { inseam: e.target.value })}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Field label="Composition">
                      <input
                        className={INPUT}
                        placeholder="100% cotton"
                        value={r.composition}
                        onChange={(e) => set(r.rowId, { composition: e.target.value })}
                      />
                    </Field>
                    <Field label="Tags">
                      <input
                        className={INPUT}
                        placeholder="Comma separated"
                        value={r.tags}
                        onChange={(e) => set(r.rowId, { tags: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- The four stages --------------------------------------------- */}
      {(rows.length > 0 || (existing?.length ?? 0) > 0) && (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <button
            type="button"
            disabled={!ready || busy !== null || rows.length === 0}
            onClick={onCreate}
            className="border bg-foreground px-3 py-1.5 text-body text-background disabled:opacity-40"
          >
            {busy === "Create" ? "Creating…" : `Create ${included.length} in Origo`}
          </button>
          <span className="text-muted-foreground">→</span>
          {/* Shopify before Loom: Loom's registry needs the InventoryItem ids the
              Shopify push returns. The bulk push re-sends anything already in
              Loom, so the other order heals too — this one just needs no second trip. */}
          <button
            type="button"
            disabled={!created?.length || busy !== null}
            onClick={onPushShopify}
            className="border px-3 py-1.5 text-body disabled:opacity-40"
          >
            {busy === "Push to Shopify" ? "Pushing…" : "Push to Shopify"}
          </button>
          <span className="text-muted-foreground">→</span>
          <button
            type="button"
            disabled={!created?.length || busy !== null}
            onClick={onPushLoom}
            className="border px-3 py-1.5 text-body disabled:opacity-40"
          >
            {busy === "Push to Loom" ? "Sending…" : "Push to Loom"}
          </button>
          <span className="text-muted-foreground">→</span>
          <button
            type="button"
            disabled={!created?.length || busy !== null}
            onClick={onMoveToTop}
            className="border px-3 py-1.5 text-body disabled:opacity-40"
          >
            {busy === "Move to top" ? "Moving…" : "Move to top of collection"}
          </button>
          <span className="text-muted-foreground">→</span>
          <button
            type="button"
            disabled={!created?.length || busy !== null}
            onClick={onReveal}
            title="Drop the hide tags and publish to every sales channel"
            className="border px-3 py-1.5 text-body disabled:opacity-40"
          >
            {busy === "Reveal" ? "Revealing…" : "Reveal now"}
          </button>
          <button
            type="button"
            disabled={busy !== null || !dropName.trim()}
            onClick={onSchedule}
            title="Reveal automatically at a set time"
            className="border px-3 py-1.5 text-body disabled:opacity-40"
          >
            {busy === "Schedule" ? "Scheduling…" : "Schedule reveal"}
          </button>
          {created !== null && (
            <span className="text-body text-muted-foreground">
              {created.length} created in {dropName}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-fine text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
