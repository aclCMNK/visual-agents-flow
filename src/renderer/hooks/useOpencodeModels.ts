/**
 * src/renderer/hooks/useOpencodeModels.ts
 *
 * Custom hook — opencode CLI models lifecycle manager.
 * Calls listModels() on mount and exposes the result state.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listModels } from "../services/opencode-models.ts";

export interface UseOpencodeModelsResult {
  models: Record<string, string[]>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useOpencodeModels(): UseOpencodeModelsResult {
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState<number>(0);
  const mountedRef = useRef<boolean>(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void listModels().then((result) => {
      if (cancelled || !mountedRef.current) return;
      if (result.ok) {
        setModels(result.models);
        setError(null);
      } else {
        setModels({});
        setError(result.error ?? "Unknown error");
      }
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [fetchCount]);

  const refetch = useCallback(() => setFetchCount((c) => c + 1), []);

  return { models, loading, error, refetch };
}
