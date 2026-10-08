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
import { DraftPushPanel } from "@/components/catalog/draft-push-panel";
import { SetSitooNavigation } from "@/components/catalog/set-sitoo-navigation";
import {
  NewCategoryForm,
  type CreatedCategory,
  type NewCategoryOptions,
} from "@/components/catalog/new-category-form";

interface BrandOption {
  id: string;
  name: string;
  skuToken: string | null;
  defaultSizeSystemId: string | null;
  defaults: {
    hsCode: string;
    countryOfOrigin: string;
    weightKg: string;
    fiberComposition: string;
    customsDescription: string;
    gender: string;
    unisex: boolean;
  };
  /** Labels of the required fields the brand has left blank. */
  missingDefaults: string[];
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
  categories: initialCategories,
  newCategoryOptions,
  resumeBatchId,
}: {
  brands: BrandOption[];
  seasons: { id: string; code: string }[];
  sizeSystems: SizeSystemView[];
  categories: CategoryOption[];
  newCategoryOptions: NewCategoryOptions;
  /** `?batch=` — a push this screen started that has not finished. Loom jobs
   *  outlive the tab that submitted them, and an import batch belongs to no
   *  single draft, so without this a refresh loses the only handle on it. */
  resumeBatchId?: string | null;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [brandId, setBrandId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [kind, setKind] = useState("MERCHANDISE");
  // One or more: most brands size everything one way, but a jeweller sells
  // rings and chains. Each row of the file then names its own system.
  const [sizeSystemIds, setSizeSystemIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  // Categories created on this screen join the list without a reload.
  const [categories, setCategories] = useState<CategoryOption[]>(initialCategories);
  // A category picked or "created" may already be in the list (a duplicate
  // name resolves to the existing one), so add only what is new.
  const addCategory = (c: CreatedCategory) =>
    setCategories((prev) =>
      prev.some((x) => x.id === c.id)
        ? prev
        : [...prev, c].sort((a, b) => a.name.localeCompare(b.name))
    );
  const setCategorySitoo = (id: string, sitooCategoryId: string) =>
    setCategories((prev) => prev.map((x) => (x.id === id ? { ...x, sitooCategoryId } : x)));
  const categoryOptions: NewCategoryOptions = {
    ...newCategoryOptions,
    parents: categories.map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
  };

  const [channels, setChannels] = useState<Record<PublishChannelKey, boolean>>({
    SHOPIFY: true,
    LOOM: false,
    SITOO: true,
  });
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [decisions, setDecisions] = useState<Record<string, CategoryDecision>>({});
  const [busy, setBusy] = useState<null | "parse" | "commit">(null);
  const [result, setResult] = useState<CommitResult | null>(null);

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const chosenSystems = sizeSystemIds
    .map((id) => sizeSystems.find((s) => s.id === id))
    .filter((s): s is SizeSystemView => !!s);

  // The brand's customs block is a precondition for the FILE, not just for the
  // import. Handing someone a template to fill in over an afternoon, and only
  // then telling them the brand was incomplete, wastes the afternoon.
  const brandIncomplete = brand ? brand.missingDefaults : [];
  const canGenerate =
    !!brandId && !!seasonId && sizeSystemIds.length > 0 && categoryIds.length > 0 && !brandIncomplete.length;

  const templateHref = canGenerate
    ? `/api/catalog/import/template?brandId=${brandId}&seasonId=${seasonId}` +
      `&sizeSystemIds=${sizeSystemIds.join(",")}&kind=${kind}` +
      `&categoryIds=${categoryIds.join(",")}`
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
    if (b?.defaultSizeSystemId && !sizeSystemIds.length) setSizeSystemIds([b.defaultSizeSystemId]);
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

  if (result)
    return (
      <Result
        result={result}
        report={report}
        channels={PUBLISH_CHANNELS.filter((c) => channels[c])}
        seasonCode={seasons.find((s) => s.id === seasonId)?.code}
      />
    );

  // A push from an earlier visit that has not finished. Shown ahead of the
  // wizard because starting a second import before the first has published is
  // how the first one gets forgotten.
  if (resumeBatchId)
    return (
      <div className="space-y-6">
        <div className="border p-5">
          <h2 className="text-body">A publish from this screen is unfinished</h2>
          <p className="mt-1 text-fine text-muted-foreground">
            The products are in the master. Resume to let it finish — typically Loom, whose
            job runs longer than the page that submitted it.
          </p>
          <DraftPushPanel
            title="Unfinished publish"
            draftId={null}
            colorwayIds={[]}
            channels={[]}
            unfinishedBatchId={resumeBatchId}
          />
          <Link
            href="/catalog/products/import"
            className="mt-3 inline-block text-fine underline underline-offset-4"
          >
            Start a new import instead
          </Link>
        </div>
      </div>
    );

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
              className="h-9 w-full border bg-transparent px-3 text-body"
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
              className="h-9 w-full border bg-transparent px-3 text-body"
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
              className="h-9 w-full border bg-transparent px-3 text-body"
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
          <Field label="Size systems">
            {sizeSystems.length ? (
              <div className="max-h-40 overflow-y-auto border p-1">
                {sizeSystems.map((s) => {
                  const on = sizeSystemIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className="flex cursor-pointer items-center gap-2 px-2 py-1 text-body hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setSizeSystemIds((prev) =>
                            on ? prev.filter((id) => id !== s.id) : [...prev, s.id]
                          )
                        }
                      />
                      <span className="truncate">{s.name}</span>
                      <span className="ml-auto text-fine text-muted-foreground">
                        {s.entries.filter((e) => !e.archived).length} sizes
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-fine text-muted-foreground">
                None yet —{" "}
                <Link href="/catalog/size-systems" className="underline underline-offset-2">
                  create one
                </Link>
                . The file&apos;s size dropdown comes from it.
              </p>
            )}
          </Field>
        </div>

        <Field label="Categories available in this file" className="mt-4">
          <CategoryPicker
            all={categories}
            selected={categoryIds}
            onChange={setCategoryIds}
            newCategoryOptions={categoryOptions}
            onCreated={(c) => {
              addCategory(c);
              setCategoryIds((prev) => [...prev, c.id]);
            }}
          />
          <p className="text-fine text-muted-foreground">
            The Category column becomes a dropdown of exactly these. Pick every category the
            delivery covers — a brand&apos;s shirts and its bags can share one file. Choose
            one and the column is pre-filled, so it never has to be touched.
          </p>
        </Field>

        {chosenSystems.length ? (
          <div className="mt-3 space-y-1 text-fine text-muted-foreground">
            {chosenSystems.length > 1 ? (
              <p>
                The file gets a Size system column: pick {chosenSystems.map((s) => s.name).join(" or ")}{" "}
                on each row, and its size must be one of that system&apos;s.
              </p>
            ) : null}
            {chosenSystems.map((sys) => (
              <p key={sys.id}>
                {chosenSystems.length > 1 ? `${sys.name}: ` : "The Size column will only accept: "}
                <span className="font-mono">
                  {sys.entries
                    .filter((e) => !e.archived)
                    .map((e) => e.sizeLabel)
                    .join(", ")}
                </span>
              </p>
            ))}
          </div>
        ) : null}

        <div className="mt-4">
          {canGenerate ? (
            <Button asChild size="sm">
              <a href={templateHref} download>
                Download the template
              </a>
            </Button>
          ) : (
            <>
              <Button size="sm" disabled>
                Download the template
              </Button>
              {/* Said next to the button: the brand gap used to be reported only
                  in step 2, below it, and read as "the download is broken". */}
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-fine text-ink">
                {!brandId ? <li>Choose a brand.</li> : null}
                {!seasonId ? <li>Choose a season.</li> : null}
                {!sizeSystemIds.length ? <li>Tick at least one size system.</li> : null}
                {!categoryIds.length ? <li>Tick at least one category.</li> : null}
                {brand && brandIncomplete.length ? (
                  <li>
                    {brand.name} has no {brandIncomplete.join(", ")}. Every imported product
                    inherits these, so set them in{" "}
                    <Link href={`/catalog/brands/${brand.id}`} className="underline underline-offset-2">
                      {brand.name}&apos;s brand settings
                    </Link>{" "}
                    and reload this page.
                  </li>
                ) : null}
              </ul>
            </>
          )}
          <p className="mt-2 text-fine text-muted-foreground">
            One row per size. Repeat the style and colourway on every row of that colourway;
            price in, price out and category are per colourway, so they have to agree across
            its rows.
          </p>
        </div>
      </Section>

      {/* ---------------- Step 2 — channels, and what the brand supplies ------ */}
      <Section
        step={2}
        title="Channels, and what the brand supplies"
        hint="Customs, weight, country, fibre and gender are the same for every garment a brand makes, so they live on the brand. Nothing here is typed per batch."
      >
        <div className="mb-4 flex flex-wrap items-center gap-4">
          {PUBLISH_CHANNELS.map((c) => (
            <label key={c} className="flex items-center gap-2 text-body">
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
          <p className="mb-4 border border-ink bg-paper p-3 text-meta normal-case tracking-normal text-ink">
            {sitooBrandProblem} A Sitoo product carries the brand as its manufacturer, so the
            create is refused without exactly one.{" "}
            <Link href="/catalog/brands/identity" className="underline underline-offset-2">
              Link it
            </Link>{" "}
            or untick Sitoo — this blocks the finalize, not the import.
          </p>
        ) : null}

        {!brand ? (
          <p className="text-fine text-muted-foreground">Choose a brand to see its defaults.</p>
        ) : brandIncomplete.length ? (
          <div className="border border-destructive/40 bg-destructive/5 p-3 text-fine text-destructive">
            <p>
              {brand.name} is missing {brandIncomplete.join(", ")}.
            </p>
            <p className="mt-1">
              The file carries none of these, so an imported product has nowhere else to get
              them — and a product pushed with a blank HS code is a customs problem, not a
              cosmetic one. Nothing can be generated or imported until they are filled in.{" "}
              <Link
                href={`/catalog/brands/${brand.id}`}
                className="underline underline-offset-2"
              >
                Open {brand.name}&apos;s settings
              </Link>
            </p>
          </div>
        ) : (
          <dl className="grid gap-x-6 gap-y-2 text-fine sm:grid-cols-2">
            <Fact label="HS code" value={brand.defaults.hsCode} />
            <Fact label="Country of origin" value={brand.defaults.countryOfOrigin} />
            <Fact label="Weight" value={`${brand.defaults.weightKg} kg`} />
            <Fact label="Fibre / material" value={brand.defaults.fiberComposition} />
            <Fact label="Customs description" value={brand.defaults.customsDescription} />
            <Fact
              label="Gender"
              value={
                (brand.defaults.gender || "—") + (brand.defaults.unisex ? " · unisex" : "")
              }
            />
            <div className="text-muted-foreground sm:col-span-2">
              From{" "}
              <Link
                href={`/catalog/brands/${brand.id}`}
                className="underline underline-offset-2"
              >
                {brand.name}&apos;s settings
              </Link>
              . Every product in this import inherits them.
            </div>
          </dl>
        )}
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
            className="text-body file:mr-3 file: file:border file:bg-transparent file:px-3 file:py-1.5 file:text-body"
          />
          <Button size="sm" variant="outline" onClick={() => post(true)} disabled={busy !== null}>
            {busy === "parse" ? "Reading…" : "Check the file"}
          </Button>
        </div>
        <p className="mt-2 text-fine text-muted-foreground">
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
          newCategoryOptions={categoryOptions}
          onCategoryCreated={addCategory}
          onCategorySitoo={setCategorySitoo}
          sitooTicked={channels.SITOO}
        />
      ) : null}

      {report ? (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-fine text-muted-foreground">
            Importing creates one draft per style. Nothing reaches the catalogue until each
            draft is finalized.
          </p>
          <Button
            onClick={() => post(false)}
            disabled={
              busy !== null ||
              !report.ok ||
              unresolved.length > 0 ||
              brandIncomplete.length > 0 ||
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
  newCategoryOptions,
  onCategoryCreated,
  onCategorySitoo,
  sitooTicked,
}: {
  report: ImportReport;
  categories: CategoryOption[];
  decisions: Record<string, CategoryDecision>;
  setDecisions: (f: (d: Record<string, CategoryDecision>) => Record<string, CategoryDecision>) => void;
  newCategoryOptions: NewCategoryOptions;
  onCategoryCreated: (c: CreatedCategory) => void;
  onCategorySitoo: (categoryId: string, sitooCategoryId: string) => void;
  /** Whether this import creates for Sitoo — only then is a missing id a blocker. */
  sitooTicked: boolean;
}) {
  // The file value a category is being created for, if any. Created at once,
  // with its Shopify, Loom and Sitoo values, then mapped like any other.
  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="border p-5">
        <h2 className="text-body">
          {report.context.brandName} · {report.context.seasonCode} · {report.context.kind}
        </h2>
        <p className="mt-1 text-fine text-muted-foreground">
          {report.counts.rows} rows → {report.counts.styles} styles, {report.counts.colorways}{" "}
          colourways, {report.counts.variants} sizes · sizes from {report.context.sizeSystemName}
        </p>

        {report.errors.length ? (
          <ul className="mt-4 space-y-1.5 border border-destructive/40 bg-destructive/5 p-3 text-fine text-destructive">
            {report.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {report.warnings.length ? (
          <ul className="mt-3 space-y-1.5 border p-3 text-fine text-muted-foreground">
            {report.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {report.categories.length ? (
        <div className="border p-5">
          <h3 className="text-body">Categories in the file</h3>
          <p className="mt-1 text-fine text-muted-foreground">
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
              // The category this value resolves to, as it stands now — its Sitoo
              // id may have been set on this screen since the report was read.
              const resolved = categories.find((x) => x.id === resolvedId) ?? null;
              const needsSitoo = sitooTicked && !!resolved && !resolved.sitooCategoryId;
              return (
                <div
                  key={c.value}
                  className="grid items-center gap-2 border p-3 sm:grid-cols-[1fr_1.4fr_auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-body">{c.value}</div>
                    <div className="text-fine text-muted-foreground">
                      {c.rowCount} row{c.rowCount === 1 ? "" : "s"}
                      {c.matchedId ? ` · matches “${c.matchedName}”` : " · not in the master"}
                      {resolved ? (resolved.sitooCategoryId ? ` · Sitoo ${resolved.sitooCategoryId}` : " · no Sitoo id") : ""}
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
                      className="h-9 w-full border bg-transparent px-3 text-body"
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

                  {c.matchedId && !creating ? (
                    <span />
                  ) : (
                  <button
                    type="button"
                    className="justify-self-start text-fine underline underline-offset-2 sm:justify-self-end"
                    onClick={() => {
                      if (creating)
                        setDecisions((prev) => {
                          const next = { ...prev };
                          delete next[c.value];
                          return next;
                        });
                      else setCreatingFor(creatingFor === c.value ? null : c.value);
                    }}
                  >
                    {creating || creatingFor === c.value ? "cancel" : "create new"}
                  </button>
                  )}

                  {needsSitoo && creatingFor !== c.value ? (
                    <div className="sm:col-span-3">
                      <SetSitooNavigation
                        categoryId={resolved!.id}
                        categoryName={resolved!.name}
                        sitooCategories={newCategoryOptions.sitooCategories}
                        onSet={(sitooId) => onCategorySitoo(resolved!.id, sitooId)}
                      />
                    </div>
                  ) : null}

                  {creatingFor === c.value ? (
                    <div className="sm:col-span-3">
                      <NewCategoryForm
                        options={newCategoryOptions}
                        initialName={c.value}
                        onCancel={() => setCreatingFor(null)}
                        onCreated={(created) => {
                          onCategoryCreated(created);
                          setDecisions((prev) => ({
                            ...prev,
                            [c.value]: { value: c.value, action: "map", categoryId: created.id },
                          }));
                          setCreatingFor(null);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="border p-5">
        <h3 className="text-body">What would be created</h3>
        <div className="mt-3 space-y-3">
          {report.styles.map((s) => (
            <div key={s.styleSku} className="border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-body">
                  {s.styleName}{" "}
                  <span className="ml-1 rounded-full border px-2 py-0.5 text-fine text-muted-foreground">
                    {s.mode === "existing" ? "existing style" : "new style"}
                  </span>
                </div>
                <code className="font-mono text-fine text-muted-foreground">{s.styleSku}</code>
              </div>
              <div className="mt-2 space-y-1">
                {s.colorways.map((c) => (
                  <div
                    key={c.colorwaySku}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-1.5 text-fine"
                  >
                    <span>{c.name}</span>
                    <code className="font-mono text-muted-foreground">{c.colorwaySku}</code>
                    <span className="text-muted-foreground">
                      {c.variants.length} size{c.variants.length === 1 ? "" : "s"}
                      {report.context.sizeSystems.length > 1 && c.sizeSystemName
                        ? ` (${c.sizeSystemName})`
                        : ""}{" "}
                      ·{" "}
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

function Result({
  result,
  report,
  channels,
  seasonCode,
}: {
  result: CommitResult;
  report: ImportReport | null;
  /** The channels ticked in step 2. Creating is only half of what that tick
   *  asked for — the other half is this screen pushing to them. */
  channels: PublishChannelKey[];
  /** The season chosen in step 1. Loom sends nothing without it. */
  seasonCode?: string;
}) {
  const [busy, setBusy] = useState<null | "check" | "create">(null);
  const [rows, setRows] = useState<
    Array<{
      id: string;
      ok: boolean;
      created: boolean;
      error: string | null;
      report: unknown;
      colorwayIds: string[];
    }>
  >([]);
  // The colorways "create" actually made. Set once, and its presence is what
  // turns this screen from a create screen into a publish screen.
  const [createdIds, setCreatedIds] = useState<string[] | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
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
          : channels.length
            ? `Created ${s.created} of ${s.total} — publishing now.`
            : `Created ${s.created} of ${s.total}.`
      );
      if (action === "create") {
        const ids = (json.rows as Array<{ colorwayIds?: string[] }>).flatMap(
          (r) => r.colorwayIds ?? []
        );
        // Even when nothing was created, say so by setting an empty list: the
        // panel then reports "nothing to publish" instead of this screen
        // looking exactly like the one that silently stopped at the master.
        setCreatedIds(ids);
      }
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
      <div className="border p-5">
        <h2 className="text-body">
          {result.drafts.length} draft{result.drafts.length === 1 ? "" : "s"} created
        </h2>
        <p className="mt-1 text-fine text-muted-foreground">
          Nothing is in the catalogue yet. Each draft goes through the same pre-flight and
          create as a product typed by hand — SKU collisions, the barcode ledger and the Sitoo
          links are all checked there.
          {report ? ` From ${report.counts.rows} rows.` : ""}
        </p>
        {result.createdCategories.length ? (
          <p className="mt-2 text-fine text-muted-foreground">
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
          <Button
            size="sm"
            onClick={() => run("create")}
            disabled={busy !== null || createdIds !== null}
          >
            {busy === "create"
              ? "Creating…"
              : channels.length
                ? "Create and publish all that pass"
                : "Create all that pass"}
          </Button>
        </div>
        {createdIds === null ? (
          <p className="mt-2 text-fine text-muted-foreground">
            {channels.length
              ? `Creating writes the master and then pushes to ${channels
                  .map((c) => PUBLISH_CHANNEL_LABELS[c])
                  .join(", ")} — Shopify first, so Loom receives its inventory ids. Anything
                  held back is listed here rather than pushed.`
              : "No channels were ticked in step 2, so these products will exist only in the master."}
          </p>
        ) : null}
      </div>

      {/* --------- Publish. Creating a product is not publishing it, and this
          screen used to end one step short: it said "Created 13 of 13" and left
          thirteen products in the master that no channel had ever heard of. --- */}
      {createdIds !== null && createdIds.length > 0 ? (
        <DraftPushPanel
          title="Publishing to channels"
          draftId={null}
          colorwayIds={createdIds}
          channels={channels}
          kind="import"
          note={`import of ${result.drafts.length} draft(s)`}
          seasonCode={seasonCode}
          // The file has seven columns — style, colorway, size, price in, price
          // out, barcode, category — and none of them is a description, a
          // photograph, a swatch, a care page or a fit guide. Holding an import
          // back for gaps its own template cannot carry is a button that always
          // has to be pressed, which is not a decision. The product is created
          // ProductStatus.DRAFT, so Shopify receives a draft product and nothing
          // reaches a customer until someone makes it ACTIVE.
          allowIncomplete
          autoStart
          onBatchCreated={(id) => {
            setBatchId(id);
            // An import batch spans many drafts, so `PushBatch.draftId` is null
            // and no /done page can find it. The URL is then the only handle on
            // a Loom job that outlives this tab.
            router.replace(`/catalog/products/import?batch=${id}`, { scroll: false });
          }}
        />
      ) : null}
      {createdIds !== null && createdIds.length === 0 ? (
        <div className="border border-ink bg-paper p-4 text-meta normal-case tracking-normal text-ink">
          Nothing was created, so nothing was published. Open a draft below to see what
          its pre-flight refused.
        </div>
      ) : null}

      <div className="border">
        {result.drafts.map((d) => {
          const r = byId.get(d.id);
          return (
            <div
              key={d.id}
              className="flex items-center justify-between gap-4 border-b px-4 py-3 text-body last:border-0"
            >
              <div className="min-w-0">
                <Link
                  href={
                    r?.created
                      ? `/catalog/products/drafts/${d.id}/done`
                      : `/catalog/products/drafts/${d.id}`
                  }
                  className="truncate underline-offset-4 hover:underline"
                >
                  {d.styleName}
                </Link>
                <div className="text-fine text-muted-foreground">
                  {d.colorways} colourways · {d.variants} sizes
                </div>
                {r?.error ? <div className="text-fine text-destructive">{r.error}</div> : null}
                {r && !r.ok && !r.error ? (
                  <div className="text-fine text-destructive">
                    blocked — open the draft to see what.
                  </div>
                ) : null}
              </div>
              <span className="shrink-0 text-fine text-muted-foreground">
                {r?.created
                  ? batchId
                    ? "created · publishing"
                    : "created · not published"
                  : r
                    ? r.ok
                      ? "ready"
                      : "blocked"
                    : "draft"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Pick the categories this file may use.
 *
 * A searchable list rather than a native multiple-select: there are ninety of
 * them, they are hierarchical, and whether one carries a Sitoo navigation id
 * decides whether the product can be created at all — so that has to be visible
 * while choosing, not discovered at finalize.
 */
function CategoryPicker({
  all,
  selected,
  onChange,
  newCategoryOptions,
  onCreated,
}: {
  all: CategoryOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  newCategoryOptions: NewCategoryOptions;
  onCreated: (c: CreatedCategory) => void;
}) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((c) => c.name.toLowerCase().includes(needle));
  }, [all, q]);

  const chosen = selected
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is CategoryOption => !!c);

  return (
    <div className="border">
      <div className="flex flex-wrap items-center gap-1.5 border-b p-2">
        {chosen.length ? (
          chosen.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange(selected.filter((id) => id !== c.id))}
              className="rounded-full border px-2 py-0.5 text-fine transition-colors hover:bg-muted"
              title="Remove"
            >
              {c.name} ✕
            </button>
          ))
        ) : (
          <span className="px-1 text-fine text-muted-foreground">None chosen yet</span>
        )}
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search categories…"
        className="border-0 border-b focus-visible:ring-0"
      />
      <div className="max-h-48 overflow-y-auto p-1">
        {shown.map((c) => {
          const on = selected.includes(c.id);
          return (
            <label
              key={c.id}
              className="flex cursor-pointer items-center gap-2 px-2 py-1 text-body hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  onChange(on ? selected.filter((id) => id !== c.id) : [...selected, c.id])
                }
              />
              <span style={{ paddingLeft: c.depth * 12 }}>{c.name}</span>
              {c.sitooCategoryId ? null : (
                <span className="ml-auto text-fine text-ink">
                  no Sitoo id
                </span>
              )}
            </label>
          );
        })}
        {shown.length === 0 ? (
          <p className="px-2 py-3 text-fine text-muted-foreground">Nothing matches.</p>
        ) : null}
      </div>
      <div className="border-t p-2">
        {creating ? (
          <NewCategoryForm
            options={newCategoryOptions}
            initialName={shown.length === 0 ? q.trim() : ""}
            onCancel={() => setCreating(false)}
            onCreated={(c) => {
              onCreated(c);
              setCreating(false);
              setQ("");
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-fine underline underline-offset-2"
          >
            + New category{shown.length === 0 && q.trim() ? ` “${q.trim()}”` : ""}
          </button>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value || "—"}</dd>
    </div>
  );
}

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
    <section className="border p-5">
      <h2 className="text-body">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border text-fine">
          {step}
        </span>
        {title}
      </h2>
      {hint ? <p className="mt-1 text-fine text-muted-foreground">{hint}</p> : null}
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
      <Label className="text-fine">{label}</Label>
      {children}
    </div>
  );
}
