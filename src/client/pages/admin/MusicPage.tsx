import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Cover, MoodBadge } from '../../components/music.tsx';
import { Badge, Button, Card, Empty, Field, Input, Notice, Select, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { berlinParts, formatDateTime, formatDayTime, formatTime, fromBerlin } from '../../lib/time.ts';
import { LevelPicker, PageTitle, useAdmin, useAdminData } from './shared.tsx';

interface SetRow {
  id: number;
  name: string;
  starts_at: number;
  ends_at: number;
  default_level: number;
}

interface Coverage {
  setId: number;
  name: string;
  durationMinutes: number;
  defaultLevel: number;
  byLevel: Record<string, { songs: number; minutes: number }>;
  nearbyMinutes: number;
  ok: boolean;
}

interface Song {
  id: number;
  title: string;
  artist: string;
  image_url: string | null;
  duration_ms: number;
  explicit: number;
  mood_level: number | null;
  active: number;
  set_ids: number[];
  playback_status: string | null;
}

interface Track {
  uri: string;
  title: string;
  artist: string;
  imageUrl: string | null;
  durationMs: number;
  known?: boolean;
}

const tabs = [
  { key: 'library', label: 'Bibliothek' },
  { key: 'add', label: 'Songs hinzufügen' },
  { key: 'sets', label: 'Sets & Zeitplan' },
  { key: 'spotify', label: 'Spotify' },
] as const;

export function MusicPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'library';
  const sets = useAdminData<{ sets: SetRow[]; coverage: Coverage[] }>('/api/admin/sets');
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Musik & Sets"
        subtitle="Songs auswählen, Stimmungslevel pflegen und festlegen, was wann zur Wahl steht."
      />
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button
            key={t.key}
            variant={tab === t.key ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setParams({ tab: t.key })}
          >
            {t.label}
          </Button>
        ))}
      </div>
      {tab === 'library' ? <Library sets={sets.data?.sets ?? []} /> : null}
      {tab === 'add' ? <AddSongs sets={sets.data?.sets ?? []} onChange={sets.reload} /> : null}
      {tab === 'sets' ? <Sets data={sets.data} reload={sets.reload} /> : null}
      {tab === 'spotify' ? <SpotifyPanel /> : null}
    </div>
  );
}

