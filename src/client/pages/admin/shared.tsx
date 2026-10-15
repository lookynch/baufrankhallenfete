import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Field, Input, Notice } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: 'owner' | 'admin';
  reauthValid: boolean;
  recoveryCodesLeft: number;
}

const messages: Record<string, string> = {
  invalid_credentials: 'Benutzername oder Passwort falsch.',
  invalid_code: 'Der Code ist ungültig oder wurde schon benutzt.',
  login_expired: 'Anmeldung abgelaufen – bitte erneut einloggen.',
  rate_limited: 'Zu viele Versuche. Bitte kurz warten.',
  turnstile_failed: 'Bot-Prüfung fehlgeschlagen – Seite neu laden.',
  reauth_required: 'Bitte mit 2FA-Code bestätigen.',
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
  voting_end_before_start: 'Das Voting-Ende muss nach dem Voting-Start liegen.',
  song_already_scheduled: 'Der Song ist bereits eingeplant.',
  song_is_round_candidate: 'Der Song steht gerade zur Wahl.',
  entry_not_movable: 'Dieser Eintrag kann nicht verschoben werden.',
  invalid_account: 'Ungültiges Konto.',
  cannot_disable_self: 'Du kannst dich nicht selbst deaktivieren.',
  entry_not_cancellable: 'Nur geplante Songs können entfernt werden.',
  invalid_spotify_reference: 'Kein gültiger Spotify-Link.',
  already_bootstrapped: 'Es gibt bereits einen Owner.',
  invalid_bootstrap_token: 'Bootstrap-Token falsch.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (messages[error.code]) return messages[error.code]!;
    if (error.code.startsWith('set_overlaps:')) return `Überschneidet sich mit Set „${error.code.slice(13)}“.`;
    if (error.code === 'invalid_input') {
      const issues = (error.details.issues as Array<{ path: string; message: string }> | undefined) ?? [];
      return `Ungültige Eingabe: ${issues.map((i) => i.path || i.message).join(', ')}`;
    }
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
      {reauth ? <ReauthDialog onDone={(ok) => reauth.resolve(ok)} /> : null}
    </AdminContext.Provider>
  );
}

function ReauthDialog({ onDone }: { onDone: (ok: boolean) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  async function submit() {
    setBusy(true);
    try {
      await api.post('/api/admin/auth/reauth', { code });
      onDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Aktion bestätigen" onClose={() => onDone(false)}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted">
          Für sicherheitskritische Aktionen bitte den aktuellen Code aus der Authenticator-App eingeben.
        </p>
        <Field label="2FA-Code">
          <Input
            ref={input}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onDone(false)}>
            Abbrechen
          </Button>
          <Button type="submit" busy={busy} disabled={code.length !== 6}>
            Bestätigen
          </Button>
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
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (e) {
      setError(e);
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
  return { data, error, reload };
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
