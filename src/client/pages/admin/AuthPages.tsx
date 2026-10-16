import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { QrCode } from '../../components/music.tsx';
import { Button, Card, Field, Input, Notice, Spinner } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { createPasskey, passkeysSupported, signInWithPasskey } from '../../lib/passkey.ts';
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
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const offerPasskey = !ticket && passkeysSupported();

  async function loginWithPasskey() {
    setPasskeyBusy(true);
    setError(null);
    try {
      if (await signInWithPasskey('/api/admin/auth/passkey/options', '/api/admin/auth/passkey/verify')) onLoggedIn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPasskeyBusy(false);
    }
  }

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
      {offerPasskey ? (
        <div className="mb-5 flex flex-col gap-3">
          <Button size="lg" busy={passkeyBusy} onClick={() => void loginWithPasskey()}>
            Mit Passkey anmelden
          </Button>
          <div className="text-center text-sm text-muted">oder mit Passwort und Authenticator-App</div>
        </div>
      ) : null}
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
        <Button type="submit" size="lg" variant={offerPasskey ? 'outline' : 'primary'} busy={busy}>
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
  const [method, setMethod] = useState<'choose' | 'password'>(passkeysSupported() ? 'choose' : 'password');
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; setupToken: string } | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [passkeyReady, setPasskeyReady] = useState(false);
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
      }
    })();
  }, [token]);

  useEffect(() => {
    if (info && method === 'password') void startSetup();
  }, [info, method, startSetup]);

  async function setUpPasskey() {
    setBusy(true);
    setError(null);
    try {
      if (
        await createPasskey('/api/admin/auth/invite/passkey/options', '/api/admin/auth/invite/passkey/complete', {
          token,
        })
      ) {
        forgetInviteToken();
        setPasskeyReady(true);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

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

  if (passkeyReady) {
    return (
      <AuthShell title="Zugang eingerichtet">
        <div className="flex flex-col gap-4 text-sm text-muted">
          <p>Dein Passkey ist gespeichert. Ab jetzt meldest du dich mit Face ID, Touch ID oder PIN an.</p>
          <p>
            Weitere Geräte kannst du jederzeit unter „Mein Konto“ hinzufügen. Tipp: Über „Teilen → Zum Home-Bildschirm“
            bzw. „App installieren“ wird der Adminbereich zur App.
          </p>
          <Button size="lg" onClick={() => navigate('/admin')}>
            Weiter zum Adminbereich
          </Button>
        </div>
      </AuthShell>
    );
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

  const greeting = info ? (
    <>
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
    </>
  ) : null;

  return (
    <AuthShell title="Admin-Zugang einrichten">
      {!info && !error ? <Spinner /> : null}
      {!info && error ? <Notice tone="danger">{error}</Notice> : null}
      {info && method === 'choose' ? (
        <div className="flex flex-col gap-5">
          {greeting}
          <Button size="lg" busy={busy} onClick={() => void setUpPasskey()}>
            Mit Passkey einrichten
          </Button>
          <p className="-mt-2 text-center text-xs text-muted">
            Face ID, Touch ID, Windows Hello oder Bildschirmsperre – kein Passwort, keine App.
          </p>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <button
            type="button"
            className="text-sm text-accent underline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setMethod('password');
            }}
          >
            Stattdessen Passwort + Authenticator-App
          </button>
        </div>
      ) : null}
      {info && method === 'password' && !setup && !error ? <Spinner /> : null}
      {info && method === 'password' && !setup && error ? (
        <div className="flex flex-col gap-4">
          <Notice tone="danger">{error}</Notice>
          <Button className="w-full" busy={busy} onClick={() => void startSetup()}>
            2FA-Einrichtung neu starten
          </Button>
        </div>
      ) : null}
      {info && method === 'password' && setup ? (
        <form
          className="flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void complete();
          }}
        >
          {greeting}
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
