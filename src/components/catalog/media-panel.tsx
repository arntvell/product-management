"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MediaManager, type MediaItem } from "./media-manager";
import { EditGate } from "@/components/auth/edit-gate";

interface Loaded {
  colorway: { id: string; name: string; styleId: string; colorwaySku: string; style: { styleName: string } };
  media: MediaItem[];
}

/**
 * A product's images, opened in place from a grid row — upload, role (gallery,
 * flat, men, women), order and delete without leaving the editor, the way a
 * description opens in its cell panel.
 */
export function MediaPanel({
  colorwayId,
  onClose,
  onChanged,
}: {
  colorwayId: string | null;
  onClose: () => void;
  /** The new image list, so the row's count and thumbnail keep up. */
  onChanged: (colorwayId: string, items: MediaItem[]) => void;
}) {
  // Each result remembers which product it is for, so switching rows shows
  // "Loading…" until the new one arrives instead of the previous product.
  const [result, setResult] = useState<{ id: string; data?: Loaded; error?: string } | null>(null);
  useEffect(() => {
    if (!colorwayId) return;
    let live = true;
    fetch(`/api/catalog/media?colorwayId=${encodeURIComponent(colorwayId)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Could not load the images");
        if (live) setResult({ id: colorwayId, data: json });
      })
      .catch((e) => {
        if (live) setResult({ id: colorwayId, error: e instanceof Error ? e.message : "Could not load the images" });
      });
    return () => {
      live = false;
    };
  }, [colorwayId]);
  const current = result && result.id === colorwayId ? result : null;
  const loaded = current?.data ?? null;
  const error = current?.error ?? null;

  return (
    <Sheet open={!!colorwayId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>
            {loaded ? `${loaded.colorway.style.styleName} · ${loaded.colorway.name}` : "Media"}
          </SheetTitle>
          <SheetDescription>
            {loaded ? (
              <>
                <span className="font-mono">{loaded.colorway.colorwaySku}</span> — drop images to
                upload, set Flat / Men / Women, drag to reorder. Saved as you go; push to send new
                images to the channels.
              </>
            ) : (
              "Loading…"
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {error ? <p className="text-body text-destructive">{error}</p> : null}
          {loaded ? (
            <EditGate permission="catalog">
              <MediaManager
                key={loaded.colorway.id}
                colorwayId={loaded.colorway.id}
                colorwayName={loaded.colorway.name}
                styleId={loaded.colorway.styleId}
                initialMedia={loaded.media}
                embedded
                onChanged={(items) => onChanged(loaded.colorway.id, items)}
              />
            </EditGate>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
