import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QrCode } from '../../components/music.tsx';
import { Button, Card, Field, Input, Notice, Spinner } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { theme } from '../../lib/theme.ts';
import { LegalLinks } from '../legal/LegalPages.tsx';
import { errorMessage } from './shared.tsx';

function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="bg-party flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src={theme.event.logo} alt="" className="h-12 w-12" />
          <div>
            <div className="font-display text-xl font-bold">{theme.event.name}</div>
            <div className="text-sm text-muted">Adminbereich</div>
          </div>
        </div>
        <Card title={title}>{children}</Card>
        <div className="mt-4">
          <LegalLinks admin />
        </div>
      </div>
    </main>
  );
}

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ ticket: string }>('/api/admin/auth/login', { username, password });
      setTicket(result.ticket);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/admin/auth/verify', useRecovery ? { ticket, recoveryCode: code } : { ticket, code });
      onLoggedIn();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof Error && e.message === 'login_expired') setTicket(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title={ticket ? 'Zwei-Faktor-Bestätigung' : 'Anmelden'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void (ticket ? verify() : login());
        }}
      >
        {!ticket ? (
          <>
            <Field label="Benutzername">
              <Input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </Field>
            <Field label="Passwort">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
          </>
        ) : (
          <>
            <Field label={useRecovery ? 'Wiederherstellungscode' : 'Code aus der Authenticator-App'}>
              <Input
                autoFocus
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="text-center font-mono text-2xl tracking-[0.3em]"
              />
            </Field>
            <button
              type="button"
              className="self-start text-sm text-accent underline"
              onClick={() => setUseRecovery(!useRecovery)}
            >
              {useRecovery ? 'Authenticator-Code verwenden' : 'Wiederherstellungscode verwenden'}
            </button>
          </>
        )}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Button type="submit" size="lg" busy={busy}>
          {ticket ? 'Bestätigen' : 'Weiter'}
        </Button>
      </form>
    </AuthShell>
  );
}

const INVITE_TOKEN_KEY = 'admin-invite-token';

function readInviteToken(): string {
  const fromHash = window.location.hash.slice(1);
  try {
    if (fromHash) sessionStorage.setItem(INVITE_TOKEN_KEY, fromHash);
    return fromHash || (sessionStorage.getItem(INVITE_TOKEN_KEY) ?? '');
  } catch {
    return fromHash;
  }
}

function forgetInviteToken() {
  try {
    sessionStorage.removeItem(INVITE_TOKEN_KEY);
  } catch {
    return;
  }
}

