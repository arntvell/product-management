"use client";

import * as React from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// The one element in the system. §5 allows the pill here and nowhere
// else, because a filter is the one control that detaches and is dismissed.
export interface FilterChipProps {
  label: string;
  value?: string;
  active?: boolean;
  onClick?: () => void;
  onClear?: () => void;
}

export function FilterChip({
  label,
  value,
  active,
  onClick,
  onClear,
}: FilterChipProps) {
  const on = active || !!value;
  return (
    <span
      className={cn(
        "inline-flex h-8 items-center rounded-full border text-meta uppercase transition-colors duration-150 ease-origo",
        on
          ? "border-ink bg-ink text-offwhite"
          : "border-line bg-paper text-ink hover:border-ink"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex h-full items-center gap-1.5 px-3"
      >
        <span>
          {label}
          {value && ":"}
        </span>
        {value && (
          <span className="normal-case tracking-normal">{value}</span>
        )}
        {!on && <ChevronDownIcon className="size-3" />}
      </button>
      {on && onClear && (
        <button
          type="button"
          aria-label={`Clear ${label}`}
          onClick={onClear}
          className="-ml-1.5 flex h-full items-center pr-2.5"
        >
          <XIcon className="size-3" />
        </button>
      )}
    </span>
  );
}
