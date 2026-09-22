"use client";

// The import screen: choose the batch, take the file away, bring it back.
//
// Step 1 is not a form to be filled in twice. Everything chosen here is written
// into the workbook's hidden Meta sheet, and step 2 reads it back out — so the
// upload is not asked which brand this was for, and a file cannot be filled in
// for Paraboot and imported against Ichi.
//
// Step 3 (the report) is the only place a decision is asked for: a category
// string in the file that the master does not have. Everything else is either
// fine or an error with a row number on it.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PUBLISH_CHANNELS,
  PUBLISH_CHANNEL_LABELS,
  type PublishChannelKey,
} from "@/lib/master/fields";
import type { SizeSystemView } from "@/lib/master/size-systems";
import type {
  CategoryDecision,
  ImportReport,
} from "@/lib/master/import-products";

interface BrandOption {
  id: string;
  name: string;
  skuToken: string | null;
  defaultSizeSystemId: string | null;
  sitooManufacturerIds: string[];
}
interface CategoryOption {
  id: string;
  name: string;
  path: string;
  depth: number;
  sitooCategoryId: string | null;
}

const KINDS = ["MERCHANDISE", "AGGREGATE", "SAMPLE", "CONSUMABLE", "MATERIAL", "SERVICE"];

interface CommitResult {
  drafts: Array<{ id: string; styleName: string; colorways: number; variants: number }>;
  createdCategories: Array<{ id: string; name: string }>;
}

