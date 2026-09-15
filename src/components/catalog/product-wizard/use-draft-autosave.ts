"use client";

// Autosave for a whole-document draft.
//
// Modelled on catalog-grid.tsx:709-788, with one adaptation. That grid retires
// "only the keys sent, and only if unchanged", which needs a key map; a single
// JSON document has none. The equivalent guarantee is to snapshot what was sent
// and clear the dirty flag only if the current serialisation still equals it —
// so an edit made while the request was in flight stays dirty and saves next
// time, instead of being silently dropped.
//
// The server side is a compare-and-swap on `revision`, so two tabs cannot
// clobber each other: the loser gets a 409 and is told, rather than winning by
// being last.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { DraftPayloadV1, DraftStep } from "@/lib/master/draft-payload";

export const AUTOSAVE_IDLE_MS = 1500;

export type SaveState =
  | { kind: "clean" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string };

export function useDraftAutosave(
  draftId: string,
  initialPayload: DraftPayloadV1,
  initialRevision: number,
  initialStep: DraftStep
) {
  const [payload, setPayload] = useState(initialPayload);
  const [step, setStep] = useState<DraftStep>(initialStep);
  const [state, setState] = useState<SaveState>({ kind: "clean" });

  const revisionRef = useRef(initialRevision);
  const savingRef = useRef(false);
  // What the last request carried, so we know whether anything changed since.
  const sentRef = useRef(JSON.stringify(initialPayload) + "|" + initialStep);
  const currentRef = useRef(sentRef.current);
  const dirtyRef = useRef(false);

  const serialize = (p: DraftPayloadV1, s: DraftStep) => JSON.stringify(p) + "|" + s;

  const update = useCallback(
    (next: DraftPayloadV1 | ((prev: DraftPayloadV1) => DraftPayloadV1)) => {
      setPayload((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        currentRef.current = serialize(value, step);
        dirtyRef.current = currentRef.current !== sentRef.current;
        if (dirtyRef.current) setState({ kind: "dirty" });
        return value;
      });
    },
    [step]
  );

  const goToStep = useCallback(
    (s: DraftStep) => {
      setStep(s);
      currentRef.current = serialize(payload, s);
      dirtyRef.current = currentRef.current !== sentRef.current;
      if (dirtyRef.current) setState({ kind: "dirty" });
    },
    [payload]
  );

  const save = useCallback(async (): Promise<boolean> => {
    if (savingRef.current || !dirtyRef.current) return true;
    savingRef.current = true;
    const attempt = serialize(payload, step);
    setState({ kind: "saving" });
    try {
      const res = await fetch(`/api/catalog/drafts/${draftId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: revisionRef.current, payload, step }),
      });
      const json = await res.json();
      if (res.status === 409) {
        setState({ kind: "conflict", message: json.error ?? "Saved elsewhere" });
        return false;
      }
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      revisionRef.current = json.revision;
      sentRef.current = attempt;
      // Only clean if nothing changed while the request was in flight.
      if (currentRef.current === attempt) {
        dirtyRef.current = false;
        setState({ kind: "clean" });
      } else {
        setState({ kind: "dirty" });
      }
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not save";
      setState({ kind: "error", message });
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [draftId, payload, step]);

  // Idle debounce.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(() => {
      void save();
    }, AUTOSAVE_IDLE_MS);
    return () => clearTimeout(t);
  }, [payload, step, save]);

  // Don't let a closing tab take unsaved work with it.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // One toast per error, not one per retry.
  const lastToast = useRef<string>("");
  useEffect(() => {
    if (state.kind !== "error" && state.kind !== "conflict") {
      lastToast.current = "";
      return;
    }
    if (lastToast.current === state.message) return;
    lastToast.current = state.message;
    toast.error(state.message);
  }, [state]);

  return { payload, update, step, goToStep, state, save, revision: revisionRef };
}
