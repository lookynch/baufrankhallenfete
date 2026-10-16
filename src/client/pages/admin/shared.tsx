import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Input, Notice, Spinner } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { passkeysSupported, signInWithPasskey } from '../../lib/passkey.ts';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: 'owner' | 'admin';
  reauthValid: boolean;
  recoveryCodesLeft: number;
  hasPassword: boolean;
  hasTotp: boolean;
  passkeyCount: number;
}

const messages: Record<string, string> = {
  invalid_credentials: 'Benutzername oder Passwort falsch.',
  invalid_code: 'Der Code ist ungültig oder wurde schon benutzt.',
  login_expired: 'Anmeldung abgelaufen – bitte erneut einloggen.',
  rate_limited: 'Zu viele Versuche. Bitte kurz warten.',
  reauth_required: 'Bitte die Aktion erneut bestätigen.',
  owner_required: 'Nur Owner dürfen das.',
  csrf_check_failed: 'Sicherheitsprüfung fehlgeschlagen – Seite neu laden.',
  access_required: 'Cloudflare Access verweigert den Zugriff.',
  not_authenticated: 'Bitte anmelden.',
  network_error: 'Keine Verbindung zum Server.',
  password_too_short: 'Passwort zu kurz (mindestens 12 Zeichen).',
  password_too_common: 'Passwort ist zu verbreitet.',
  password_contains_username: 'Passwort darf den Benutzernamen nicht enthalten.',
  password_too_simple: 'Passwort ist zu einfach.',
  setup_expired: '2FA-Einrichtung abgelaufen – bitte neu starten.',
  invite_invalid: 'Einladung ungültig oder abgelaufen.',
  invite_used: 'Einladung wurde bereits verwendet.',
  no_open_round: 'Keine offene Runde.',
  round_already_closed: 'Runde wurde bereits beendet.',
  pairing_not_found: 'Kopplungscode unbekannt oder abgelaufen.',
  spotify_not_configured: 'Spotify-Zugangsdaten fehlen in den Secrets.',
  spotify_exchange_failed: 'Spotify-Anmeldung fehlgeschlagen.',
  oauth_state_mismatch: 'Spotify-Anmeldung abgelaufen – bitte erneut verbinden.',
  preshow_playlist_missing: 'Keine Vorprogramm-Playlist in den Einstellungen.',
  already_reversed: 'Buchung wurde bereits storniert.',
  cannot_reverse_reversal: 'Ein Storno kann nicht storniert werden.',
  last_owner: 'Der letzte aktive Owner kann nicht gesperrt oder zum Admin herabgestuft werden.',
  username_exists: 'Benutzername existiert bereits – zum Zurücksetzen ausdrücklich bestätigen.',
  user_disabled: 'Dieser Zugang ist gesperrt – erst entsperren, dann neu einladen.',
  invite_revoked: 'Einladung wurde widerrufen. Bitte einen neuen Link anfordern.',
  ledger_accounts_must_differ: 'Vorrats-, Aufwands- und Verbindlichkeitskonto müssen verschieden sein.',
  unknown_ledger_account: 'Unbekanntes Konto – erst unter Buchhaltung anlegen.',
  event_end_before_start: 'Das Event-Ende muss nach dem Beginn liegen.',
  event_too_long: 'Ein Event darf höchstens 48 Stunden dauern.',
  voting_end_before_start: 'Das Voting-Ende muss nach dem Voting-Start liegen.',
  song_already_scheduled: 'Der Song ist bereits eingeplant.',
  song_is_round_candidate: 'Der Song steht gerade zur Wahl.',
  entry_not_movable: 'Dieser Eintrag kann nicht verschoben werden.',
  invalid_account: 'Ungültiges Konto.',
  cannot_disable_self: 'Du kannst dich nicht selbst deaktivieren.',
  entry_not_cancellable: 'Nur geplante Songs können entfernt werden.',
  invalid_spotify_reference: 'Kein gültiger Spotify-Link.',
  short_link_unsupported:
    'Kurzlinks (spotify.link) gehen nicht. In Spotify über „Teilen → Link kopieren“ den open.spotify.com-Link holen.',
  album_link_unsupported: 'Alben lassen sich nicht importieren – einzelne Songs oder eine Playlist verwenden.',
  already_bootstrapped: 'Es gibt bereits einen Owner.',
  invalid_bootstrap_token: 'Bootstrap-Token falsch.',
  no_neighbor: 'Der Eintrag steht schon ganz oben bzw. unten.',
  no_slot_available: 'Hinter dem laufenden Song ist kein Platz mehr frei – bitte später erneut versuchen.',
  song_not_found: 'Song nicht gefunden.',
  song_inactive: 'Der Song ist gesperrt – erst in der Bibliothek wieder aktivieren.',
  set_not_found: 'Das Set gibt es nicht mehr – Seite neu laden.',
  wish_not_found: 'Wunsch nicht gefunden.',
  wish_not_open: 'Der Wunsch wurde bereits entschieden.',
  same_account: 'Soll- und Habenkonto müssen verschieden sein.',
  unknown_account: 'Unbekanntes Konto – erst unter Buchhaltung anlegen.',
  invalid_amount: 'Ungültiger Betrag.',
  entry_not_found: 'Buchung nicht gefunden.',
  invalid_query: 'Ungültige Suche – mindestens 2 und höchstens 100 Zeichen.',
  internal_error: 'Interner Serverfehler – bitte erneut versuchen.',
  server_not_configured: 'Server nicht konfiguriert (Secrets fehlen).',
  passkey_failed: 'Passkey konnte nicht bestätigt werden.',
  passkey_exists: 'Dieser Passkey ist bereits eingerichtet.',
  challenge_expired: 'Passkey-Anfrage abgelaufen – bitte erneut versuchen.',
  passkeys_unavailable: 'Passkeys sind für diese Adresse nicht eingerichtet.',
  last_credential: 'Der letzte Passkey eines Kontos ohne Passwort kann nicht gelöscht werden.',
  no_passkey: 'Für dieses Konto ist kein Passkey eingerichtet.',
};