export function InvitePage() {
  const navigate = useNavigate();
  const [token] = useState(readInviteToken);
  const [info, setInfo] = useState<{ username: string; displayName: string; role: string } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; setupToken: string } | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const startSetup = useCallback(async () => {
    setBusy(true);
    setError(null);
    setCode('');
    try {
      setSetup(await api.post('/api/admin/auth/invite/setup', { token }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    window.history.replaceState(null, '', '/admin/invite');
    if (!token) {
      setError('Einladungslink unvollständig – bitte den Link erneut öffnen.');
      return;
    }
    void (async () => {
      try {
        setInfo(await api.post('/api/admin/auth/invite/info', { token }));
      } catch (e) {
        setError(errorMessage(e));
        if (e instanceof ApiError && e.status === 404) forgetInviteToken();
        return;
      }
      await startSetup();
    })();
  }, [token, startSetup]);

  async function complete() {
    if (password !== repeat) return setError('Die Passwörter stimmen nicht überein.');
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/api/admin/auth/invite/complete', {
        token,
        password,
        setupToken: setup?.setupToken,
        code,
      });
      forgetInviteToken();
      setRecoveryCodes(result.recoveryCodes);
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiError && e.code === 'setup_expired') setSetup(null);
    } finally {
      setBusy(false);
    }
  }

  if (recoveryCodes) {
    return (
      <AuthShell title="Wiederherstellungscodes sichern">
        <p className="mb-4 text-sm text-muted">
          Diese Codes werden nur jetzt angezeigt. Jeder funktioniert genau einmal, falls das Handy mit der
          Authenticator-App fehlt. Sicher aufbewahren (z. B. Passwortmanager).
        </p>
        <ul className="mb-6 grid grid-cols-2 gap-2 font-mono text-lg">
          {recoveryCodes.map((c) => (
            <li key={c} className="rounded-lg bg-raised px-3 py-2 text-center">
              {c}
            </li>
          ))}
        </ul>
        <Button size="lg" className="w-full" onClick={() => navigate('/admin')}>
          Codes gesichert – weiter
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Admin-Zugang einrichten">
      {!(info && setup) && !error ? <Spinner /> : null}
      {error && !(info && setup) ? <Notice tone="danger">{error}</Notice> : null}
      {info && !setup && error ? (
        <Button className="mt-4 w-full" busy={busy} onClick={() => void startSetup()}>
          2FA-Einrichtung neu starten
        </Button>
      ) : null}
      {info && setup ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void complete();
          }}
        >
          <p className="text-sm text-muted">
            Hallo <strong className="text-fg">{info.displayName}</strong>! Dein Benutzername ist{' '}
            <strong className="font-mono text-fg">{info.username}</strong> ({info.role}).
          </p>
          <p className="text-sm text-muted">
            Welche Daten der Adminbereich über dich speichert, steht in den{' '}
            <a href="/datenschutz#admin" target="_blank" className="text-accent underline">
              Datenschutzhinweisen für Admins
            </a>
            .
          </p>
          <Field label="Neues Passwort" hint="Mindestens 12 Zeichen, gerne ein Satz.">
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
            />
          </Field>
          <Field label="Passwort wiederholen">
            <Input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              required
            />
          </Field>
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-raised/60 p-4">
            <p className="text-sm text-muted">
              1. QR-Code mit einer Authenticator-App scannen (z. B. Microsoft oder Google Authenticator):
            </p>
            <QrCode value={setup.otpauth} size={200} />
            <code className="text-xs break-all text-muted">{setup.secret}</code>
          </div>
          <Field label="2. Angezeigten 6-stelligen Code eingeben">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="text-center font-mono text-2xl tracking-[0.3em]"
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" size="lg" busy={busy} disabled={code.length !== 6}>
            Zugang aktivieren
          </Button>
        </form>
      ) : null}
    </AuthShell>
  );
}

export function BootstrapPage() {
  const [form, setForm] = useState({ token: '', username: '', displayName: '' });
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ invitePath: string }>('/api/admin/auth/bootstrap', form);
      setLink(`${window.location.origin}${result.invitePath}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthShell title="Ersten Owner anlegen">
      {link ? (
        <div className="flex flex-col gap-4">
          <Notice tone="success">Einladung erstellt. Link öffnen und Zugang einrichten (24 h gültig):</Notice>
          <a className="font-mono text-sm break-all text-accent underline" href={link}>
            {link}
          </a>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Field label="Bootstrap-Token (Secret BOOTSTRAP_TOKEN)">
            <Input
              type="password"
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
              required
            />
          </Field>
          <Field label="Benutzername">
            <Input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
              pattern="[a-zA-Z0-9._-]{3,40}"
            />
          </Field>
          <Field label="Anzeigename">
            <Input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              required
            />
          </Field>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Button type="submit" busy={busy}>
            Einladung erzeugen
          </Button>
          <Link to="/admin" className="text-center text-sm text-muted underline">
            Zum Login
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

export function SpotifyCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState(null, '', '/admin/spotify/callback');
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError(params.get('error') ?? 'Spotify hat keinen Code geliefert.');
      return;
    }
    void api
      .post('/api/admin/spotify/callback', { code, state })
      .then(() => navigate('/admin/music?tab=spotify', { replace: true }))
      .catch((e: unknown) => setError(errorMessage(e)));
  }, [navigate]);
  return (
    <AuthShell title="Spotify verbinden">
      {error ? (
        <div className="flex flex-col gap-4">
          <Notice tone="danger">{error}</Notice>
          <Link to="/admin/music?tab=spotify" className="text-accent underline">
            Zurück
          </Link>
        </div>
      ) : (
        <Spinner />
      )}
    </AuthShell>
  );
}
