import { Link } from 'react-router';
import { Cover, MoodBadge } from '../../components/music.tsx';
import { Badge, Card, Notice, Spinner, Stat } from '../../components/ui.tsx';
import { formatDuration, formatEuro, formatTime, useNow } from '../../lib/time.ts';
import { PageTitle, useAdminData } from './shared.tsx';

interface DashboardData {
  now: number;
  spotify: { configured: boolean; connected: boolean; accountName: string | null; refreshValidUntil: number | null };
  snapshot: { fetchedAt: number; error: string | null } | null;
  nowPlaying: { title: string; artist: string; imageUrl: string | null } | null;
  round: { id: number; seq: number; level: number; expectedCloseAt: number } | null;
  upNext: Array<{
    id: number;
    title: string;
    artist: string;
    level: number | null;
    status: string;
    scheduledStart: number;
  }>;
  agents: Array<{ id: string; at: number; queueLength: number; serialOk: boolean | null }>;
  displays: Array<{ id: number; name: string; kind: string; last_seen_at: number | null }>;
  budget: { requestsToday: number | null; fraction: number | null; fetchedAt: number; error: string | null } | null;
  ipLimitRejections: number;
  emergencies: { n: number; last_at: number | null } | null;
  counts: { devices: number; open_wishes: number; flagged_presses: number; votes: number } | null;
  coverage: Array<{
    setId: number;
    name: string;
    durationMinutes: number;
    defaultLevel: number;
    nearbyMinutes: number;
    ok: boolean;
  }>;
  stats: { totalCrates: number; totalCostCents: number; ratePerHour: number };
  settings: { voting: { enabled: boolean; startsAt: number }; event: { startsAt: number; endsAt: number } };
  accessConfigured: boolean;
}

function ago(now: number, at: number | null | undefined): string {
  if (!at) return 'nie';
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 90) return `vor ${seconds} s`;
  return `vor ${Math.round(seconds / 60)} min`;
}

