"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ComboOption {
  value: string;
  /** Shown beside the value, e.g. a category and price. */
  hint?: string | null;
}

/**
 * A text input that suggests from a list, and where Enter TAKES the suggestion.
 *
 * The browser's <datalist> filters as you type but Enter keeps what you typed,
 * so "lev" + Enter stays "lev" rather than becoming "Levi's". Here Enter picks
 * the highlighted match — the first one, until the arrows move it. Typing
 * something that is not on the list is still allowed: Tab or clicking away
 * keeps the text as typed.
 */
export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  inputClassName,
  max = 8,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  max?: number;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, max);
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const o of options) {
      const v = o.value.toLowerCase();
      if (v.startsWith(q)) starts.push(o);
      else if (v.includes(q)) contains.push(o);
    }
    return [...starts, ...contains].slice(0, max);
  }, [value, options, max]);

  // Already exactly one of the options: nothing to suggest.
  const exact = matches.length === 1 && matches[0].value === value;
  const showList = open && matches.length > 0 && !exact;
  const highlighted = Math.min(active, Math.max(matches.length - 1, 0));

  function pick(o: ComboOption) {
    onChange(o.value);
    setOpen(false);
  }

  return (
    <div className={cn("relative", className)}>
      <input
        role="combobox"
        aria-expanded={showList}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            if (showList) {
              e.preventDefault();
              pick(matches[highlighted]);
            }
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showList ? (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-0.5 max-h-64 overflow-auto border bg-background shadow-sm"
        >
          {matches.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === highlighted}
              // mousedown, not click: click fires after the input's blur has
              // already closed the list.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-3 px-2 py-1 text-body",
                i === highlighted && "bg-muted"
              )}
            >
              <span className="truncate">{o.value}</span>
              {o.hint ? <span className="shrink-0 text-fine text-muted-foreground">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
