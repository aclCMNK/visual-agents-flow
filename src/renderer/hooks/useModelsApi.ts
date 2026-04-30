/**
 * src/renderer/hooks/useModelsApi.ts
 *
 * Custom hook — Models API lifecycle manager
 * ───────────────────────────────────────────
 * Manages the IPC call to `models-api:get-models` on mount, exposing
 * the result state for UI components to react to.
 *
 * STATE
 * ─────
 *   data    – The parsed models.dev JSON, or null
 *   loading – true while the IPC call is in flight
 *   status  – "fresh" | "downloaded" | "fallback" | "unavailable" | null
 *   error   – error message if status is "fallback" or "unavailable"
 *
 * METHODS
 * ───────
 *   refetch – Forces a new IPC call (re-checks staleness)
 *
 * USAGE
 * ─────
 * ```tsx
 * const { loading, status } = useModelsApi();
 * ```
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { getModels, type ModelsApiStatus } from "../services/models-api.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseModelsApiResult {
  /** The parsed models.dev JSON, or null if unavailable. */
  data: unknown | null;
  /** True while the IPC call is in flight. */
  loading: boolean;
  /** The outcome status, or null before the first call completes. */
  status: ModelsApiStatus | null;
  /** Error message if status is "fallback" or "unavailable". */
  error: string | null;
  /** Forces a new IPC call (re-checks staleness on the main process). */
  refetch: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * `useModelsApi` — React hook for models.dev API data lifecycle.
 *
 * Calls `getModels()` on mount and exposes the result state.
 * Calling `refetch()` triggers a new IPC call.
 */
export function useModelsApi(): UseModelsApiResult {
  const [data,    setData]    = useState<unknown | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [status,  setStatus]  = useState<ModelsApiStatus | null>(null);
  const [error,   setError]   = useState<string | null>(null);

  // Increment to trigger a refetch
  const [fetchCount, setFetchCount] = useState<number>(0);

  // Abort flag to prevent state updates after unmount
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    // Minimum display time for the loading state (avoids invisible flash)
    const MIN_LOADING_MS = 400;
    const startTime = Date.now();

    void getModels().then((result) => {
      if (cancelled || !mountedRef.current) return;

      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, MIN_LOADING_MS - elapsed);

      setTimeout(() => {
        if (cancelled || !mountedRef.current) return;
        setData(result.data);
        setStatus(result.status);
        setError(result.error ?? null);
        setLoading(false);
      }, remaining);
    });

    return () => { cancelled = true; };
  }, [fetchCount]);

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return { data, loading, status, error, refetch };
}
