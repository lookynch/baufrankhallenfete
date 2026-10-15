import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner, useToast } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { passiveFingerprint } from '../../lib/fingerprint.ts';
import { useI18n, type MessageKey } from '../../lib/i18n.tsx';
import { usePolling } from '../../lib/polling.ts';
import { theme } from '../../lib/theme.ts';
import { turnstileToken } from '../../lib/turnstile.ts';
import { VoteTab, type GuestState } from './VoteTab.tsx';
import { WishTab } from './WishTab.tsx';

export function guestErrorKey(error: unknown): MessageKey {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'guest.error.network';
    const key = `guest.error.${error.code}`;
    if (['guest.error.ip_limit', 'guest.error.round_closed', 'guest.error.rate_limited'].includes(key))
      return key as MessageKey;
  }
  return 'guest.error.generic';
}

export function JoinPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.history.replaceState(null, '', '/');
    void (async () => {
      try {
        const config = await api.get<{ turnstileSiteKey: string | null }>('/api/public/config');
        const turnstile = await turnstileToken(config.turnstileSiteKey);
        await api.post('/api/public/join', { token, turnstile, fingerprint: passiveFingerprint() });
        navigate('/', { replace: true });
      } catch {
        setFailed(true);
      }
    })();
  }, [token, navigate]);

  return (
    <CenteredMessage>
      {failed ? (
        <>
          <ScanIcon />
          <p className="text-lg">{t('guest.qrExpired')}</p>
        </>
      ) : (
        <>
          <Spinner />
          <p className="text-muted">{t('guest.joining')}</p>
        </>
      )}
    </CenteredMessage>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-party flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
      <img src={theme.event.logo} alt="" className="h-16 w-16" />
      {children}
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

function LanguageSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex rounded-full bg-raised p-1 text-xs font-semibold ring-1 ring-line">
      {(['de', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          className={`rounded-full px-3 py-1 uppercase ${lang === l ? 'bg-primary text-on-primary' : 'text-muted'}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function GuestApp() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'vote' | 'wish'>('vote');
  const toast = useToast();
  const load = useCallback(() => api.get<GuestState>('/api/public/state'), []);
  const { data, error, offline, offsetMs, refresh } = usePolling(load);

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
        <p className="mt-10 text-center text-xs leading-relaxed text-muted/80">{t('privacy.note')}</p>
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
