"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(defaultValue);
  const hydrated = useRef(false);
  // Capture the initial default so the hydration effect can merge against it
  // without needing it in the dependency array (keeps single-hydration).
  const defaultRef = useRef(defaultValue);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Merge over defaults so fields added after a value was persisted are
        // always present (a stored object from an older version won't have
        // them). Only merge plain objects; arrays/primitives replace directly.
        const isPlainObject = (v: unknown): v is Record<string, unknown> =>
          typeof v === "object" && v !== null && !Array.isArray(v);
        if (isPlainObject(defaultRef.current) && isPlainObject(parsed)) {
          setState({ ...defaultRef.current, ...parsed } as T);
        } else {
          setState(parsed as T);
        }
      }
    } catch {
      // Ignore parse errors
    }
    hydrated.current = true;
  }, [key]);

  // Persist to localStorage on changes (skip the initial hydration write)
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // Silently ignore storage errors
    }
  }, [key, state]);

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState(value);
    },
    []
  );

  return [state, setValue];
}
