import { useCallback, useEffect, useRef, useState } from 'react';
import { Spinner } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { usePolling, useWakeLock } from '../../lib/polling.ts';
import { theme } from '../../lib/theme.ts';
import { BarLedger, type LedgerState } from './BarLedger.tsx';
import { BarStats, type StatsState } from './BarStats.tsx';
import { PlayerTicker, TvScreen, type MusicState } from './TvScreen.tsx';

type DisplayState =
  | (MusicState & { kind: 'tv' | 'player' })
  | (StatsState & { kind: 'bar_stats' })
  | (LedgerState & { kind: 'bar_ledger' });

export function DisplayApp() {
  useWakeLock();
  const load = useCallback(() => api.get<DisplayState>('/api/display/state'), []);
  const { data, error, offline, offsetMs, refresh } = usePolling(load, { tick: true });
  const { t } = useI18n();

  if (error?.status === 401) return <Pairing onPaired={refresh} />;
  if (!data) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg">
        <Spinner />
      </main>
    );
  }
  return (
    <div className="relative min-h-dvh overflow-hidden">
      {data.kind === 'tv' ? <TvScreen state={data} offsetMs={offsetMs} /> : null}
      {data.kind === 'player' ? <PlayerTicker state={data} offsetMs={offsetMs} /> : null}
      {data.kind === 'bar_stats' ? <BarStats state={data} /> : null}
      {data.kind === 'bar_ledger' ? <BarLedger state={data} /> : null}
      {offline ? (
        <div className="fixed top-4 right-4 rounded-full bg-warning px-4 py-1.5 text-sm font-bold text-bg">
          {t('display.offline')}
        </div>
      ) : null}
    </div>
  );
}

function Pairing({ onPaired }: { onPaired: () => Promise<void> }) {
  const { t } = useI18n();
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;
  const tRef = useRef(t);
  tRef.current = t;
  const [pairing, setPairing] = useState<{ code: string; secret: string; expiresAt: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const start = async () => {
      try {
        const next = await api.post<{ code: string; secret: string; expiresAt: number }>('/api/display/pair/start');
        if (cancelled) return;
        setPairing(next);
        setMessage(null);
        poll(next);
      } catch {
        timer = window.setTimeout(start, 10_000);
      }
    };
    const poll = (current: { code: string; secret: string }) => {
      timer = window.setTimeout(async () => {
        try {
          const result = await api.post<{ status: string }>('/api/display/pair/poll', current);
          if (cancelled) return;
          if (result.status === 'paired') return void onPairedRef.current();
          if (result.status === 'expired') {
            setMessage(tRef.current('display.pair.expired'));
            return void start();
          }
          poll(current);
        } catch (e) {
          if (!cancelled)
            timer = window.setTimeout(() => poll(current), e instanceof ApiError && e.status === 429 ? 30_000 : 5_000);
        }
      }, 3_000);
    };
    void start();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <main className="bg-party flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <img src={theme.event.logo} alt="" className="h-20 w-20" />
      <h1 className="text-4xl font-bold">{t('display.pair.title')}</h1>
      <div className="font-mono text-7xl font-bold tracking-[0.3em] text-primary tabular-nums sm:text-8xl">
        {pairing?.code ?? '······'}
      </div>
      <p className="max-w-xl text-lg text-muted">{t('display.pair.text')}</p>
      {message ? <p className="text-warning">{message}</p> : null}
    </main>
  );
}
