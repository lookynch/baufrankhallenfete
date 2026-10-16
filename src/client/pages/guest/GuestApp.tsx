import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Button, LanguageSwitch, Spinner, useToast } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import { usePolling } from '../../lib/polling.ts';
import { theme } from '../../lib/theme.ts';
import { legal } from '../../../shared/legal.ts';
import { LegalLinks } from '../legal/LegalPages.tsx';
import { VoteTab, type GuestState } from './VoteTab.tsx';
import { WishTab } from './WishTab.tsx';

const GUEST_ERRORS = ['ip_limit', 'round_closed', 'rate_limited', 'vote_invalidated'];
const JOIN_NETWORK_RETRIES = 3;

export function guestErrorKey(error: unknown): MessageKey {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'guest.error.network';
    if (GUEST_ERRORS.includes(error.code)) return `guest.error.${error.code}` as MessageKey;
  }
  return 'guest.error.generic';
}

export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [errorKey, setErrorKey] = useState<MessageKey | null>(null);
  const [attempt, setAttempt] = useState(0);
  const networkFailures = useRef(0);
  const running = useRef(false);

  useEffect(() => {
    if (running.current) return;
    running.current = true;
    let retry: number | undefined;
    const scheduleRetry = (ms: number) => {
      retry = window.setTimeout(() => setAttempt((a) => a + 1), ms);
    };
    void (async () => {
      try {
        await api.post('/api/public/join', { token });
        navigate('/', { replace: true });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'qr_expired') {
          window.history.replaceState(null, '', '/');
          setErrorKey('guest.qrExpired');
          return;
        }
        if (e instanceof ApiError && e.code === 'rate_limited') {
          setErrorKey(guestErrorKey(e));
          const seconds = Number(e.details.retryAfterSeconds) || 30;
          scheduleRetry(Math.min(seconds, 120) * 1000 + Math.random() * 5_000);
        } else if (e instanceof ApiError && (e.status === 0 || e.status >= 500)) {
          if (networkFailures.current < JOIN_NETWORK_RETRIES) {
            setErrorKey(guestErrorKey(e));
            networkFailures.current++;
            scheduleRetry(2_000 * 2 ** networkFailures.current);
          } else {
            setErrorKey('guest.error.generic');
          }
        } else {
          setErrorKey(guestErrorKey(e));
        }
      } finally {
        running.current = false;
      }
    })();
    return () => window.clearTimeout(retry);
  }, [token, navigate, attempt]);

  const retryNow = () => {
    networkFailures.current = 0;
    setErrorKey(null);
    setAttempt((a) => a + 1);
  };

  if (!errorKey) {
    return (
      <CenteredMessage>
        <Spinner />
        <p className="text-muted">{t('guest.joining')}</p>
      </CenteredMessage>
    );
  }
  return (
    <CenteredMessage>
      <ScanIcon />
      <p className="text-lg">{t(errorKey)}</p>
      {errorKey === 'guest.qrExpired' ? null : <Button onClick={retryNow}>{t('guest.retry')}</Button>}
    </CenteredMessage>
  );
}

const privacyParams = { name: legal.controller.name, days: legal.retention.guestDays };

function CenteredMessage({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="bg-party flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <img src={theme.event.logo} alt="" className="h-16 w-16" />
      {children}
      <footer className="mt-6 flex max-w-sm flex-col gap-2 text-xs leading-relaxed text-muted/80">
        <p>{t('privacy.short', privacyParams)}</p>
        <LegalLinks />
      </footer>
    </main>
  );
}

function ScanIcon() {
  return (
    <div className="grid h-24 w-24 place-items-center rounded-3xl bg-raised text-5xl ring-1 ring-line" aria-hidden>
      ⌗
    </div>
  );
}

export function GuestApp() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'vote' | 'wish'>('vote');
  const toast = useToast();
  const load = useCallback(() => api.get<GuestState>('/api/public/state'), []);
  const { data, error, offline, offsetMs, refresh } = usePolling(load, { pauseHidden: true });

  async function forget() {
    if (!confirm(t('privacy.forget.confirm'))) return;
    try {
      await api.post('/api/public/forget');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) return toast.show(t(guestErrorKey(e)), 'danger');
    }
    await refresh();
  }

  if (!data && !error) {
    return (
      <CenteredMessage>
        <Spinner />
      </CenteredMessage>
    );
  }
  if (data && !data.joined) {
    return (
      <CenteredMessage>
        <ScanIcon />
        <h1 className="text-2xl font-bold">{t('guest.scan.title')}</h1>
        <p className="max-w-sm text-muted">{t('guest.scan.text')}</p>
        <LanguageSwitch />
      </CenteredMessage>
    );
  }

  return (
    <div className="bg-party min-h-dvh pb-28">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 bg-bg/80 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <img src={theme.event.logo} alt="" className="h-8 w-8" />
          <span className="font-display font-bold">{data?.eventName ?? theme.event.name}</span>
        </div>
        <LanguageSwitch />
      </header>
      {offline ? (
        <div className="bg-warning/15 px-4 py-2 text-center text-sm text-warning">{t('guest.error.network')}</div>
      ) : null}
      <main className="mx-auto max-w-lg px-4 pt-2">
        {data && tab === 'vote' ? (
          <VoteTab state={data} offsetMs={offsetMs} refresh={refresh} toast={toast.show} />
        ) : null}
        {tab === 'wish' ? <WishTab toast={toast.show} /> : null}
        <footer className="mt-10 flex flex-col items-center gap-3 text-center text-xs leading-relaxed text-muted/80">
          <p>{t('privacy.note', privacyParams)}</p>
          <LegalLinks />
          <button
            type="button"
            onClick={() => void forget()}
            className="text-muted underline underline-offset-2 hover:text-fg"
          >
            {t('privacy.forget')}
          </button>
        </footer>
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/60 bg-bg/90 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto grid max-w-lg grid-cols-2 gap-2">
          {(['vote', 'wish'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`h-14 rounded-2xl text-base font-bold transition ${tab === key ? 'bg-primary text-on-primary glow' : 'bg-surface text-muted ring-1 ring-line'}`}
            >
              {key === 'vote' ? `🗳 ${t('guest.tab.vote')}` : `🎵 ${t('guest.tab.wish')}`}
            </button>
          ))}
        </div>
      </nav>
      {toast.element}
    </div>
  );
}