const spotifyMessages: Record<string, string> = {
  not_connected: 'Spotify ist nicht verbunden.',
  no_device: 'Kein aktives Spotify-Abspielgerät.',
  rate_limited: 'Spotify: zu viele Anfragen, bitte kurz warten.',
  unauthorized: 'Spotify-Freigabe ungültig – unter Musik → Spotify neu verbinden.',
  premium_required: 'Das verbundene Spotify-Konto hat kein Premium – zum Abspielen ist Premium nötig.',
  owner_premium_required:
    'Spotify sperrt die App: Der Inhaber der Spotify-Developer-App braucht ein aktives Premium-Abo.',
  user_not_registered:
    'Spotify sperrt das Konto: Im Spotify-Developer-Dashboard unter „User Management“ das verbundene Spotify-Konto eintragen.',
  forbidden: 'Spotify verweigert den Zugriff.',
  not_found: 'Bei Spotify nicht gefunden.',
  playlist_not_accessible:
    'Spotify gibt nur eigene oder kollaborative Playlists frei. Playlist in Spotify kopieren („Zu anderer Playlist hinzufügen“ → neue Playlist) und die Kopie importieren.',
  client_error: 'Spotify hat die Anfrage abgelehnt.',
  unknown: 'Spotify ist gerade nicht erreichbar.',
};

export function spotifyMessage(kind: string | undefined): string {
  return (kind && spotifyMessages[kind]) ?? `Spotify-Fehler (${kind ?? 'unbekannt'}).`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (messages[error.code]) return messages[error.code]!;
    if (error.code.startsWith('spotify_')) return spotifyMessage(error.code.slice('spotify_'.length));
    if (error.code.startsWith('set_overlaps:')) return `Überschneidet sich mit Set „${error.code.slice(13)}“.`;
    if (error.code === 'invalid_input') {
      const issues = (error.details.issues as Array<{ path: string; message: string }> | undefined) ?? [];
      return `Ungültige Eingabe: ${issues.map((i) => i.path || i.message).join(', ')}`;
    }
    if (error.status >= 500) return `Serverfehler (${error.code}) – bitte erneut versuchen.`;
    return `Fehler: ${error.code}`;
  }
  return 'Unbekannter Fehler.';
}

interface AdminContextValue {
  me: Me;
  reloadMe: () => Promise<void>;
  notify: (message: string, tone?: 'success' | 'danger') => void;
  run: <T>(action: () => Promise<T>, success?: string) => Promise<T | undefined>;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('AdminContext missing');
  return value;
}

export function AdminProvider({
  me,
  reloadMe,
  notify,
  children,
}: {
  me: Me;
  reloadMe: () => Promise<void>;
  notify: (message: string, tone?: 'success' | 'danger') => void;
  children: ReactNode;
}) {
  const [reauth, setReauth] = useState<{ resolve: (ok: boolean) => void } | null>(null);

  const run = useCallback(
    async <T,>(action: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const result = await action();
        if (success) notify(success);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.code === 'reauth_required') {
          const ok = await new Promise<boolean>((resolve) => setReauth({ resolve }));
          setReauth(null);
          if (ok) return run(action, success);
          return undefined;
        }
        if (error instanceof ApiError && error.code === 'not_authenticated') window.location.reload();
        notify(errorMessage(error), 'danger');
        return undefined;
      }
    },
    [notify],
  );

  return (
    <AdminContext.Provider value={{ me, reloadMe, notify, run }}>
      {children}
      {reauth ? <ReauthDialog me={me} onDone={(ok) => reauth.resolve(ok)} /> : null}
    </AdminContext.Provider>
  );
}

