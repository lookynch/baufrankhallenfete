import { useState } from 'react';
import { Cover, MoodBadge } from '../../components/music.tsx';
import { Badge, Button, Card, Empty, Input } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { formatDuration, formatTime, useNow } from '../../lib/time.ts';
import { LevelPicker, Loading, PageTitle, useAdmin, useAdminData, useInFlight } from './shared.tsx';

interface RoundsData {
  round: {
    id: number;
    seq: number;
    level: number;
    setName: string | null;
    expectedCloseAt: number;
    totalVotes?: number;
    candidates: Array<{
      songId: number;
      title: string;
      artist: string;
      imageUrl: string | null;
      votes?: number;
      wishKey: string | null;
    }>;
  } | null;
  suspicious: Array<{ ip_key: string; devices: number }>;
  recent: Array<{
    id: number;
    seq: number;
    status: string;
    mood_level: number;
    opened_at: number;
    closed_at: number | null;
  }>;
  schedule: Array<{
    id: number;
    title: string;
    artist: string;
    imageUrl: string | null;
    level: number | null;
    votes: number;
    status: string;
    scheduledStart: number;
  }>;
  playing: { title: string; artist: string } | null;
}

interface Settings {
  nextRound: { levelOverride: number | null };
}

export function RoundsPage() {
  const { run, notify } = useAdmin();
  const { busy, guard } = useInFlight();
  const now = useNow(1000);
  const { data, error, reload } = useAdminData<RoundsData>('/api/admin/rounds/current', 8_000);
  const settings = useAdminData<Settings>('/api/admin/settings');
  const [songQuery, setSongQuery] = useState('');
  const [songResults, setSongResults] = useState<
    Array<{ id: number; title: string; artist: string; image_url: string | null }>
  >([]);

  if (!data) return <Loading error={error} />;
  const round = data.round;
  const planned = data.schedule.filter((e) => e.status === 'planned');

  function act(path: string, body: unknown = {}, success = 'Erledigt') {
    return guard(path, async () => {
      await run(() => api.post(path, body), success);
      await reload();
    });
  }

  function closeRound() {
    return guard('close', async () => {
      const result = await run(() => api.post<{ closeAt?: number }>('/api/admin/rounds/close'));
      if (result?.closeAt) notify(`Mindest-Abstimmzeit läuft noch – Runde endet um ${formatTime(result.closeAt)} Uhr`);
      else if (result) notify('Runde beendet');
      await reload();
    });
  }

  async function searchSongs() {
    const result = await run(() =>
      api.get<{ songs: Array<{ id: number; title: string; artist: string; image_url: string | null }> }>(
        `/api/admin/songs?q=${encodeURIComponent(songQuery)}`,
      ),
    );
    setSongResults(result?.songs.slice(0, 8) ?? []);
  }

  const override = settings.data?.nextRound.levelOverride ?? null;

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Voting & Queue"
        subtitle="Laufende Runde, Gewinnerliste und manuelle Eingriffe. Alles wird im Audit-Log festgehalten."
        actions={
          round ? (
            <>
              <Button
                variant="outline"
                busy={busy === 'close'}
                disabled={busy !== null}
                onClick={() => confirm('Runde jetzt beenden und Gewinner übernehmen?') && void closeRound()}
              >
                Runde jetzt beenden
              </Button>
              <Button
                variant="danger"
                busy={busy === '/api/admin/rounds/skip'}
                disabled={busy !== null}
                onClick={() =>
                  confirm('Runde verwerfen (keine Gewinner) und neu starten?') &&
                  void act('/api/admin/rounds/skip', {}, 'Runde übersprungen')
                }
              >
                Runde verwerfen
              </Button>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card
          title={
            round ? (
              <span className="flex items-center gap-3">
                Runde {round.seq} <MoodBadge level={round.level} />{' '}
                {round.setName ? <span className="text-sm text-muted">Set {round.setName}</span> : null}
              </span>
            ) : (
              'Keine offene Runde'
            )
          }
          actions={
            round ? (
              <span className="font-mono text-xl text-accent">{formatDuration(round.expectedCloseAt - now)}</span>
            ) : null
          }
        >
          {round ? (
            <ul className="flex flex-col gap-2">
              {[...round.candidates]
                .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
                .map((c) => (
                  <li key={c.songId} className="flex items-center gap-3 rounded-xl bg-raised/50 p-2">
                    <Cover src={c.imageUrl} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">
                        {c.wishKey ? <span className="mr-2 font-mono text-xs text-accent">{c.wishKey}</span> : null}
                        {c.title}
                      </div>
                      <div className="truncate text-sm text-muted">{c.artist}</div>
                    </div>
                    <span className="font-display text-2xl font-bold tabular-nums">{c.votes ?? 0}</span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>Die nächste Runde startet automatisch, sobald das Voting aktiv ist.</Empty>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Stimmung der nächsten Runde">
            <p className="mb-3 text-sm text-muted">
              Zielwert überschreiben. Die App bewegt sich trotzdem höchstens eine Stufe pro Runde dorthin. „Set“ =
              Standard des aktiven Sets.
            </p>
            <LevelPicker
              value={override}
              allowNull
              onChange={async (level) => {
                await run(
                  () => api.put('/api/admin/settings/nextRound', { levelOverride: level }),
                  'Ziel-Stimmung gespeichert',
                );
                await settings.reload();
              }}
            />
          </Card>
          <Card title="Auffällige Netze in dieser Runde">
            {data.suspicious.length === 0 ? (
              <p className="text-sm text-muted">Keine Auffälligkeiten.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {data.suspicious.map((s) => (
                  <li key={s.ip_key} className="flex items-center justify-between gap-2 rounded-xl bg-raised/50 p-2">
                    <span className="font-mono">{s.ip_key}…</span>
                    <span className="text-muted">{s.devices} Geräte</span>
                    {round ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy !== null}
                        onClick={() =>
                          confirm('Alle Stimmen dieses Netzes in der Runde ungültig machen?') &&
                          void act(
                            `/api/admin/rounds/${round.id}/invalidate`,
                            { ipKeyPrefix: s.ip_key },
                            'Stimmen ungültig gemacht',
                          )
                        }
                      >
                        Ungültig
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card
        title="Wiedergabeplan"
        actions={data.playing ? <span className="text-sm text-muted">Läuft: {data.playing.title}</span> : null}
      >
        {data.schedule.length === 0 ? (
          <Empty>Noch keine Gewinner geplant.</Empty>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.schedule.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-2">
                <span className="w-12 font-mono text-sm text-muted">{formatTime(e.scheduledStart)}</span>
                <Cover src={e.imageUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.title}</div>
                  <div className="truncate text-xs text-muted">
                    {e.artist} · {e.votes} Stimmen
                  </div>
                </div>
                <MoodBadge level={e.level} />
                <Badge tone={e.status === 'planned' ? 'neutral' : 'accent'}>
                  {e.status === 'planned' ? 'geplant' : 'in Spotify'}
                </Badge>
                {e.status === 'planned' ? (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null || planned[0]?.id === e.id}
                      onClick={() => void act(`/api/admin/playback/${e.id}/move`, { direction: 'up' })}
                      aria-label="Nach oben"
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null || planned.at(-1)?.id === e.id}
                      onClick={() => void act(`/api/admin/playback/${e.id}/move`, { direction: 'down' })}
                      aria-label="Nach unten"
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() => void act(`/api/admin/playback/${e.id}/cancel`, {}, 'Song entfernt')}
                    >
                      Entfernen
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div className="mt-5 border-t border-line pt-4">
          <h3 className="mb-2 text-sm font-semibold text-muted">Song direkt als Nächstes einplanen</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void searchSongs();
            }}
          >
            <Input
              placeholder="Titel oder Künstler aus der Bibliothek"
              maxLength={100}
              value={songQuery}
              onChange={(e) => setSongQuery(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Suchen
            </Button>
          </form>
          <ul className="mt-3 flex flex-col gap-1.5">
            {songResults.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                <Cover src={s.image_url} size={32} />
                <span className="min-w-0 flex-1 truncate">
                  {s.title} <span className="text-muted">– {s.artist}</span>
                </span>
                <Button
                  size="sm"
                  busy={busy === `insert-${s.id}`}
                  disabled={busy !== null}
                  onClick={() =>
                    void guard(`insert-${s.id}`, async () => {
                      const done = await run(
                        () => api.post('/api/admin/playback/insert', { songId: s.id }),
                        'Eingeplant',
                      );
                      if (done) setSongResults([]);
                      await reload();
                    })
                  }
                >
                  Einplanen
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Letzte Runden">
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1">Runde</th>
              <th>Status</th>
              <th>Level</th>
              <th>Start</th>
              <th>Ende</th>
            </tr>
          </thead>
          <tbody>
            {data.recent.map((r) => (
              <tr key={r.id} className="border-t border-line/60">
                <td className="py-1.5">{r.seq}</td>
                <td>{r.status}</td>
                <td>
                  <MoodBadge level={r.mood_level} />
                </td>
                <td>{formatTime(r.opened_at)}</td>
                <td>{r.closed_at ? formatTime(r.closed_at) : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
