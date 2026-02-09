"use client";

import { useState, useEffect, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import { useDebounce } from "@/hooks/use-debounce";
import type { Filters } from "@/hooks/use-product-search";
import { DEFAULT_FILTERS } from "@/hooks/use-product-search";

interface ProductFiltersProps {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  vendors: string[];
  productTypes: string[];
  tags: string[];
  statuses: string[];
  totalCount: number;
  filteredCount: number;
  actions?: ReactNode;
}

export function ProductFilters({
  filters,
  onFiltersChange,
  vendors,
  productTypes,
  tags,
  statuses,
  totalCount,
  filteredCount,
  actions,
}: ProductFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFiltersChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch]);

  useEffect(() => {
    if (filters.search !== searchInput && filters.search === "") {
      setSearchInput("");
    }
  }, [filters.search]);

  const hasActiveFilters =
    filters.search ||
    filters.vendors.length > 0 ||
    filters.productTypes.length > 0 ||
    filters.tags.length > 0 ||
    filters.statuses.length > 0 ||
    filters.missingFlat;

  const handleClearAll = () => {
    setSearchInput("");
    onFiltersChange(DEFAULT_FILTERS);
  };

  return (
    <div className="flex items-center gap-3 p-4 border-b bg-muted/30 flex-wrap">
      <Input
        placeholder="Search products..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="max-w-xs"
      />
      <MultiSelect
        options={vendors}
        selected={filters.vendors}
        onChange={(vendors) => onFiltersChange({ ...filters, vendors })}
        placeholder="All Vendors"
      />
      <MultiSelect
        options={productTypes}
        selected={filters.productTypes}
        onChange={(productTypes) =>
          onFiltersChange({ ...filters, productTypes })
        }
        placeholder="All Types"
      />
      <MultiSelect
        options={tags}
        selected={filters.tags}
        onChange={(tags) => onFiltersChange({ ...filters, tags })}
        placeholder="All Tags"
      />
      <MultiSelect
        options={statuses}
        selected={filters.statuses}
        onChange={(statuses) => onFiltersChange({ ...filters, statuses })}
        placeholder="All Statuses"
      />
      <div className="flex items-center gap-1.5">
        <Checkbox
          id="missing-flat"
          checked={filters.missingFlat}
          onCheckedChange={(checked) =>
            onFiltersChange({ ...filters, missingFlat: !!checked })
          }
        />
        <Label htmlFor="missing-flat" className="text-sm cursor-pointer">
          Missing Flat
        </Label>
      </div>
      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={handleClearAll}>
          Clear
        </Button>
      )}
      <span className="text-sm text-muted-foreground ml-auto">
        {filteredCount === totalCount
          ? `${totalCount} products`
          : `${filteredCount} / ${totalCount} products`}
      </span>
      {actions}
    </div>
  );
}