function ReauthDialog({ me, onDone }: { me: Me; onDone: (ok: boolean) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'code' | 'passkey' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const passkey = me.passkeyCount > 0 && passkeysSupported();
  useEffect(() => input.current?.focus(), []);

  async function confirmWith(kind: 'code' | 'passkey', action: () => Promise<boolean>) {
    setBusy(kind);
    setError(null);
    try {
      if (await action()) onDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title="Aktion bestätigen" onClose={() => onDone(false)}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void confirmWith('code', () => api.post('/api/admin/auth/reauth', { code }).then(() => true));
        }}
      >
        <p className="text-sm text-muted">
          {passkey
            ? 'Sicherheitskritische Aktionen bitte mit deinem Passkey (Face ID, Touch ID, Windows Hello) bestätigen.'
            : 'Für sicherheitskritische Aktionen bitte den aktuellen Code aus der Authenticator-App eingeben.'}
        </p>
        {passkey ? (
          <Button
            size="lg"
            busy={busy === 'passkey'}
            disabled={busy !== null}
            onClick={() =>
              void confirmWith('passkey', () =>
                signInWithPasskey('/api/admin/auth/reauth/passkey/options', '/api/admin/auth/reauth/passkey'),
              )
            }
          >
            Mit Passkey bestätigen
          </Button>
        ) : null}
        {me.hasTotp ? (
          <Field label="2FA-Code">
            <Input
              ref={passkey ? undefined : input}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        ) : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(false)}>
            Abbrechen
          </Button>
          {me.hasTotp ? (
            <Button
              type="submit"
              variant={passkey ? 'outline' : 'primary'}
              busy={busy === 'code'}
              disabled={code.length !== 6 || busy !== null}
            >
              Bestätigen
            </Button>
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-bg/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="animate-pop w-full max-w-md rounded-3xl bg-surface p-6 shadow-2xl ring-1 ring-line">
        <h2 className="mb-4 text-xl font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function useInFlight() {
  const active = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const guard = useCallback(async (key: string, action: () => Promise<unknown>): Promise<void> => {
    if (active.current) return;
    active.current = true;
    setBusy(key);
    try {
      await action();
    } finally {
      active.current = false;
      setBusy(null);
    }
  }, []);
  return { busy, guard };
}

export function useAdminData<T>(path: string | null, intervalMs?: number) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: unknown }>({
    path,
    data: null,
    error: null,
  });
  const latest = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const request = ++latest.current;
    try {
      const data = await api.get<T>(path);
      if (request === latest.current) setState({ path, data, error: null });
    } catch (error) {
      if (request === latest.current) {
        setState((previous) => ({ path, data: previous.path === path ? previous.data : null, error }));
      }
    }
  }, [path]);
  useEffect(() => {
    void reload();
    if (!intervalMs) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [reload, intervalMs]);
  const current = state.path === path;
  return { data: current ? state.data : null, error: current ? state.error : null, reload };
}

export function Loading({ error }: { error: unknown }) {
  return error ? <Notice tone="danger">{errorMessage(error)}</Notice> : <Spinner />;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function LevelPicker({
  value,
  onChange,
  allowNull,
}: {
  value: number | null;
  onChange: (level: number | null) => void;
  allowNull?: boolean;
}) {
  const classes = ['', 'bg-mood-1', 'bg-mood-2', 'bg-mood-3', 'bg-mood-4', 'bg-mood-5'];
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          type="button"
          title={`Level ${level}`}
          onClick={() => onChange(level)}
          className={`h-8 w-8 rounded-lg text-sm font-bold transition ${value === level ? `${classes[level]} text-bg` : 'bg-raised text-muted hover:text-fg'}`}
        >
          {level}
        </button>
      ))}
      {allowNull ? (
        <button
          type="button"
          title="Set-Standard verwenden"
          onClick={() => onChange(null)}
          className={`h-8 rounded-lg px-2 text-xs font-semibold ${value === null ? 'bg-fg text-bg' : 'bg-raised text-muted'}`}
        >
          Set
        </button>
      ) : null}
    </div>
  );
}
