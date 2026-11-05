"use client";

import { useEffect, type ReactNode } from "react";
import type { DraftPayloadV1 } from "@/lib/master/draft-payload";
import { useDraftAutosave, type SaveState } from "./use-draft-autosave";
import { StepBuild } from "./step-build";
import type { WizardOptions } from "./types";

/** A style built alongside the first one: its own draft, grouped under it. */
export interface StyleMember {
  id: string;
  payload: DraftPayloadV1;
  revision: number;
  status: string;
}

/** What a style tells the page about itself: enough to review and save it. */
export interface StyleReport {
  payload: DraftPayloadV1;
  state: SaveState;
  save: () => Promise<boolean>;
}

/** Chosen once, on step 1, for every style of the build. */
export type SharedChoices = Pick<DraftPayloadV1, "brand" | "seasonId" | "channels" | "kind">;

export const styleAnchor = (draftId: string) => `style-${draftId}`;

/**
 * One style of the build, as a drilldown that starts open. Collapsing it is for
 * getting a finished style out of the way, not for hiding work by default.
 */
export function StyleBlock({
  draftId,
  index,
  total,
  payload,
  note,
  onRemove,
  children,
}: {
  draftId: string;
  index: number;
  total: number;
  payload: DraftPayloadV1;
  note?: string;
  onRemove?: () => void;
  children: ReactNode;
}) {
  const variants = payload.colorways.reduce((a, c) => a + c.variants.length, 0);
  return (
    <details open id={styleAnchor(draftId)} className="group scroll-mt-4 border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-b px-4 py-2.5 group-[:not([open])]:border-b-0 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate text-body">
          <span className="mr-2 inline-block w-3 text-muted-foreground transition-transform group-open:rotate-90">
            ›
          </span>
          {total > 1 ? `Style ${index + 1} · ` : ""}
          {payload.style?.styleName || (
            <span className="text-muted-foreground">no style chosen yet</span>
          )}
          <span className="ml-2 text-fine text-muted-foreground">
            {payload.colorways.length} colourway{payload.colorways.length === 1 ? "" : "s"} ·{" "}
            {variants} sizes
          </span>
          {note ? (
            <span className="ml-2 border border-ink px-2 py-0.5 text-fine text-ink">{note}</span>
          ) : null}
        </span>
        {onRemove ? (
          <button
            type="button"
            className="shrink-0 text-fine text-muted-foreground underline underline-offset-2"
            onClick={(e) => {
              // Inside <summary>, a click also toggles the drilldown.
              e.preventDefault();
              onRemove();
            }}
          >
            remove style
          </button>
        ) : null}
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}

/**
 * A second (third, …) style. It owns its draft's autosave, exactly as the page
 * owns the first style's, and stays mounted on every step so a pending save is
 * never dropped by moving to Review.
 */
export function SiblingStyle({
  member,
  index,
  total,
  shared,
  options,
  visible,
  onReport,
  onRemove,
}: {
  member: StyleMember;
  index: number;
  total: number;
  shared: SharedChoices;
  options: WizardOptions;
  visible: boolean;
  onReport: (id: string, report: StyleReport) => void;
  onRemove: () => void;
}) {
  const { payload, update, state, save, revision: revisionRef } = useDraftAutosave(
    member.id,
    member.payload,
    member.revision,
    "build"
  );

  // Season, channels, kind and brand follow the first style. Returning the
  // same object when nothing differs keeps the draft clean.
  useEffect(() => {
    update((p) =>
      p.brand.id === shared.brand.id &&
      p.seasonId === shared.seasonId &&
      p.kind === shared.kind &&
      p.channels.join() === shared.channels.join()
        ? p
        : { ...p, brand: shared.brand, seasonId: shared.seasonId, channels: shared.channels, kind: shared.kind }
    );
  }, [shared, update]);

  useEffect(() => {
    onReport(member.id, { payload, state, save });
  }, [member.id, payload, state, save, onReport]);

  if (!visible) return null;
  return (
    <StyleBlock draftId={member.id} index={index} total={total} payload={payload} onRemove={onRemove}>
      <StepBuild
        payload={payload}
        update={update}
        options={options}
        draftId={member.id}
        revisionRef={revisionRef}
        onImported={(p, rev) => {
          revisionRef.current = rev;
          update(p);
        }}
      />
    </StyleBlock>
  );
}
