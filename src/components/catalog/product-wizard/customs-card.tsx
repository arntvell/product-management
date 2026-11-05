"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NewCategoryForm } from "@/components/catalog/new-category-form";
import type { DraftTemplate } from "@/lib/master/draft-payload";
import type { StepProps } from "./types";

/**
 * The six classification fields, in the order they are shown. Category is the
 * modelled id; the rest are text.
 *
 * These lived in a collapsed "Customs and classification" curtain under the
 * prices, and were routinely missed. Nothing refuses a hand-built product
 * without them (only an import does, see importCustomsGaps in finalize.ts),
 * so a missed curtain meant a product reaching Loom and Shopify with no HS
 * code, weight or origin. They are now an open card with a count, and Review
 * names what is still missing.
 */
export const CUSTOMS_FIELDS: { field: keyof DraftTemplate; label: string; placeholder?: string }[] = [
  { field: "categoryId", label: "Category" },
  { field: "hsCode", label: "HS code", placeholder: "6913.90" },
  { field: "countryOfOrigin", label: "Country of origin", placeholder: "NO" },
  { field: "weightKg", label: "Weight (kg)", placeholder: "0.12" },
  { field: "fiberComposition", label: "Fibre composition", placeholder: "100% stoneware" },
  { field: "customsDescription", label: "Customs description", placeholder: "Ceramic incense holder" },
];

/** The labels of the classification fields still blank on this draft. */
export function missingCustoms(t: DraftTemplate): string[] {
  return CUSTOMS_FIELDS.filter((f) => !String(t[f.field] ?? "").trim()).map((f) => f.label);
}

export function CustomsCard({ payload, update, options }: StepProps) {
  const missing = missingCustoms(payload.template);
  const filled = CUSTOMS_FIELDS.length - missing.length;
  const complete = missing.length === 0;

  return (
    <section id="customs" className="border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body">Customs and classification</h3>
        <span
          className={
            "border px-2 py-0.5 text-fine tabular-nums " +
            (complete ? "text-muted-foreground" : "border-ink text-ink")
          }
        >
          {filled} of {CUSTOMS_FIELDS.length} filled
        </span>
      </div>
      <p className="mt-1 text-fine text-muted-foreground">
        For the whole style. Prefilled from the brand and, for an existing style, from that
        style. Sent to Loom and Shopify for shipping and duties; Sitoo has no field for it.
        {complete ? "" : ` Still missing: ${missing.join(", ")}.`}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <CategoryField payload={payload} update={update} options={options} />
        {CUSTOMS_FIELDS.filter((f) => f.field !== "categoryId").map((f) => (
          <TemplateField
            key={f.field}
            label={f.label}
            field={f.field}
            placeholder={f.placeholder}
            payload={payload}
            update={update}
          />
        ))}
      </div>
    </section>
  );
}

function TemplateField({
  label,
  field,
  placeholder,
  payload,
  update,
}: Pick<StepProps, "payload" | "update"> & {
  label: string;
  field: keyof DraftTemplate;
  placeholder?: string;
}) {
  const value = payload.template[field];
  const blank = !String(value ?? "").trim();
  const inputId = `customs-${field}`;
  return (
    <div>
      <Label htmlFor={inputId} className="text-fine">{label}</Label>
      <Input
        id={inputId}
        className={"mt-1.5 " + (blank ? "border-ink" : "")}
        value={typeof value === "string" ? value : ""}
        placeholder={placeholder}
        onChange={(e) =>
          update((p) => ({ ...p, template: { ...p.template, [field]: e.target.value } }))
        }
      />
    </div>
  );
}

/**
 * The category, chosen from the modelled vocabulary rather than typed.
 *
 * Free text is what produced 76 spellings of a few dozen categories, and it is
 * what made `shopifyProductType` and `loomCategory` unreachable — nothing can
 * map a string nobody has seen before. The name is written alongside the id so
 * every existing text consumer keeps working unchanged.
 */
function CategoryField({ payload, update, options }: StepProps) {
  const [extra, setExtra] = useState<{ id: string; name: string; depth: number }[]>([]);
  const [creating, setCreating] = useState(false);

  const all = [...options.categories, ...extra];
  const chosen = all.find((c) => c.id === payload.template.categoryId);

  function choose(id: string) {
    const c = all.find((x) => x.id === id);
    update((p) => ({
      ...p,
      template: { ...p.template, categoryId: c?.id ?? "", category: c?.name ?? "" },
    }));
  }

  // Created with its Shopify product type, Loom category and Sitoo navigation —
  // a name alone left Shopify without a type and the Sitoo push refusing.
  function created(c: { id: string; name: string; depth: number }) {
    setExtra((x) => [...x, c]);
    update((p) => ({
      ...p,
      template: { ...p.template, categoryId: c.id, category: c.name },
    }));
    setCreating(false);
  }

  return (
    <div>
      <Label className="text-fine">Category</Label>
      {creating ? (
        <div className="mt-1.5">
          <NewCategoryForm
            options={{
              parents: all.map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
              ...options.newCategory,
            }}
            onCancel={() => setCreating(false)}
            onCreated={created}
          />
        </div>
      ) : (
        <select
          className={
            "mt-1.5 h-9 w-full border bg-transparent px-3 text-body " +
            (payload.template.categoryId ? "" : "border-ink")
          }
          value={payload.template.categoryId}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              setCreating(true);
              return;
            }
            choose(e.target.value);
          }}
        >
          <option value="">— choose a category —</option>
          {all.map((c) => (
            <option key={c.id} value={c.id}>
              {"  ".repeat(c.depth)}
              {c.name}
            </option>
          ))}
          <option value="__new__">+ new category…</option>
        </select>
      )}
      {!chosen && payload.template.category ? (
        <p className="mt-1 text-fine text-ink">
          &ldquo;{payload.template.category}&rdquo; is not a modelled category — pick one so
          Shopify and Loom get the mapped spelling rather than a guess.
        </p>
      ) : null}
    </div>
  );
}
