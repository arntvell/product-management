"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// §6: numbered 01 02 03 for the flows that have a shape — import, create.
// A completed step is clickable; one you have not reached is not.
export function Stepper({
  steps,
  current,
  onStep,
}: {
  steps: string[];
  current: number;
  onStep?: (i: number) => void;
}) {
  return (
    <ol
      className="grid gap-4"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={s}>
            <button
              type="button"
              disabled={!onStep || i > current}
              onClick={() => onStep?.(i)}
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex w-full flex-col gap-1 border-t-2 pt-3 text-left",
                state === "todo"
                  ? "border-line text-muted-foreground"
                  : "border-ink text-ink",
                onStep && i < current && "hover:opacity-70"
              )}
            >
              <span className="flex items-center gap-2 text-meta uppercase tabular-nums">
                {String(i + 1).padStart(2, "0")}
                {state === "done" && <CheckIcon className="size-3" />}
              </span>
              <span className="text-body">{s}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
