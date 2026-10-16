import { Cover, MoodBadge, QrCode, SpotifyLogo } from '../../components/music.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { theme } from '../../lib/theme.ts';
import { formatDuration, formatTime, useNow } from '../../lib/time.ts';

interface NowPlaying {
  title: string;
  artist: string;
  album: string | null;
  imageUrl: string | null;
  durationMs: number;
  progressMs: number;
  isPlaying: boolean;
  fetchedAt: number;
}

interface UpNext {
  id: number;
  title: string;
  artist: string;
  imageUrl: string | null;
  level: number | null;
  votes: number;
  scheduledStart: number;
}

export interface MusicState {
  now: number;
  eventName: string;
  nowPlaying: NowPlaying | null;
  spotifyError: string | null;
  upNext: UpNext[];
  voting?: { active: boolean; startsAt: number; endsAt: number | null };
  round?: {
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
  presence?: { token: string; validForMs: number };
  ticker?: Array<{ key: string; title: string; artist: string }>;
}

function useProgress(nowPlaying: NowPlaying | null, now: number) {
  if (!nowPlaying) return 0;
  const progress = nowPlaying.progressMs + (nowPlaying.isPlaying ? now - nowPlaying.fetchedAt : 0);
  return Math.min(nowPlaying.durationMs, Math.max(0, progress));
}

function NowPlayingPanel({
  nowPlaying,
  now,
  compact,
}: {
  nowPlaying: NowPlaying | null;
  now: number;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const progress = useProgress(nowPlaying, now);
  const logo = <SpotifyLogo size={compact ? 28 : 36} className="self-start" />;
  if (!nowPlaying) {
    return (
      <div className="flex items-center gap-6">
        <Cover src={null} size={compact ? 120 : 220} large />
        <div className={`flex-1 font-display font-bold text-muted ${compact ? 'text-3xl' : 'text-5xl'}`}>
          {t('tv.noMusic')}
        </div>
        {logo}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-6">
      <Cover src={nowPlaying.imageUrl} size={compact ? 120 : 220} large className="shadow-2xl" />
      <div className="min-w-0 flex-1">
        <div
          title={nowPlaying.title}
          className={`font-display leading-tight font-bold ${compact ? 'text-3xl' : 'text-5xl'} line-clamp-2`}
        >
          {nowPlaying.title}
        </div>
        <div title={nowPlaying.artist} className={`mt-2 truncate text-muted ${compact ? 'text-xl' : 'text-3xl'}`}>
          {nowPlaying.artist}
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-raised">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-1000 ease-linear"
            style={{ width: `${(progress / nowPlaying.durationMs) * 100}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-lg text-muted tabular-nums">
          <span>{formatDuration(progress)}</span>
          <span>{formatDuration(nowPlaying.durationMs)}</span>
        </div>
      </div>
      {logo}
    </div>
  );
}

export function TvScreen({ state, offsetMs }: { state: MusicState; offsetMs: number }) {
  const { t } = useI18n();
  const now = useNow(1000, offsetMs);
  const round = state.round;
  const sorted = round ? [...round.candidates].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0)) : [];
  const maxVotes = Math.max(1, ...sorted.map((c) => c.votes ?? 0));
  const qrUrl = state.presence ? `${window.location.origin}/v/${state.presence.token}` : null;

  return (
    <main className="bg-party grid h-dvh grid-cols-[1fr_minmax(0,0.9fr)] grid-rows-[auto_1fr_auto] gap-6 p-8">
      <header className="col-span-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={theme.event.logo} alt="" className="h-14 w-14" />
          <div>
            <div className="font-display text-3xl font-bold">{state.eventName}</div>
            <div className="text-lg text-muted">{theme.event.hosts}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {state.spotifyError ? (
            <span className="rounded-full bg-warning/20 px-4 py-1.5 font-semibold text-warning">
              {t('tv.spotifyIssue')}
            </span>
          ) : null}
          <div className="font-display text-4xl font-bold tabular-nums">{formatTime(now)}</div>
        </div>
      </header>

      <section className="flex min-h-0 flex-col gap-6">
        <div className="rounded-3xl bg-surface/70 p-6 ring-1 ring-line backdrop-blur">
          <NowPlayingPanel nowPlaying={state.nowPlaying} now={now} />
        </div>
        <div className="min-h-0 flex-1 rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <h2 className="mb-4 text-2xl font-bold text-muted">{t('tv.upNext')}</h2>
          {state.upNext.length === 0 ? <p className="text-xl text-muted">{t('tv.upNextEmpty')}</p> : null}
          <ol className="flex flex-col gap-3">
            {state.upNext.slice(0, 6).map((song) => (
              <li key={song.id} className="flex items-center gap-4">
                <Cover src={song.imageUrl} size={64} large />
                <div className="min-w-0 flex-1">
                  <div title={song.title} className="truncate text-2xl font-semibold">
                    {song.title}
                  </div>
                  <div title={song.artist} className="truncate text-lg text-muted">
                    {song.artist}
                  </div>
                </div>
                <MoodBadge level={song.level} />
                <span className="w-20 text-right text-xl text-muted tabular-nums">
                  {formatTime(song.scheduledStart)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="flex min-h-0 flex-col gap-6">
        <div className="flex gap-6 rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          {qrUrl ? <QrCode value={qrUrl} size={220} /> : null}
          <div className="flex flex-1 flex-col justify-center gap-3">
            <div className="font-display text-4xl leading-tight font-bold">{t('tv.scan')}</div>
            <div className="font-mono text-xl break-all text-accent">{window.location.host}</div>
            <div className="text-base text-muted">{t('tv.privacy', { host: window.location.host })}</div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          {round ? (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-3xl font-bold">{t('tv.round', { seq: round.seq })}</h2>
                  <MoodBadge level={round.level} large />
                </div>
                <div className="text-right">
                  <div className="text-lg text-muted">{t('tv.endsIn')}</div>
                  <div className="font-display text-5xl font-bold text-accent tabular-nums">
                    {formatDuration(round.expectedCloseAt - now)}
                  </div>
                </div>
              </div>
              <ul className="flex flex-col gap-2.5">
                {sorted.slice(0, 5).map((c, index) => (
                  <li key={c.songId} className="relative overflow-hidden rounded-xl bg-raised/70">
                    <div
                      className={`absolute inset-y-0 left-0 transition-[width] duration-700 ${index === 0 && (c.votes ?? 0) > 0 ? 'bg-primary/45' : 'bg-accent/20'}`}
                      style={{ width: `${((c.votes ?? 0) / maxVotes) * 85}%` }}
                    />
                    <div className="relative flex items-center gap-3 px-3 py-2">
                      <Cover src={c.imageUrl} size={44} large />
                      <div className="min-w-0 flex-1">
                        <div title={c.title} className="truncate text-xl font-semibold">
                          {c.wishKey ? <span className="mr-2 font-mono text-base text-accent">{c.wishKey}</span> : null}
                          {c.title}
                        </div>
                        <div title={c.artist} className="truncate text-base text-muted">
                          {c.artist}
                        </div>
                      </div>
                      <span className="font-display text-3xl font-bold tabular-nums">{c.votes ?? 0}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex justify-between text-lg text-muted">
                <span>{sorted.length > 5 ? t('tv.more', { count: sorted.length - 5 }) : ''}</span>
                <span>{t('tv.votes', { count: round.totalVotes ?? 0 })}</span>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center font-display text-4xl font-bold text-muted">
              {state.voting && !state.voting.active && state.now < state.voting.startsAt
                ? t('tv.votingStarts', { time: formatTime(state.voting.startsAt) })
                : state.voting && !state.voting.active
                  ? t('tv.votingEnded')
                  : t('tv.waiting')}
            </div>
          )}
        </div>
      </section>

      <footer className="col-span-2 overflow-hidden rounded-2xl bg-surface/70 py-3 ring-1 ring-line">
        {state.ticker?.length ? (
          <div className="animate-ticker flex w-max gap-12 text-xl whitespace-nowrap">
            {[...state.ticker, ...state.ticker].map((w, i) => (
              <span key={`${w.key}-${i}`}>
                <span className="font-mono font-bold text-accent">{w.key}</span>{' '}
                <span className="text-muted">{t('tv.wishes')}:</span> {w.title} – {w.artist}
              </span>
            ))}
          </div>
        ) : (
          <div className="px-6 text-xl text-muted">{theme.event.hosts}</div>
        )}
      </footer>
    </main>
  );
}

export function PlayerTicker({ state, offsetMs }: { state: MusicState; offsetMs: number }) {
  const { t } = useI18n();
  const now = useNow(1000, offsetMs);
  const next = state.upNext[0];
  return (
    <main className="bg-party flex min-h-dvh flex-col gap-8 p-8">
      <div>
        <h1 className="text-3xl font-bold">{t('player.title')}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t('player.text')}</p>
      </div>
      <div className="rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
        <NowPlayingPanel nowPlaying={state.nowPlaying} now={now} compact />
      </div>
      {next ? (
        <div className="flex items-center gap-4 rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <span className="text-lg font-semibold text-muted">{t('player.next')}</span>
          <Cover src={next.imageUrl} size={56} large />
          <div className="min-w-0">
            <div title={next.title} className="truncate text-xl font-semibold">
              {next.title}
            </div>
            <div title={next.artist} className="truncate text-muted">
              {next.artist}
            </div>
          </div>
        </div>
      ) : null}
      {state.spotifyError ? (
        <div className="rounded-2xl bg-warning/15 p-4 font-semibold text-warning">
          {t('tv.spotifyIssue')}: {state.spotifyError}
        </div>
      ) : null}
    </main>
  );
}
