import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.ts';

export interface PolledState {
  now: number;
  pollAfterMs?: number;
  nextTickAt?: number | null;
}

export function usePolling<T extends PolledState>(
  load: () => Promise<T>,
  options: { tick?: boolean; pauseHidden?: boolean } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [offline, setOffline] = useState(false);
  const [offsetMs, setOffsetMs] = useState(0);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const unauthorized = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    window.clearTimeout(timer.current);
    let delay = 15_000;
    try {
      const requestedAt = Date.now();
      const next = await loadRef.current();
      const receivedAt = Date.now();
      setOffsetMs(next.now - (requestedAt + receivedAt) / 2);
      setData(next);
      setError(null);
      setOffline(false);
      failures.current = 0;
      unauthorized.current = false;
      delay = next.pollAfterMs ?? delay;
      if (options.tick && next.nextTickAt) delay = Math.min(delay, Math.max(2_000, next.nextTickAt - next.now));
    } catch (e) {
      failures.current++;
      const apiError = e instanceof ApiError ? e : new ApiError(0, 'unknown');
      setError((current) =>
        current?.status === apiError.status && current.code === apiError.code ? current : apiError,
      );
      setOffline(apiError.status === 0 || apiError.status >= 500);
      unauthorized.current = apiError.status === 401;
      if (unauthorized.current) return;
      delay = Math.min(60_000, 3_000 * 2 ** Math.min(failures.current, 5));
    }
    if (options.pauseHidden && document.visibilityState === 'hidden') return;
    timer.current = window.setTimeout(refresh, delay + Math.random() * 500);
  }, [options.tick, options.pauseHidden]);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        if (options.pauseHidden) window.clearTimeout(timer.current);
      } else if (!unauthorized.current) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, options.pauseHidden]);

  return { data, error, offline, offsetMs, refresh };
}

export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        lock = null;
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}