export function ImportProducts({
  brands,
  seasons,
  sizeSystems,
  manufacturers,
  categories,
}: {
  brands: BrandOption[];
  seasons: { id: string; code: string }[];
  sizeSystems: SizeSystemView[];
  manufacturers: { id: string; name: string }[];
  categories: CategoryOption[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [brandId, setBrandId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [kind, setKind] = useState("MERCHANDISE");
  const [sizeSystemId, setSizeSystemId] = useState("");
  const [defaultCategoryId, setDefaultCategoryId] = useState("");

  const [channels, setChannels] = useState<Record<PublishChannelKey, boolean>>({
    SHOPIFY: true,
    LOOM: false,
    SITOO: true,
  });
  const [tpl, setTpl] = useState({
    gender: "",
    unisex: false,
    hsCode: "",
    customsDescription: "",
    weightKg: "",
    fiberComposition: "",
    countryOfOrigin: "",
    manufacturerId: "",
  });

  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CategoryDecision>>({});
  const [busy, setBusy] = useState<null | "parse" | "commit">(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const system = sizeSystems.find((s) => s.id === sizeSystemId) ?? null;
  const canGenerate = !!brandId && !!seasonId && !!sizeSystemId;

  const templateHref = canGenerate
    ? `/api/catalog/import/template?brandId=${brandId}&seasonId=${seasonId}` +
      `&sizeSystemId=${sizeSystemId}&kind=${kind}` +
      (defaultCategoryId ? `&categoryId=${defaultCategoryId}` : "")
    : "";

  // Sitoo needs a manufacturer on the brand and a navigation id on the category.
  // Neither is on the product, so both are surfaced here rather than discovered
  // at finalize — the pre-flight refuses on the same two facts.
  const sitooBrandProblem =
    channels.SITOO && brand
      ? brand.sitooManufacturerIds.length === 0
        ? `${brand.name} is not linked to a Sitoo manufacturer.`
        : brand.sitooManufacturerIds.length > 1
          ? `${brand.name} is linked to ${brand.sitooManufacturerIds.length} Sitoo manufacturers.`
          : null
      : null;

  function chooseBrand(id: string) {
    setBrandId(id);
    const b = brands.find((x) => x.id === id);
    if (b?.defaultSizeSystemId && !sizeSystemId) setSizeSystemId(b.defaultSizeSystemId);
  }

  async function post(dryRun: boolean) {
    const f = file ?? fileRef.current?.files?.[0] ?? null;
    if (!f) {
      toast.error("Choose the filled-in file first.");
      return;
    }
    setBusy(dryRun ? "parse" : "commit");
    try {
      const form = new FormData();
      form.set("file", f);
      form.set("dryRun", dryRun ? "1" : "0");
      if (!dryRun) {
        form.set(
          "channels",
          JSON.stringify(PUBLISH_CHANNELS.filter((c) => channels[c]))
        );
        form.set("decisions", JSON.stringify(Object.values(decisions)));
        form.set("template", JSON.stringify(tpl));
      }
      const res = await fetch("/api/catalog/import/products", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        if (json.report) setReport(json.report);
        throw new Error(json.error ?? `Failed (${res.status})`);
      }
      setReport(json.report);
      if (dryRun) {
        toast.success(
          json.report.ok
            ? `Read ${json.report.counts.variants} rows — nothing written yet.`
            : `Read the file — ${json.report.errors.length} thing(s) to fix.`
        );
      } else {
        setResult(json.result);
        toast.success(`Created ${json.result.drafts.length} draft(s).`);
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  const unresolved = useMemo(
    () => (report?.categories ?? []).filter((c) => !c.matchedId && !decisions[c.value]),
    [report, decisions]
  );

  if (result) return <Result result={result} report={report} />;

  return (
    <div className="space-y-6">
      {/* ---------------- Step 1 — the batch ---------------- */}
      <Section
        step={1}
        title="Define the batch"
        hint="These go into the file, not just into this screen. The upload reads them back, so they are never asked twice."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand">
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={brandId}
              onChange={(e) => chooseBrand(e.target.value)}
            >
              <option value="">— choose —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Season">
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={seasonId}
              onChange={(e) => setSeasonId(e.target.value)}
            >
              <option value="">— choose —</option>
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k === "MERCHANDISE" ? "Merchandise (goods for sale)" : k.toLowerCase()}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Size system">
            {sizeSystems.length ? (
              <select
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={sizeSystemId}
                onChange={(e) => setSizeSystemId(e.target.value)}
              >
                <option value="">— choose —</option>
                {sizeSystems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.entries.filter((e) => !e.archived).length} sizes)
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs text-muted-foreground">
                None yet —{" "}
                <Link href="/catalog/size-systems" className="underline underline-offset-2">
                  create one
                </Link>
                . The file&apos;s size dropdown comes from it.
              </p>
            )}
          </Field>
        </div>

        <Field label="Default category (optional — pre-fills the column)" className="mt-4">
          <select
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
            value={defaultCategoryId}
            onChange={(e) => setDefaultCategoryId(e.target.value)}
          >
            <option value="">— none —</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {" ".repeat(c.depth * 2)}
                {c.name}
                {c.sitooCategoryId ? "" : " · no Sitoo id"}
              </option>
            ))}
          </select>
        </Field>

        {system ? (
          <p className="mt-3 text-xs text-muted-foreground">
            The Size column will only accept:{" "}
            <span className="font-mono">
              {system.entries
                .filter((e) => !e.archived)
                .map((e) => e.sizeLabel)
                .join(", ")}
            </span>
          </p>
        ) : null}

        <div className="mt-4">
          {canGenerate ? (
            <Button asChild size="sm">
              <a href={templateHref} download>
                Download the template
              </a>
            </Button>
          ) : (
            <Button size="sm" disabled>
              Download the template
            </Button>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            One row per size. Repeat the style and colourway on every row of that colourway;
            price in, price out and category are per colourway, so they have to agree across
            its rows.
          </p>
        </div>
      </Section>

      {/* ---------------- Step 2 — shared fields + channels ---------------- */}
      <Section
        step={2}
        title="What the file does not carry"
        hint="Customs, gender and manufacturer are the same for every row of a batch, so they are set once here rather than in seven more columns."
      >
        <div className="mb-4 flex flex-wrap items-center gap-4">
          {PUBLISH_CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels[c]}
                onChange={(e) => setChannels((s) => ({ ...s, [c]: e.target.checked }))}
              />
              {PUBLISH_CHANNEL_LABELS[c]}
            </label>
          ))}
        </div>
        {sitooBrandProblem ? (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {sitooBrandProblem} A Sitoo product carries the brand as its manufacturer, so the
            create is refused without exactly one.{" "}
            <Link href="/catalog/brands/identity" className="underline underline-offset-2">
              Link it
            </Link>{" "}
            or untick Sitoo — this blocks the finalize, not the import.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gender">
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={tpl.gender}
              onChange={(e) => setTpl((t) => ({ ...t, gender: e.target.value }))}
            >
              <option value="">—</option>
              <option value="women">Women</option>
              <option value="men">Men</option>
            </select>
          </Field>
          <Field label="Manufacturer">
            <select
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
              value={tpl.manufacturerId}
              onChange={(e) => setTpl((t) => ({ ...t, manufacturerId: e.target.value }))}
            >
              <option value="">—</option>
              {manufacturers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`HS code${channels.LOOM ? " *" : ""}`}>
            <Input
              value={tpl.hsCode}
              onChange={(e) => setTpl((t) => ({ ...t, hsCode: e.target.value }))}
            />
          </Field>
          <Field label={`Weight (kg)${channels.LOOM ? " *" : ""}`}>
            <Input
              placeholder="0.320"
              value={tpl.weightKg}
              onChange={(e) => setTpl((t) => ({ ...t, weightKg: e.target.value }))}
            />
          </Field>
          <Field label={`Fibre / material${channels.LOOM ? " *" : ""}`}>
            <Input
              value={tpl.fiberComposition}
              onChange={(e) => setTpl((t) => ({ ...t, fiberComposition: e.target.value }))}
            />
          </Field>
          <Field label={`Country of origin${channels.LOOM ? " *" : ""}`}>
            <Input
              value={tpl.countryOfOrigin}
              onChange={(e) => setTpl((t) => ({ ...t, countryOfOrigin: e.target.value }))}
            />
          </Field>
        </div>
        <Field label={`Customs description${channels.LOOM ? " *" : ""}`} className="mt-4">
          <Textarea
            rows={2}
            value={tpl.customsDescription}
            onChange={(e) => setTpl((t) => ({ ...t, customsDescription: e.target.value }))}
          />
        </Field>
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tpl.unisex}
            onChange={(e) => setTpl((t) => ({ ...t, unisex: e.target.checked }))}
          />
          Unisex
        </label>
      </Section>

      {/* ---------------- Step 3 — upload ---------------- */}
      <Section step={3} title="Upload the filled-in file">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
              setDecisions({});
            }}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
          />
          <Button size="sm" variant="outline" onClick={() => post(true)} disabled={busy !== null}>
            {busy === "parse" ? "Reading…" : "Check the file"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Checking writes nothing. It reads the file, groups it into styles and colourways, and
          says what would be created.
        </p>
      </Section>

      {report ? (
        <ReportView
          report={report}
          categories={categories}
          decisions={decisions}
          setDecisions={setDecisions}
        />
      ) : null}

      {report ? (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-xs text-muted-foreground">
            Importing creates one draft per style. Nothing reaches the catalogue until each
            draft is finalized.
          </p>
          <Button
            onClick={() => post(false)}
            disabled={
              busy !== null ||
              !report.ok ||
              unresolved.length > 0 ||
              !PUBLISH_CHANNELS.some((c) => channels[c])
            }
          >
            {busy === "commit"
              ? "Importing…"
              : `Import ${report.counts.styles} style${report.counts.styles === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReportView({
  report,
  categories,
  decisions,
  setDecisions,
}: {
  report: ImportReport;
  categories: CategoryOption[];
  decisions: Record<string, CategoryDecision>;
  setDecisions: (f: (d: Record<string, CategoryDecision>) => Record<string, CategoryDecision>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-5">
        <h2 className="text-sm font-semibold">
          {report.context.brandName} · {report.context.seasonCode} · {report.context.kind}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {report.counts.rows} rows → {report.counts.styles} styles, {report.counts.colorways}{" "}
          colourways, {report.counts.variants} sizes · sizes from {report.context.sizeSystemName}
        </p>

        {report.errors.length ? (
          <ul className="mt-4 space-y-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {report.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {report.warnings.length ? (
          <ul className="mt-3 space-y-1.5 rounded-md border p-3 text-xs text-muted-foreground">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {report.categories.length ? (
        <div className="rounded-lg border p-5">
          <h3 className="text-sm font-semibold">Categories in the file</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            A value that already exists is matched by name. Anything else needs a decision —
            the category is what the push maps outward to Shopify&apos;s product type,
            Loom&apos;s vocabulary and Sitoo&apos;s navigation.
          </p>
          <div className="mt-3 space-y-2">
            {report.categories.map((c) => {
              const d = decisions[c.value];
              const resolvedId =
                d?.action === "map" ? d.categoryId : c.matchedId ?? "";
              const creating = d?.action === "create";
              return (
                <div
                  key={c.value}
                  className="grid items-center gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1.4fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.value}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.rowCount} row{c.rowCount === 1 ? "" : "s"}
                      {c.matchedId ? ` · matches “${c.matchedName}”` : " · not in the master"}
                      {c.missingSitooId ? " · no Sitoo id" : ""}
                    </div>
                  </div>

                  {creating ? (
                    <Input
                      value={d.name}
                      onChange={(e) =>
                        setDecisions((prev) => ({
                          ...prev,
                          [c.value]: { value: c.value, action: "create", name: e.target.value },
                        }))
                      }
                      placeholder="New category name"
                    />
                  ) : (
                    <select
                      className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                      value={resolvedId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setDecisions((prev) => {
                          const next = { ...prev };
                          if (!id) delete next[c.value];
                          else next[c.value] = { value: c.value, action: "map", categoryId: id };
                          return next;
                        });
                      }}
                    >
                      <option value="">— choose a category —</option>
                      {categories.map((o) => (
                        <option key={o.id} value={o.id}>
                          {" ".repeat(o.depth * 2)}
                          {o.name}
                          {o.sitooCategoryId ? "" : " · no Sitoo id"}
                        </option>
                      ))}
                    </select>
                  )}

                  <button
                    type="button"
                    className="justify-self-start text-xs underline underline-offset-2 sm:justify-self-end"
                    onClick={() =>
                      setDecisions((prev) => {
                        const next = { ...prev };
                        if (creating) delete next[c.value];
                        else next[c.value] = { value: c.value, action: "create", name: c.value };
                        return next;
                      })
                    }
                  >
                    {creating ? "cancel" : "create new"}
                  </button>

                  {creating ? (
                    <p className="text-[11px] text-muted-foreground sm:col-span-3">
                      A new category starts with no Sitoo navigation id and no Loom value. That
                      is deliberate, not an oversight — set them on{" "}
                      <Link href="/catalog/categories" className="underline underline-offset-2">
                        /catalog/categories
                      </Link>{" "}
                      before a Sitoo push, which refuses without one.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border p-5">
        <h3 className="text-sm font-semibold">What would be created</h3>
        <div className="mt-3 space-y-3">
          {report.styles.map((s) => (
            <div key={s.styleSku} className="rounded-md border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-sm font-medium">
                  {s.styleName}{" "}
                  <span className="ml-1 rounded-full border px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                    {s.mode === "existing" ? "existing style" : "new style"}
                  </span>
                </div>
                <code className="font-mono text-xs text-muted-foreground">{s.styleSku}</code>
              </div>
              <div className="mt-2 space-y-1">
                {s.colorways.map((c) => (
                  <div
                    key={c.colorwaySku}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-1.5 text-xs"
                  >
                    <span className="font-medium">{c.name}</span>
                    <code className="font-mono text-muted-foreground">{c.colorwaySku}</code>
                    <span className="text-muted-foreground">
                      {c.variants.length} size{c.variants.length === 1 ? "" : "s"} ·{" "}
                      {c.variants.filter((v) => v.barcode).length} barcoded ·{" "}
                      {c.priceOut ? `out ${c.priceOut}` : "no price out"}
                      {c.priceIn ? ` · in ${c.priceIn}` : ""}
                      {c.categoryValue ? ` · ${c.categoryValue}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Result({ result, report }: { result: CommitResult; report: ImportReport | null }) {
  const [busy, setBusy] = useState<null | "check" | "create">(null);
  const [rows, setRows] = useState<
    Array<{ id: string; ok: boolean; created: boolean; error: string | null; report: unknown }>
  >([]);
  const router = useRouter();

  async function run(action: "check" | "create") {
    setBusy(action);
    try {
      const res = await fetch("/api/catalog/drafts/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: result.drafts.map((d) => d.id), action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setRows(json.rows);
      const s = json.summary;
      toast[s.blocked ? "warning" : "success"](
        action === "check"
          ? `${s.passed} of ${s.total} ready to create.`
          : `Created ${s.created} of ${s.total}.`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  const byId = new Map(rows.map((r) => [r.id, r]));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-5">
        <h2 className="text-sm font-semibold">
          {result.drafts.length} draft{result.drafts.length === 1 ? "" : "s"} created
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Nothing is in the catalogue yet. Each draft goes through the same pre-flight and
          create as a product typed by hand — SKU collisions, the barcode ledger and the Sitoo
          links are all checked there.
          {report ? ` From ${report.counts.rows} rows.` : ""}
        </p>
        {result.createdCategories.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            New categories:{" "}
            {result.createdCategories.map((c) => c.name).join(", ")} — they have no Sitoo
            navigation id yet, so set one on{" "}
            <Link href="/catalog/categories" className="underline underline-offset-2">
              /catalog/categories
            </Link>{" "}
            before pushing these to the till.
          </p>
        ) : null}

        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => run("check")} disabled={busy !== null}>
            {busy === "check" ? "Checking…" : "Check all"}
          </Button>
          <Button size="sm" onClick={() => run("create")} disabled={busy !== null}>
            {busy === "create" ? "Creating…" : "Create all that pass"}
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        {result.drafts.map((d) => {
          const r = byId.get(d.id);
          return (
            <div
              key={d.id}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 text-sm last:border-0"
            >
              <div className="min-w-0">
                <Link
                  href={`/catalog/products/drafts/${d.id}`}
                  className="truncate font-medium underline-offset-4 hover:underline"
                >
                  {d.styleName}
                </Link>
                <div className="text-xs text-muted-foreground">
                  {d.colorways} colourways · {d.variants} sizes
                </div>
                {r?.error ? <div className="text-xs text-destructive">{r.error}</div> : null}
                {r && !r.ok && !r.error ? (
                  <div className="text-xs text-destructive">
                    blocked — open the draft to see what.
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {r?.created ? "created" : r ? (r.ok ? "ready" : "blocked") : "draft"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-sm font-semibold">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px]">
          {step}
        </span>
        {title}
      </h2>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
