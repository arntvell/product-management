"use client";

import { useMemo } from "react";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/ui/multi-select";
import { GroupCard } from "./group-card";
import type { ProductGroup } from "@/types";

interface GroupListProps {
  groups: ProductGroup[];
  onAutoLink: (group: ProductGroup, memberIds: string[]) => void;
  isLinking: boolean;
}

const LINK_STATUS_OPTIONS = [
  { value: "linked", label: "Linked" },
  { value: "partially_linked", label: "Partially Linked" },
  { value: "not_linked", label: "Not Linked" },
];

export function GroupList({ groups, onAutoLink, isLinking }: GroupListProps) {
  const [groupFilters, setGroupFilters] = usePersistedState(
    "metafield-manager:group-filters-v2",
    {
      search: "",
      vendorFilter: [] as string[],
      typeFilter: [] as string[],
      tagFilter: [] as string[],
      linkStatusFilter: [] as string[],
    }
  );

  const { search, vendorFilter, typeFilter, tagFilter, linkStatusFilter } =
    groupFilters;

  const setSearch = (v: string) =>
    setGroupFilters((prev) => ({ ...prev, search: v }));
  const setVendorFilter = (v: string[]) =>
    setGroupFilters((prev) => ({ ...prev, vendorFilter: v }));
  const setTypeFilter = (v: string[]) =>
    setGroupFilters((prev) => ({ ...prev, typeFilter: v }));
  const setTagFilter = (v: string[]) =>
    setGroupFilters((prev) => ({ ...prev, tagFilter: v }));
  const setLinkStatusFilter = (v: string[]) =>
    setGroupFilters((prev) => ({ ...prev, linkStatusFilter: v }));

  const vendors = useMemo(
    () => [...new Set(groups.map((g) => g.vendor))].filter(Boolean).sort(),
    [groups]
  );

  const productTypes = useMemo(
    () =>
      [...new Set(groups.map((g) => g.productType))].filter(Boolean).sort(),
    [groups]
  );

  const availableTags = useMemo(
    () =>
      [...new Set(groups.flatMap((g) => g.members.flatMap((m) => m.tags)))]
        .filter(Boolean)
        .sort(),
    [groups]
  );

  const filtered = useMemo(
    () =>
      groups.filter((group) => {
        if (search) {
          const q = search.toLowerCase();
          if (
            !group.baseName.toLowerCase().includes(q) &&
            !group.vendor.toLowerCase().includes(q) &&
            !group.members.some((m) => m.title.toLowerCase().includes(q))
          ) {
            return false;
          }
        }
        if (vendorFilter.length > 0 && !vendorFilter.includes(group.vendor)) {
          return false;
        }
        if (
          typeFilter.length > 0 &&
          !typeFilter.some((t) => group.members.some((m) => m.productType === t))
        ) {
          return false;
        }
        if (
          tagFilter.length > 0 &&
          !group.members.some((m) => m.tags.some((t) => tagFilter.includes(t)))
        ) {
          return false;
        }
        if (
          linkStatusFilter.length > 0 &&
          !linkStatusFilter.includes(group.linkStatus)
        ) {
          return false;
        }
        return true;
      }),
    [groups, search, vendorFilter, typeFilter, tagFilter, linkStatusFilter]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search groups..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <MultiSelect
          options={vendors}
          selected={vendorFilter}
          onChange={setVendorFilter}
          placeholder="All Vendors"
        />
        <MultiSelect
          options={productTypes}
          selected={typeFilter}
          onChange={setTypeFilter}
          placeholder="All Types"
        />
        <MultiSelect
          options={availableTags}
          selected={tagFilter}
          onChange={setTagFilter}
          placeholder="All Tags"
        />
        <MultiSelect
          options={LINK_STATUS_OPTIONS.map((o) => o.label)}
          selected={linkStatusFilter.map(
            (v) => LINK_STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v
          )}
          onChange={(labels) =>
            setLinkStatusFilter(
              labels.map(
                (l) => LINK_STATUS_OPTIONS.find((o) => o.label === l)?.value ?? l
              )
            )
          }
          placeholder="Link Status"
        />
        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} group{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            onAutoLink={onAutoLink}
            isLinking={isLinking}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-12">
          No product groups found.
        </p>
      )}
    </div>
  );
}
