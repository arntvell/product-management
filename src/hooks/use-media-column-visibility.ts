"use client";

import { useState, useCallback, useMemo } from "react";
import {
  MEDIA_COLUMN_DEFINITIONS,
  DEFAULT_MEDIA_VISIBLE_KEYS,
  type MediaColumnKey,
} from "@/lib/media-columns";

const STORAGE_KEY = "metafield-manager:media-visible-columns";

function loadFromStorage(): Set<MediaColumnKey> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const keys = JSON.parse(raw) as string[];
    if (!Array.isArray(keys)) return null;
    const validKeys = new Set(MEDIA_COLUMN_DEFINITIONS.map((c) => c.key));
    const filtered = keys.filter((k) => validKeys.has(k as MediaColumnKey));
    return new Set(filtered as MediaColumnKey[]);
  } catch {
    return null;
  }
}

function saveToStorage(keys: Set<MediaColumnKey>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Ignore storage errors
  }
}

export function useMediaColumnVisibility() {
  const [visibleKeys, setVisibleKeys] = useState<Set<MediaColumnKey>>(
    () => loadFromStorage() || DEFAULT_MEDIA_VISIBLE_KEYS
  );

  const toggleColumn = useCallback((key: MediaColumnKey) => {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      saveToStorage(next);
      return next;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setVisibleKeys(DEFAULT_MEDIA_VISIBLE_KEYS);
    saveToStorage(DEFAULT_MEDIA_VISIBLE_KEYS);
  }, []);

  const showAll = useCallback(() => {
    const all = new Set(MEDIA_COLUMN_DEFINITIONS.map((c) => c.key));
    setVisibleKeys(all);
    saveToStorage(all);
  }, []);

  const visibleColumns = useMemo(
    () => MEDIA_COLUMN_DEFINITIONS.filter((c) => visibleKeys.has(c.key)),
    [visibleKeys]
  );

  return {
    visibleKeys,
    visibleColumns,
    toggleColumn,
    resetToDefaults,
    showAll,
  };
}
