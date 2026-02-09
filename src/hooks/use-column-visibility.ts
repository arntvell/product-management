"use client";

import { useState, useCallback, useMemo } from "react";
import { COLUMN_DEFINITIONS, DEFAULT_VISIBLE_KEYS } from "@/lib/columns";
import type { MetafieldKey } from "@/types";

const STORAGE_KEY = "metafield-manager:visible-columns";

function loadFromStorage(): Set<MetafieldKey> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const keys = JSON.parse(raw) as string[];
    if (!Array.isArray(keys)) return null;
    // Validate that all keys exist in column definitions
    const validKeys = new Set(COLUMN_DEFINITIONS.map((c) => c.key));
    const filtered = keys.filter((k) => validKeys.has(k as MetafieldKey));
    return new Set(filtered as MetafieldKey[]);
  } catch {
    return null;
  }
}

function saveToStorage(keys: Set<MetafieldKey>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // Ignore storage errors
  }
}

export function useColumnVisibility() {
  const [visibleKeys, setVisibleKeys] = useState<Set<MetafieldKey>>(
    () => loadFromStorage() || DEFAULT_VISIBLE_KEYS
  );

  const toggleColumn = useCallback((key: MetafieldKey) => {
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
    setVisibleKeys(DEFAULT_VISIBLE_KEYS);
    saveToStorage(DEFAULT_VISIBLE_KEYS);
  }, []);

  const showAll = useCallback(() => {
    const all = new Set(COLUMN_DEFINITIONS.map((c) => c.key));
    setVisibleKeys(all);
    saveToStorage(all);
  }, []);

  const visibleColumns = useMemo(
    () => COLUMN_DEFINITIONS.filter((c) => visibleKeys.has(c.key)),
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