export function Dashboard() {
  const { data } = useAdminData<DashboardData>('/api/admin/dashboard', 10_000);
  const now = useNow(1000);
  if (!data) return <Spinner />;

  const agentHealthy = data.agents.some((a) => now - a.at < 60_000);
  const spotifyHealthy =
    data.spotify.connected && !data.snapshot?.error && data.snapshot && now - data.snapshot.fetchedAt < 30_000;
  const warnings: string[] = [];
  if (!data.spotify.configured) warnings.push('Spotify-Secrets fehlen (SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET).');
  else if (!data.spotify.connected) warnings.push('Spotify ist nicht verbunden.');
  if (data.spotify.refreshValidUntil && data.spotify.refreshValidUntil - now < 30 * 86_400_000) {
    warnings.push('Spotify-Freigabe läuft in weniger als 30 Tagen ab – neu verbinden.');
  }
  if (!agentHealthy) warnings.push('Buzzer-PC meldet sich nicht (Heartbeat älter als 60 s).');
  if (!data.displays.some((d) => d.kind === 'tv' && d.last_seen_at && now - d.last_seen_at < 180_000))
    warnings.push('Kein TV-Display online.');
  for (const c of data.coverage.filter((c) => !c.ok)) {
    warnings.push(
      `Set „${c.name}“: nur ${c.nearbyMinutes} min passende Musik für ${c.durationMinutes} min – mehr Songs hinzufügen.`,
    );
  }
  const budgetFraction = data.budget?.fraction ?? 0;
  if (!data.budget || data.budget.error)
    warnings.push(
      'Budget-Wächter inaktiv – ohne Analytics-Daten (CF_ANALYTICS_TOKEN) werden Polling und Cover nicht gedrosselt.',
    );
  else if (budgetFraction >= 0.8)
    warnings.push('Request-Budget über 80 % – Polling stark gedrosselt, Gäste sehen keine Cover.');
  else if (budgetFraction >= 0.6) warnings.push('Request-Budget über 60 % – Polling wird automatisch gedrosselt.');
  const hints: string[] = [];
  if (!data.accessConfigured)
    hints.push('Cloudflare Access ist nicht eingerichtet – der Adminbereich ist nur durch Passwort und 2FA geschützt.');

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title="Übersicht" subtitle={`Stand ${formatTime(data.now)} Uhr · aktualisiert sich automatisch`} />
      {warnings.length ? (
        <div className="flex flex-col gap-2">
          {warnings.map((w) => (
            <Notice key={w} tone="warning">
              {w}
            </Notice>
          ))}
        </div>
      ) : (
        <Notice tone="success">Alles im grünen Bereich.</Notice>
      )}
      {hints.map((h) => (
        <Notice key={h}>{h}</Notice>
      ))}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Spotify"
          value={spotifyHealthy ? 'OK' : 'Prüfen'}
          tone={spotifyHealthy ? 'accent' : 'primary'}
          hint={data.spotify.accountName ?? data.snapshot?.error ?? '–'}
        />
        <Stat
          label="Buzzer-PC"
          value={agentHealthy ? 'Online' : 'Offline'}
          tone={agentHealthy ? 'accent' : 'primary'}
          hint={
            data.agents
              .map((a) => `${a.id}: ${ago(now, a.at)}${a.queueLength ? `, ${a.queueLength} im Puffer` : ''}`)
              .join(' · ') || 'noch nie gemeldet'
          }
        />
        <Stat
          label="Kästen"
          value={data.stats.totalCrates}
          hint={`${formatEuro(data.stats.totalCostCents)} · ${data.stats.ratePerHour}/h`}
        />
        <Stat
          label="Requests heute"
          value={data.budget?.requestsToday?.toLocaleString('de-DE') ?? '–'}
          hint={
            typeof data.budget?.fraction === 'number'
              ? `${Math.round(data.budget.fraction * 100)} % von 100.000`
              : (data.budget?.error ?? 'Analytics nicht konfiguriert')
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Musik"
          actions={
            <Link className="text-sm text-accent underline" to="/admin/rounds">
              Voting & Queue →
            </Link>
          }
        >
          {data.nowPlaying ? (
            <div className="mb-4 flex items-center gap-3">
              <Cover src={data.nowPlaying.imageUrl} size={56} />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-accent uppercase">Läuft gerade</div>
                <div className="truncate font-semibold">{data.nowPlaying.title}</div>
                <div className="truncate text-sm text-muted">{data.nowPlaying.artist}</div>
              </div>
            </div>
          ) : (
            <p className="mb-4 text-muted">Keine Wiedergabe erkannt.</p>
          )}
          {data.round ? (
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-raised/60 p-3">
              <span className="font-semibold">Runde {data.round.seq}</span>
              <MoodBadge level={data.round.level} />
              <span className="ml-auto font-mono text-accent">{formatDuration(data.round.expectedCloseAt - now)}</span>
            </div>
          ) : (
            <p className="mb-4 text-sm text-muted">
              Keine offene Runde. Voting{' '}
              {data.settings.voting.enabled
                ? `startet ${formatTime(data.settings.voting.startsAt)} Uhr`
                : 'ist deaktiviert'}
              .
            </p>
          )}
          <ol className="flex flex-col gap-1.5 text-sm">
            {data.upNext.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="w-12 font-mono text-muted">{formatTime(e.scheduledStart)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {e.title} <span className="text-muted">– {e.artist}</span>
                </span>
                <Badge tone={e.status === 'queued' ? 'accent' : 'neutral'}>{e.status}</Badge>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Gäste & Sicherheit">
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Geräte" value={data.counts?.devices ?? 0} />
            <Stat label="Stimmen" value={data.counts?.votes ?? 0} />
            <Stat
              label="IP-Ablehnungen heute"
              value={data.ipLimitRejections}
              hint="Bei vielen: Limit in Einstellungen erhöhen"
            />
            <Stat label="Offene Wünsche" value={data.counts?.open_wishes ?? 0} />
            <Stat
              label="Notfall-Songs"
              value={data.emergencies?.n ?? 0}
              hint={data.emergencies?.last_at ? `zuletzt ${formatTime(data.emergencies.last_at)}` : 'keine'}
            />
            <Stat
              label="Buzzer zu prüfen"
              value={data.counts?.flagged_presses ?? 0}
              hint="Drücke kurz hintereinander"
            />
          </div>
          <h3 className="mt-5 mb-2 text-sm font-semibold text-muted">Displays</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.displays.map((d) => (
              <li key={d.id} className="flex items-center justify-between">
                <span>
                  {d.name} <span className="text-muted">({d.kind})</span>
                </span>
                <Badge tone={d.last_seen_at && now - d.last_seen_at < 180_000 ? 'success' : 'danger'}>
                  {ago(now, d.last_seen_at)}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