function Library({ sets }: { sets: SetRow[] }) {
  const { run } = useAdmin();
  const [setId, setSetId] = useState('');
  const [level, setLevel] = useState('');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const path = `/api/admin/songs?${new URLSearchParams({ ...(setId ? { setId } : {}), ...(level ? { level } : {}), ...(submitted ? { q: submitted } : {}) })}`;
  const { data, reload } = useAdminData<{ songs: Song[] }>(path);
  const setById = new Map(sets.map((s) => [s.id, s]));

  async function update(id: number, patch: Record<string, unknown>) {
    await run(() => api.patch(`/api/admin/songs/${id}`, patch));
    await reload();
  }

  return (
    <Card>
      <form
        className="mb-4 grid gap-3 sm:grid-cols-[1fr_12rem_10rem_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query);
        }}
      >
        <Input placeholder="Titel oder Künstler" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
          <option value="">Alle Sets</option>
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Alle Level</option>
          {[1, 2, 3, 4, 5].map((l) => (
            <option key={l} value={l}>
              Level {l}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          Filtern
        </Button>
      </form>
      {!data ? (
        <Spinner />
      ) : data.songs.length === 0 ? (
        <Empty>Keine Songs. Unter „Songs hinzufügen“ Playlists oder Titel importieren.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.songs.map((song) => (
            <li
              key={song.id}
              className={`flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-2 ${song.active ? '' : 'opacity-50'}`}
            >
              <Cover src={song.image_url} size={44} />
              <div className="min-w-[12rem] flex-1">
                <div className="truncate font-semibold">
                  {song.title} {song.explicit ? <Badge tone="warning">E</Badge> : null}
                </div>
                <div className="truncate text-sm text-muted">
                  {song.artist} · {song.set_ids.map((id) => setById.get(id)?.name ?? `#${id}`).join(', ') || 'kein Set'}
                  {song.playback_status ? ` · ${song.playback_status}` : ''}
                </div>
              </div>
              <LevelPicker
                value={song.mood_level}
                allowNull
                onChange={(l) => void update(song.id, { mood_level: l })}
              />
              <Button size="sm" variant="ghost" onClick={() => void update(song.id, { active: !song.active })}>
                {song.active ? 'Sperren' : 'Freigeben'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AddSongs({ sets, onChange }: { sets: SetRow[]; onChange: () => Promise<void> }) {
  const { run, notify } = useAdmin();
  const [setId, setSetId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [reference, setReference] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const playlists = useAdminData<{
    playlists: Array<{ uri: string; id: string; name: string; trackCount: number; owner: string }>;
  }>('/api/admin/spotify/playlists');

  useEffect(() => {
    if (!setId && sets[0]) setSetId(String(sets[0].id));
  }, [sets, setId]);

  async function search() {
    const result = await run(() =>
      api.get<{ tracks: Track[] }>(`/api/admin/spotify/search?q=${encodeURIComponent(query)}`),
    );
    setResults(result?.tracks ?? []);
  }

  async function importReference(ref: string) {
    let offset = 0;
    let imported = 0;
    setProgress({ done: 0, total: 1 });
    for (;;) {
      const page = await run(() =>
        api.post<{ imported: number; next: number | null; total: number }>('/api/admin/library/import', {
          reference: ref,
          setId: setId ? Number(setId) : null,
          offset,
        }),
      );
      if (!page) break;
      imported += page.imported;
      setProgress({ done: Math.min(page.total, offset + 50), total: page.total });
      if (page.next === null) break;
      offset = page.next;
    }
    setProgress(null);
    notify(`${imported} Songs importiert`);
    await onChange();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Ziel-Set">
        <Field label="Neue Songs landen in diesem Set" hint="Ohne eigenes Level gilt das Standard-Level des Sets.">
          <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="">Nur Bibliothek (kein Set)</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (Level {s.default_level})
              </option>
            ))}
          </Select>
        </Field>
        <div className="mt-5">
          <Field
            label="Spotify-Link oder URI (Song oder Playlist)"
            hint="Spotify erlaubt seit 2026 nur Playlists des Party-Accounts oder kollaborative Playlists. Fremde Playlists vorher in Spotify kopieren."
          >
            <div className="flex gap-2">
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="https://open.spotify.com/playlist/…"
              />
              <Button onClick={() => void importReference(reference)} disabled={!reference || progress !== null}>
                Import
              </Button>
            </div>
          </Field>
          {progress ? (
            <div className="mt-3">
              <div className="h-2 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </div>
              <div className="mt-1 text-xs text-muted">
                {progress.done} / {progress.total}
              </div>
            </div>
          ) : null}
        </div>
        <h3 className="mt-6 mb-2 text-sm font-semibold text-muted">Playlists des Party-Accounts</h3>
        {playlists.error ? <Notice tone="warning">Spotify nicht verbunden.</Notice> : null}
        <ul className="flex max-h-80 flex-col gap-1.5 overflow-auto">
          {playlists.data?.playlists.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl bg-raised/50 px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                {p.name}{' '}
                <span className="text-muted">
                  · {p.trackCount} Songs · {p.owner}
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={progress !== null}
                onClick={() => void importReference(p.uri)}
              >
                Importieren
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Spotify durchsuchen">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titel, Künstler …" />
          <Button type="submit" variant="outline">
            Suchen
          </Button>
        </form>
        <ul className="mt-4 flex flex-col gap-2">
          {results.map((track) => (
            <li key={track.uri} className="flex items-center gap-3 rounded-xl bg-raised/50 p-2">
              <Cover src={track.imageUrl} size={40} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{track.title}</div>
                <div className="truncate text-sm text-muted">{track.artist}</div>
              </div>
              {track.known ? <Badge tone="success">in Bibliothek</Badge> : null}
              <Button size="sm" onClick={() => void importReference(track.uri)}>
                Hinzufügen
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Sets({
  data,
  reload,
}: {
  data: { sets: SetRow[]; coverage: Coverage[] } | null;
  reload: () => Promise<void>;
}) {
  const { run } = useAdmin();
  const settings = useAdminData<{ event: { startsAt: number; endsAt: number }; voting: { startsAt: number } }>(
    '/api/admin/settings',
  );
  const [editing, setEditing] = useState<Partial<SetRow> | null>(null);
  if (!data || !settings.data) return <Spinner />;
  const { event, voting } = settings.data;
  const span = Math.max(1, event.endsAt - event.startsAt);
  const position = (t: number) => `${Math.min(100, Math.max(0, ((t - event.startsAt) / span) * 100))}%`;
  const coverage = new Map(data.coverage.map((c) => [c.setId, c]));

  async function save() {
    if (!editing) return;
    const body = {
      name: editing.name,
      starts_at: editing.starts_at,
      ends_at: editing.ends_at,
      default_level: editing.default_level,
    };
    const ok = await run(
      () => (editing.id ? api.put(`/api/admin/sets/${editing.id}`, body) : api.post('/api/admin/sets', body)),
      'Set gespeichert',
    );
    if (ok !== undefined) {
      setEditing(null);
      await reload();
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Zeitleiste des Abends"
        actions={
          <Button
            size="sm"
            onClick={() =>
              setEditing({
                name: '',
                starts_at: event.startsAt,
                ends_at: event.startsAt + 2 * 3_600_000,
                default_level: 3,
              })
            }
          >
            + Set
          </Button>
        }
      >
        <div className="relative mb-2 h-6 text-xs text-muted">
          <span className="absolute left-0">{formatTime(event.startsAt)}</span>
          <span className="absolute -translate-x-1/2" style={{ left: position(voting.startsAt) }}>
            ▼ Voting {formatTime(voting.startsAt)}
          </span>
          <span className="absolute right-0">{formatTime(event.endsAt)}</span>
        </div>
        <div className="relative h-20 overflow-hidden rounded-2xl bg-raised/60">
          {data.sets.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setEditing(s)}
              className={`absolute inset-y-2 overflow-hidden rounded-xl px-2 text-left text-sm font-semibold text-bg bg-mood-${s.default_level}`}
              style={{ left: position(s.starts_at), width: `calc(${position(s.ends_at)} - ${position(s.starts_at)})` }}
            >
              <div className="truncate">{s.name}</div>
              <div className="truncate text-xs opacity-80">
                {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
              </div>
            </button>
          ))}
        </div>
        <ul className="mt-5 flex flex-col gap-2">
          {data.sets.map((s) => {
            const c = coverage.get(s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-3">
                <div className="min-w-[10rem] flex-1">
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-sm text-muted">
                    {formatDayTime(s.starts_at)} – {formatTime(s.ends_at)}
                  </div>
                </div>
                <MoodBadge level={s.default_level} />
                <div className="flex gap-1 text-xs">
                  {[1, 2, 3, 4, 5].map((l) => (
                    <span
                      key={l}
                      className={`rounded-md px-1.5 py-0.5 ${c?.byLevel[l]?.songs ? `bg-mood-${l} text-bg` : 'bg-raised text-muted'}`}
                      title={`Level ${l}`}
                    >
                      {c?.byLevel[l]?.songs ?? 0}
                    </span>
                  ))}
                </div>
                <Badge tone={c?.ok ? 'success' : 'warning'}>
                  {c?.nearbyMinutes ?? 0} / {c?.durationMinutes ?? 0} min
                </Badge>
                <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                  Bearbeiten
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Grün = mindestens 1,5-fache Spielzeit an passender Musik (Standard-Level ±1) im Verhältnis zur Set-Dauer. Die
          Zahlen zeigen noch nicht gespielte Songs je Level.
        </p>
      </Card>
      {editing ? (
        <SetEditor
          value={editing}
          onChange={setEditing}
          onSave={save}
          onCancel={() => setEditing(null)}
          onDelete={
            editing.id
              ? async () => {
                  if (!confirm('Set löschen? Songs bleiben in der Bibliothek.')) return;
                  await run(() => api.post(`/api/admin/sets/${editing.id}/delete`), 'Set gelöscht');
                  setEditing(null);
                  await reload();
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function SetEditor({
  value,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  value: Partial<SetRow>;
  onChange: (v: Partial<SetRow>) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const start = berlinParts(value.starts_at ?? Date.now());
  const end = berlinParts(value.ends_at ?? Date.now());
  const setStart = (date: string, time: string) => {
    const startsAt = fromBerlin(date, time);
    const duration = (value.ends_at ?? startsAt) - (value.starts_at ?? startsAt);
    onChange({ ...value, starts_at: startsAt, ends_at: startsAt + Math.max(duration, 30 * 60_000) });
  };
  const setEnd = (time: string) => {
    let endsAt = fromBerlin(start.date, time);
    if (endsAt <= (value.starts_at ?? 0))
      endsAt = fromBerlin(berlinParts((value.starts_at ?? 0) + 86_400_000).date, time);
    onChange({ ...value, ends_at: endsAt });
  };
  return (
    <Card title={value.id ? `Set „${value.name}“ bearbeiten` : 'Neues Set'}>
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <Field label="Name">
          <Input
            value={value.name ?? ''}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            required
            maxLength={60}
          />
        </Field>
        <Field label="Standard-Stimmung">
          <div className="pt-1.5">
            <LevelPicker
              value={value.default_level ?? 3}
              onChange={(l) => onChange({ ...value, default_level: l ?? 3 })}
            />
          </div>
        </Field>
        <Field label="Datum">
          <Input type="date" value={start.date} onChange={(e) => setStart(e.target.value, start.time)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Von">
            <Input type="time" value={start.time} onChange={(e) => setStart(start.date, e.target.value)} required />
          </Field>
          <Field label="Bis" hint={end.date !== start.date ? 'nächster Tag' : undefined}>
            <Input type="time" value={end.time} onChange={(e) => setEnd(e.target.value)} required />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit">Speichern</Button>
          <Button variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          {onDelete ? (
            <Button variant="danger" className="ml-auto" onClick={onDelete}>
              Löschen
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function SpotifyPanel() {
  const { run } = useAdmin();
  const status = useAdminData<{
    configured: boolean;
    connected: boolean;
    accountName: string | null;
    authorizedAt: number | null;
    refreshValidUntil: number | null;
    redirectUri: string;
  }>('/api/admin/spotify/status');
  const player = useAdminData<{
    ok: boolean;
    deviceName?: string | null;
    deviceActive?: boolean;
    repeatState?: string | null;
    error?: string;
  }>('/api/admin/spotify/player');
  const settings = useAdminData<{ preshow: { playlistUri: string | null; level: number } }>('/api/admin/settings');
  const [preshow, setPreshow] = useState('');

  useEffect(() => {
    if (settings.data) setPreshow(settings.data.preshow.playlistUri ?? '');
  }, [settings.data]);

  if (!status.data) return <Spinner />;
  const s = status.data;

  async function connect() {
    const result = await run(() => api.post<{ url: string }>('/api/admin/spotify/authorize'));
    if (result) window.location.href = result.url;
  }

  async function command(action: 'skip' | 'repeat' | 'preshow') {
    await run(() => api.post(`/api/admin/spotify/${action}`), 'Befehl gesendet');
    await player.reload();
  }

  async function savePreshow(level?: number) {
    const uri = preshow.trim() ? normalizePlaylist(preshow.trim()) : null;
    await run(
      () => api.put('/api/admin/settings/preshow', { playlistUri: uri, ...(level ? { level } : {}) }),
      'Gespeichert',
    );
    await settings.reload();
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title="Verbindung">
        {!s.configured ? (
          <Notice tone="danger">SPOTIFY_CLIENT_ID und SPOTIFY_CLIENT_SECRET fehlen in den Secrets.</Notice>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">Status</dt>
          <dd>
            {s.connected ? <Badge tone="success">verbunden</Badge> : <Badge tone="danger">nicht verbunden</Badge>}
          </dd>
          <dt className="text-muted">Account</dt>
          <dd>{s.accountName ?? '–'}</dd>
          <dt className="text-muted">Freigabe gültig bis</dt>
          <dd>{s.refreshValidUntil ? formatDateTime(s.refreshValidUntil) : '–'}</dd>
          <dt className="text-muted">Redirect-URI</dt>
          <dd className="font-mono text-xs break-all">{s.redirectUri}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">
          Die Redirect-URI muss exakt so in der Spotify-App eingetragen sein. Mit dem Premium-Party-Account verbinden,
          der auch auf dem Abspielgerät läuft.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void connect()} disabled={!s.configured}>
            {s.connected ? 'Neu verbinden' : 'Mit Spotify verbinden'}
          </Button>
          {s.connected ? (
            <Button
              variant="danger"
              onClick={() =>
                confirm('Spotify trennen?') &&
                void run(() => api.post('/api/admin/spotify/disconnect'), 'Getrennt').then(status.reload)
              }
            >
              Trennen
            </Button>
          ) : null}
        </div>
      </Card>
      <Card title="Abspielgerät">
        {player.data?.ok ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Gerät</dt>
            <dd>
              {player.data.deviceName ?? '–'}{' '}
              {player.data.deviceActive ? <Badge tone="success">aktiv</Badge> : <Badge tone="danger">inaktiv</Badge>}
            </dd>
            <dt className="text-muted">Wiederholung</dt>
            <dd>
              {player.data.repeatState === 'context' ? (
                <Badge tone="success">Playlist</Badge>
              ) : (
                <Badge tone="warning">{player.data.repeatState ?? '–'}</Badge>
              )}
            </dd>
          </dl>
        ) : (
          <Notice tone="warning">
            Kein aktives Gerät gefunden ({player.data?.error ?? '…'}). Spotify auf dem Abspielgerät öffnen und kurz
            abspielen.
          </Notice>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void command('preshow')}>
            Vorprogramm starten
          </Button>
          <Button variant="outline" onClick={() => void command('repeat')}>
            Wiederholung an
          </Button>
          <Button variant="danger" onClick={() => confirm('Aktuellen Song überspringen?') && void command('skip')}>
            Song überspringen
          </Button>
        </div>
      </Card>
      <Card title="Vorprogramm- & Notfall-Playlist" className="xl:col-span-2">
        <p className="mb-3 text-sm text-muted">
          Läuft bis zu den ersten Gewinnern und nur im Notfall (App/Netz weg). Muss eine eigene Playlist des
          Party-Accounts sein und darf keine Songs aus den Sets enthalten.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Playlist-Link oder URI">
            <Input
              value={preshow}
              onChange={(e) => setPreshow(e.target.value)}
              placeholder="spotify:playlist:…"
              className="min-w-[20rem]"
            />
          </Field>
          <Button onClick={() => void savePreshow()}>Speichern</Button>
        </div>
        <PreshowCheck key={settings.data?.preshow.playlistUri ?? 'none'} />
        <div className="mt-4">
          <span className="mb-1 block text-sm text-muted">Stimmungslevel der Playlist</span>
          <LevelPicker value={settings.data?.preshow.level ?? 2} onChange={(l) => l && void savePreshow(l)} />
        </div>
      </Card>
    </div>
  );
}

function PreshowCheck() {
  const { data, error } = useAdminData<{ checked: number; overlaps: Array<{ title: string; artist: string }> }>(
    '/api/admin/spotify/preshow-check',
  );
  if (error) return <Notice tone="warning">Playlist konnte nicht geprüft werden.</Notice>;
  if (!data || data.checked === 0) return null;
  if (data.overlaps.length === 0)
    return (
      <div className="mt-3">
        <Notice tone="success">{data.checked} Songs geprüft – keine Überschneidung mit den Sets.</Notice>
      </div>
    );
  return (
    <div className="mt-3">
      <Notice tone="warning">
        {data.overlaps.length} Songs sind auch in Sets:{' '}
        {data.overlaps
          .slice(0, 5)
          .map((o) => `${o.title} (${o.artist})`)
          .join(', ')}
        {data.overlaps.length > 5 ? ' …' : ''}. Bitte aus der Vorprogramm-Playlist entfernen, sonst kann die Erkennung
        sie verwechseln.
      </Notice>
    </div>
  );
}

function normalizePlaylist(input: string): string {
  const match = /playlist[/:]([A-Za-z0-9]{10,40})/.exec(input);
  return match ? `spotify:playlist:${match[1]}` : input;
}
