import { useEffect, useState, type ReactNode } from 'react';
import { legal } from '../../../shared/legal.ts';
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { berlinParts, formatDateTime, formatEuro, formatTime, fromBerlin } from '../../lib/time.ts';
import { PageTitle, useAdmin, useAdminData, useInFlight } from './shared.tsx';

export function BuzzerPage() {
  const { data } = useAdminData<{
    events: Array<{
      event_id: string;
      agent_id: string;
      source_code: string | null;
      pressed_at: number;
      received_at: number;
      flagged: number;
      booking_no: string | null;
      reversed: number;
    }>;
  }>('/api/admin/buzzer/events', 10_000);
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Buzzer"
        subtitle="Alle Drücke. Markierte kamen kurz nacheinander – bitte prüfen und ggf. unter Buchhaltung stornieren."
      />
      <Card>
        {!data ? (
          <Spinner />
        ) : data.events.length === 0 ? (
          <Empty>Noch keine Drücke.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2">Gedrückt</th>
                  <th>Empfangen</th>
                  <th>Beleg</th>
                  <th>Agent / Code</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <tr key={e.event_id} className="border-t border-line/60">
                    <td className="py-2 whitespace-nowrap">{formatDateTime(e.pressed_at)}</td>
                    <td className="whitespace-nowrap text-muted">{formatTime(e.received_at)}</td>
                    <td className="font-mono text-accent">{e.booking_no ?? '–'}</td>
                    <td className="font-mono text-xs">
                      {e.agent_id} / {e.source_code ?? '–'}
                    </td>
                    <td className="flex gap-1 py-2">
                      {e.flagged ? <Badge tone="warning">prüfen</Badge> : null}
                      {e.reversed ? <Badge tone="danger">storniert</Badge> : <Badge tone="success">gebucht</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function DisplaysPage() {
  const { run } = useAdmin();
  const { busy, guard } = useInFlight();
  const { data, reload } = useAdminData<{
    displays: Array<{
      id: number;
      name: string;
      kind: string;
      created_at: number;
      last_seen_at: number | null;
      revoked_at: number | null;
    }>;
  }>('/api/admin/displays', 15_000);
  const [form, setForm] = useState({ code: '', name: '', kind: 'tv' });
  const kinds: Record<string, string> = {
    tv: 'TV (Voting & Musik)',
    bar_stats: 'Bar 1 – Stattrack',
    bar_ledger: 'Bar 2 – Buchhaltung',
    player: 'Player-Taktgeber',
  };
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Displays"
        subtitle={`Bildschirme öffnen ${window.location.origin}/display, zeigen einen Code – hier eingeben.`}
      />
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <Card title="Display koppeln">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void guard('claim', async () => {
                const ok = await run(() => api.post('/api/admin/displays/claim', form), 'Display gekoppelt');
                if (ok) {
                  setForm({ code: '', name: '', kind: form.kind });
                  await reload();
                }
              });
            }}
          >
            <Field label="Code vom Bildschirm">
              <Input
                inputMode="numeric"
                maxLength={6}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })}
                className="text-center font-mono text-2xl tracking-[0.3em]"
                required
              />
            </Field>
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="z. B. TV Bühne"
                required
              />
            </Field>
            <Field label="Rolle">
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {Object.entries(kinds).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" busy={busy === 'claim'} disabled={form.code.length !== 6}>
              Koppeln
            </Button>
          </form>
        </Card>
        <Card title="Gekoppelte Displays">
          {!data ? (
            <Spinner />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.displays.map((d) => (
                <li
                  key={d.id}
                  className={`flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-3 ${d.revoked_at ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{d.name}</div>
                    <div className="text-sm text-muted">
                      {kinds[d.kind] ?? d.kind} · zuletzt {d.last_seen_at ? formatTime(d.last_seen_at) : 'nie'}
                    </div>
                  </div>
                  {d.revoked_at ? (
                    <Badge tone="danger">widerrufen</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        confirm(`${d.name} entkoppeln?`) &&
                        void run(() => api.post(`/api/admin/displays/${d.id}/revoke`), 'Widerrufen').then(reload)
                      }
                    >
                      Widerrufen
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

type SettingsData = {
  event: { name: string; startsAt: number; endsAt: number };
  voting: {
    enabled: boolean;
    startsAt: number;
    endsAt: number | null;
    firstRoundMinutes: number;
    minRoundMinutes: number;
    candidatesPerRound: number;
    maxMoodStep: number;
    allowExplicit: boolean;
  };
  security: { votesPerIpV4: number; votesPerIpV6: number; votesPerNetV6: number };
  ledger: {
    cratePriceCents: number;
    budgetCents: number;
    inventoryAccount: string;
    expenseAccount: string;
    payableAccount: string;
  };
  buzzer: { reviewIntervalSeconds: number };
  polling: { tvMs: number; playerMs: number; barMs: number; guestMs: number };
};

function DateTimeInput({ value, onChange }: { value: number; onChange: (ms: number) => void }) {
  const parts = berlinParts(value);
  return (
    <div className="grid grid-cols-[1fr_7rem] gap-2">
      <Input type="date" value={parts.date} onChange={(e) => onChange(fromBerlin(e.target.value, parts.time))} />
      <Input type="time" value={parts.time} onChange={(e) => onChange(fromBerlin(parts.date, e.target.value))} />
    </div>
  );
}

function SettingsCard<K extends keyof SettingsData>({
  title,
  section,
  data,
  onSaved,
  children,
}: {
  title: string;
  section: K;
  data: SettingsData;
  onSaved: () => Promise<void>;
  children: (value: SettingsData[K], set: (patch: Partial<SettingsData[K]>) => void) => ReactNode;
}) {
  const { run, notify } = useAdmin();
  const { busy, guard } = useInFlight();
  const [value, setValue] = useState(data[section]);
  useEffect(() => setValue(data[section]), [data, section]);
  return (
    <Card title={title}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (Object.values(value).some((v) => typeof v === 'number' && !Number.isFinite(v))) {
            notify('Bitte nur gültige Zahlen eingeben.', 'danger');
            return;
          }
          void guard('save', async () => {
            await run(() => api.put(`/api/admin/settings/${section}`, value), `${title} gespeichert`);
            await onSaved();
          });
        }}
      >
        {children(value, (patch) => setValue((current) => ({ ...current, ...patch })))}
        <Button type="submit" variant="outline" className="self-start" busy={busy !== null}>
          Speichern
        </Button>
      </form>
    </Card>
  );
}

const num = (v: string) => Number(v.replace(',', '.'));

function EuroInput({ cents, onChange }: { cents: number; onChange: (cents: number) => void }) {
  const [text, setText] = useState(() => (cents / 100).toFixed(2));
  useEffect(() => {
    setText((current) => (Object.is(Math.round(num(current) * 100), cents) ? current : (cents / 100).toFixed(2)));
  }, [cents]);
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(Math.round(num(e.target.value) * 100));
      }}
    />
  );
}

export function SettingsPage() {
  const { data, reload } = useAdminData<SettingsData>('/api/admin/settings');
  if (!data) return <Spinner />;
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Einstellungen"
        subtitle="Änderungen am Voting gelten ab der nächsten Runde. Alle Zeiten in deutscher Zeit."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <SettingsCard title="Event" section="event" data={data} onSaved={reload}>
          {(v, set) => (
            <>
              <Field label="Name">
                <Input value={v.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <Field label="Beginn">
                <DateTimeInput value={v.startsAt} onChange={(startsAt) => set({ startsAt })} />
              </Field>
              <Field label="Ende">
                <DateTimeInput value={v.endsAt} onChange={(endsAt) => set({ endsAt })} />
              </Field>
            </>
          )}
        </SettingsCard>
        <SettingsCard title="Voting" section="voting" data={data} onSaved={reload}>
          {(v, set) => (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={v.enabled} onChange={(e) => set({ enabled: e.target.checked })} />{' '}
                Voting aktiv
              </label>
              <Field label="Erstes Voting startet">
                <DateTimeInput value={v.startsAt} onChange={(startsAt) => set({ startsAt })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Dauer 1. Runde (min)" hint="mindestens 17">
                  <Input
                    type="number"
                    min={17}
                    value={v.firstRoundMinutes}
                    onChange={(e) => set({ firstRoundMinutes: num(e.target.value) })}
                  />
                </Field>
                <Field label="Mindest-Abstimmzeit (min)" hint="mindestens 17">
                  <Input
                    type="number"
                    min={17}
                    value={v.minRoundMinutes}
                    onChange={(e) => set({ minRoundMinutes: num(e.target.value) })}
                  />
                </Field>
                <Field label="Kandidaten pro Runde">
                  <Input
                    type="number"
                    min={4}
                    max={30}
                    value={v.candidatesPerRound}
                    onChange={(e) => set({ candidatesPerRound: num(e.target.value) })}
                  />
                </Field>
                <Field label="Max. Stimmungssprung">
                  <Input
                    type="number"
                    min={1}
                    max={4}
                    value={v.maxMoodStep}
                    onChange={(e) => set({ maxMoodStep: num(e.target.value) })}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.allowExplicit}
                  onChange={(e) => set({ allowExplicit: e.target.checked })}
                />{' '}
                Songs mit „Explicit“-Kennzeichnung erlauben
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={v.endsAt !== null}
                  onChange={(e) => set({ endsAt: e.target.checked ? data.event.endsAt : null })}
                />{' '}
                Voting-Ende festlegen
              </label>
              {v.endsAt !== null ? (
                <Field label="Voting endet">
                  <DateTimeInput value={v.endsAt} onChange={(endsAt) => set({ endsAt })} />
                </Field>
              ) : null}
            </>
          )}
        </SettingsCard>
        <SettingsCard title="Betrugsschutz" section="security" data={data} onSaved={reload}>
          {(v, set) => (
            <>
              <Notice>
                Mobilfunk teilt IPv4-Adressen (CGNAT, iCloud Private Relay). Zu niedrige IPv4-Werte sperren echte
                Kollegen aus – bei vielen Ablehnungen im Dashboard erhöhen.
              </Notice>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Stimmen pro IPv4 und Runde">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={v.votesPerIpV4}
                    onChange={(e) => set({ votesPerIpV4: num(e.target.value) })}
                  />
                </Field>
                <Field label="Stimmen pro IPv6-Anschluss (/64) und Runde">
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={v.votesPerIpV6}
                    onChange={(e) => set({ votesPerIpV6: num(e.target.value) })}
                  />
                </Field>
                <Field
                  label="Stimmen pro IPv6-Großnetz (/48) und Runde"
                  hint="Obergrenze für alle Anschlüsse eines Netzes – bremst Geräte, die ständig neue IPv6-Adressen ziehen."
                >
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={v.votesPerNetV6}
                    onChange={(e) => set({ votesPerNetV6: num(e.target.value) })}
                  />
                </Field>
              </div>
            </>
          )}
        </SettingsCard>
        <SettingsCard title="Buchhaltung" section="ledger" data={data} onSaved={reload}>
          {(v, set) => (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Durchschnittspreis pro Kasten (€)"
                  hint={Number.isFinite(v.cratePriceCents) ? formatEuro(v.cratePriceCents) : 'ungültig'}
                >
                  <EuroInput cents={v.cratePriceCents} onChange={(cratePriceCents) => set({ cratePriceCents })} />
                </Field>
                <Field
                  label="Budget (€)"
                  hint={Number.isFinite(v.budgetCents) ? formatEuro(v.budgetCents) : 'ungültig'}
                >
                  <EuroInput cents={v.budgetCents} onChange={(budgetCents) => set({ budgetCents })} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Konto Vorrat">
                  <Input value={v.inventoryAccount} onChange={(e) => set({ inventoryAccount: e.target.value })} />
                </Field>
                <Field label="Konto Aufwand">
                  <Input value={v.expenseAccount} onChange={(e) => set({ expenseAccount: e.target.value })} />
                </Field>
                <Field label="Konto Verbindl.">
                  <Input value={v.payableAccount} onChange={(e) => set({ payableAccount: e.target.value })} />
                </Field>
              </div>
            </>
          )}
        </SettingsCard>
        <SettingsCard title="Buzzer" section="buzzer" data={data} onSaved={reload}>
          {(v, set) => (
            <Field
              label="Drücke innerhalb von … Sekunden zur Prüfung markieren"
              hint="Es wird trotzdem gebucht; Markierte im Buzzer-Log prüfen."
            >
              <Input
                type="number"
                min={0}
                max={120}
                value={v.reviewIntervalSeconds}
                onChange={(e) => set({ reviewIntervalSeconds: num(e.target.value) })}
              />
            </Field>
          )}
        </SettingsCard>
        <SettingsCard title="Aktualisierungsintervalle" section="polling" data={data} onSaved={reload}>
          {(v, set) => (
            <div className="grid grid-cols-2 gap-3">
              <Field label="TV (ms)">
                <Input type="number" value={v.tvMs} onChange={(e) => set({ tvMs: num(e.target.value) })} />
              </Field>
              <Field label="Player-Tab (ms)">
                <Input type="number" value={v.playerMs} onChange={(e) => set({ playerMs: num(e.target.value) })} />
              </Field>
              <Field label="Bar-Screens (ms)">
                <Input type="number" value={v.barMs} onChange={(e) => set({ barMs: num(e.target.value) })} />
              </Field>
              <Field label="Gäste (ms)">
                <Input type="number" value={v.guestMs} onChange={(e) => set({ guestMs: num(e.target.value) })} />
              </Field>
            </div>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

type Role = 'owner' | 'admin';

interface AdminUserRow {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  disabled: number;
  last_login_at: number | null;
  sessions: number;
  has_password: number;
  passkeys: number;
}

interface InviteRow {
  username: string;
  display_name: string;
  role: Role;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  revoked: number;
}

const roleLabel: Record<Role, string> = { owner: 'Owner', admin: 'Admin' };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function inviteStatus(invite: InviteRow, now: number): string | null {
  if (invite.used_at) return 'eingelöst';
  if (invite.revoked) return 'widerrufen';
  if (invite.expires_at <= now) return 'abgelaufen';
  return null;
}

function loginMethod(user: AdminUserRow): string {
  const passkeys = user.passkeys === 1 ? '1 Passkey' : `${user.passkeys} Passkeys`;
  if (!user.has_password) return passkeys;
  return user.passkeys ? `Passwort + 2FA, ${passkeys}` : 'Passwort + 2FA';
}

export function UsersPage() {
  const { me, run, notify } = useAdmin();
  const { busy, guard } = useInFlight();
  const { data, reload } = useAdminData<{ users: AdminUserRow[]; invites: InviteRow[] }>('/api/admin/users');
  const [form, setForm] = useState<{ username: string; displayName: string; role: Role }>({
    username: '',
    displayName: '',
    role: 'admin',
  });
  const [link, setLink] = useState<{ username: string; url: string } | null>(null);
  const owner = me.role === 'owner';
  const users = data?.users ?? [];
  const existing = form.username.trim() ? users.find((u) => sameName(u.username, form.username)) : undefined;
  const now = Date.now();

  function changeUsername(username: string) {
    setForm((f) => {
      const before = users.find((u) => sameName(u.username, f.username));
      const match = username.trim() ? users.find((u) => sameName(u.username, username)) : undefined;
      if (match === before) return { ...f, username };
      if (match) return { username, displayName: match.display_name, role: match.role };
      return {
        username,
        displayName: before && f.displayName === before.display_name ? '' : f.displayName,
        role: 'admin',
      };
    });
  }

  function invite() {
    if (existing) {
      const roleChange =
        existing.role !== form.role
          ? `\nRolle ändert sich: ${roleLabel[existing.role]} → ${roleLabel[form.role]}.`
          : '';
      const question = `Zugang „${existing.username}“ zurücksetzen?\nBeim Einlösen werden Passkeys, Passwort und 2FA ersetzt und alle Sitzungen beendet.${roleChange}`;
      if (!confirm(question)) return;
    }
    const reset = Boolean(existing);
    void guard('invite', async () => {
      const result = await run(
        () => api.post<{ invitePath: string }>('/api/admin/users/invite', { ...form, ...(reset ? { reset } : {}) }),
        reset ? 'Reset-Link erstellt' : 'Einladung erstellt',
      );
      if (result) {
        setLink({ username: form.username.trim(), url: `${window.location.origin}${result.invitePath}` });
        await reload();
      }
    });
  }

  function revokeInvites(username: string) {
    if (!confirm(`Offene Einladungen für „${username}“ widerrufen? Der Link funktioniert danach nicht mehr.`)) return;
    void guard(`revoke-${username}`, async () => {
      const result = await run(() => api.post<{ revoked: number }>('/api/admin/users/invites/revoke', { username }));
      if (result) {
        notify(result.revoked === 1 ? 'Einladung widerrufen' : `${result.revoked} Einladungen widerrufen`);
        if (link && sameName(link.username, username)) setLink(null);
      }
      await reload();
    });
  }

  function userAction(id: number, path: string, success: string) {
    void guard(`${path}-${id}`, async () => {
      await run(() => api.post(`/api/admin/users/${id}/${path}`), success);
      await reload();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Admins"
        subtitle={`Jeder Admin hat einen eigenen Zugang – per Passkey oder mit Passwort und 2FA. Einladungen gelten 24 Stunden. Gesperrte Konten werden ${legal.retention.adminDays} Tage nach der letzten Anmeldung automatisch gelöscht; liegt diese schon länger zurück, beim nächsten täglichen Löschlauf.`}
      />
      <div className="grid gap-6 lg:grid-cols-[24rem_1fr]">
        <Card title={existing ? 'Zugang zurücksetzen' : 'Admin einladen'}>
          {!owner ? (
            <Notice>Nur Owner können Admins einladen oder sperren.</Notice>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                invite();
              }}
            >
              <Field
                label="Benutzername"
                hint="Für einen Reset (z. B. verlorener Passkey) denselben Benutzernamen eingeben und bestätigen."
              >
                <Input
                  value={form.username}
                  onChange={(e) => changeUsername(e.target.value)}
                  pattern="[a-zA-Z0-9._-]{3,40}"
                  required
                />
              </Field>
              {existing ? (
                <Notice tone={existing.disabled ? 'danger' : 'warning'}>
                  {existing.disabled
                    ? `„${existing.username}“ ist gesperrt. Erst entsperren, dann den Zugang zurücksetzen.`
                    : `„${existing.username}“ existiert bereits (${roleLabel[existing.role]}). Der Link setzt Passkeys, Passwort und 2FA dieses Zugangs zurück und beendet beim Einlösen alle Sitzungen.`}
                </Notice>
              ) : null}
              <Field label="Anzeigename">
                <Input
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  required
                />
              </Field>
              <Field
                label="Rolle"
                hint={
                  existing && existing.role !== form.role
                    ? `Ändert die Rolle von ${roleLabel[existing.role]} zu ${roleLabel[form.role]}.`
                    : undefined
                }
              >
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner (darf Admins verwalten)</option>
                </Select>
              </Field>
              <Button
                type="submit"
                variant={existing ? 'danger' : 'primary'}
                busy={busy === 'invite'}
                disabled={Boolean(existing?.disabled)}
              >
                {existing ? 'Zugang zurücksetzen' : 'Einladungslink erzeugen'}
              </Button>
              {link ? (
                <Notice tone="success">
                  Link für {link.username} persönlich übergeben (nicht in Gruppenchats):
                  <br />
                  <span className="font-mono text-xs break-all">{link.url}</span>
                </Notice>
              ) : null}
            </form>
          )}
        </Card>
        <Card
          title="Zugänge"
          actions={
            <Button
              size="sm"
              variant="outline"
              busy={busy === 'revoke-mine'}
              onClick={() =>
                void guard('revoke-mine', () =>
                  run(() => api.post('/api/admin/sessions/revoke-mine'), 'Andere Sitzungen beendet'),
                )
              }
            >
              Meine anderen Sitzungen beenden
            </Button>
          }
        >
          {!data ? (
            <Spinner />
          ) : (
            <ul className="flex flex-col gap-2">
              {data.users.map((u) => (
                <li
                  key={u.id}
                  className={`flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-3 ${u.disabled ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {u.display_name} <span className="font-mono text-sm text-muted">{u.username}</span>
                    </div>
                    <div className="text-sm text-muted">
                      {roleLabel[u.role]} · {loginMethod(u)} · {u.sessions} Sitzungen · Login{' '}
                      {u.last_login_at ? formatDateTime(u.last_login_at) : 'nie'}
                    </div>
                  </div>
                  {owner && u.id !== me.id ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => userAction(u.id, 'revoke-sessions', 'Sitzungen beendet')}
                      >
                        Abmelden
                      </Button>
                      <Button
                        size="sm"
                        variant={u.disabled ? 'outline' : 'danger'}
                        disabled={busy !== null}
                        onClick={() => userAction(u.id, u.disabled ? 'enable' : 'disable', 'Gespeichert')}
                      >
                        {u.disabled ? 'Entsperren' : 'Sperren'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {data?.invites.length ? (
            <>
              <h3 className="mt-5 mb-2 text-sm font-semibold text-muted">Einladungen</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {data.invites.map((i) => {
                  const status = inviteStatus(i, now);
                  return (
                    <li key={`${i.username}-${i.created_at}`} className="flex items-center justify-between gap-2">
                      <span className="font-mono">{i.username}</span>
                      <span className="ml-auto text-muted">{status ?? `gültig bis ${formatTime(i.expires_at)}`}</span>
                      {owner && !status ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          busy={busy === `revoke-${i.username}`}
                          disabled={busy !== null}
                          onClick={() => revokeInvites(i.username)}
                        >
                          Widerrufen
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

export function AuditPage() {
  const { me, run } = useAdmin();
  const [before, setBefore] = useState<number | null>(null);
  const audit = useAdminData<{
    entries: Array<{
      id: number;
      at: number;
      action: string;
      entity: string | null;
      entity_id: string | null;
      before_json: string | null;
      after_json: string | null;
      user_name: string | null;
    }>;
  }>(`/api/admin/audit${before ? `?before=${before}` : ''}`);
  const limits = useAdminData<{
    limits: Array<{ key: string; window_start: number; count: number; label: string | null }>;
  }>('/api/admin/ratelimits', 30_000);
  const entries = audit.data?.entries ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Audit & Sicherheit"
        subtitle={`Jede Änderung durch Admins wird protokolliert und nach ${legal.retention.auditDays} Tagen automatisch gelöscht.`}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card title="Audit-Log">
          <ul className="flex flex-col gap-2 text-sm">
            {entries.map((e) => (
              <li key={e.id} className="rounded-xl bg-raised/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{formatDateTime(e.at)}</span>
                  <Badge tone="accent">{e.action}</Badge>
                  <span className="font-semibold">{e.user_name ?? 'System'}</span>
                  {e.entity ? (
                    <span className="text-muted">
                      {e.entity} {e.entity_id}
                    </span>
                  ) : null}
                </div>
                {e.before_json || e.after_json ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Details</summary>
                    <pre className="mt-1 overflow-x-auto rounded-lg bg-bg p-2 text-xs">
                      {[e.before_json && `vorher: ${e.before_json}`, e.after_json && `nachher: ${e.after_json}`]
                        .filter(Boolean)
                        .join('\n')}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            {before ? (
              <Button size="sm" variant="ghost" onClick={() => setBefore(null)}>
                Neueste
              </Button>
            ) : null}
            {entries.length === 100 ? (
              <Button size="sm" variant="outline" onClick={() => setBefore(entries[entries.length - 1]!.id)}>
                Ältere laden
              </Button>
            ) : null}
          </div>
        </Card>
        <div className="flex flex-col gap-6">
          <Card title="Rate-Limits (letzte Stunde)">
            {limits.data?.limits.length ? (
              <ul className="flex flex-col gap-1.5 text-xs">
                {limits.data.limits.map((l) => (
                  <li key={`${l.key}-${l.window_start}`} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-mono" title={l.key}>
                      {l.label ? `login:${l.label}` : l.key}
                    </span>
                    <span className="tabular-nums">{l.count}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void run(() => api.post('/api/admin/ratelimits/clear', { key: l.key }), 'Freigegeben').then(
                          limits.reload,
                        )
                      }
                    >
                      lösen
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Keine aktiven Zähler.</p>
            )}
          </Card>
          {me.role === 'owner' ? (
            <Card title="Eventdaten bereinigen">
              <p className="mb-3 text-sm text-muted">
                Löscht sofort alle Gästedaten: Stimmen, Geräte, Netz-Schlüssel, Suchverlauf und Rate-Limits; Wünsche
                werden anonymisiert. Ohne Klick geschieht das automatisch {legal.retention.guestDays} Tage nach der
                letzten Aktivität. Nur nach der Fete! Musik, Buchhaltung und Audit (ohne IP-Bezug) bleiben erhalten.
              </p>
              <Button
                variant="danger"
                onClick={() =>
                  confirm('Wirklich alle Gästedaten sofort löschen? Die laufende Auszählung geht verloren.') &&
                  void run(() => api.post('/api/admin/cleanup'), 'Gästedaten gelöscht')
                }
              >
                Gästedaten löschen
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
