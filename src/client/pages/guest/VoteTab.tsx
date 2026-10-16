import { useEffect, useRef, useState } from 'react';
import { Cover, MoodBadge, SpotifyLink, SpotifyLogo } from '../../components/music.tsx';
import { Notice } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useI18n } from '../../lib/i18n.tsx';
import { formatDuration, formatTime, useNow } from '../../lib/time.ts';
import { guestErrorKey } from './GuestApp.tsx';

export interface Candidate {
  songId: number;
  uri: string;
  title: string;
  artist: string;
  imageUrl: string | null;
  durationMs: number;
  explicit: boolean;
  wishKey: string | null;
}

export interface GuestState {
  joined: boolean;
  now: number;
  eventName: string;
  pollAfterMs: number;
  voting?: { active: boolean; startsAt: number; endsAt: number | null };
  round?: { id: number; seq: number; level: number; expectedCloseAt: number; candidates: Candidate[] } | null;
  myVote?: number | null;
  nowPlaying?: { uri: string; title: string; artist: string; imageUrl: string | null } | null;
}

export function VoteTab({
  state,
  offsetMs,
  refresh,
  toast,
}: {
  state: GuestState;
  offsetMs: number;
  refresh: () => Promise<void>;
  toast: (message: string, tone?: 'success' | 'danger') => void;
}) {
  const { t } = useI18n();
  const now = useNow(1000, offsetMs);
  const [pending, setPending] = useState<number | null>(null);
  const [localVote, setLocalVote] = useState<{ roundId: number; songId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const round = state.round;
  const myVote = round && localVote?.roundId === round.id ? localVote.songId : (state.myVote ?? null);
  const remaining = round ? round.expectedCloseAt - now : 0;
  const roundId = round?.id ?? null;
  const ended = roundId !== null && remaining <= 0;
  const refreshScheduled = useRef<number | null>(null);

  useEffect(() => {
    if (roundId === null || !ended || refreshScheduled.current === roundId) return;
    refreshScheduled.current = roundId;
    const id = window.setTimeout(() => void refresh(), 2_000 + Math.random() * 15_000);
    return () => {
      window.clearTimeout(id);
      if (refreshScheduled.current === roundId) refreshScheduled.current = null;
    };
  }, [roundId, ended, refresh]);

  async function vote(songId: number) {
    if (!round || pending) return;
    setPending(songId);
    setError(null);
    try {
      await api.post('/api/public/vote', { roundId: round.id, songId });
      setLocalVote({ roundId: round.id, songId });
      toast(t('guest.vote.saved'));
      if (navigator.vibrate) navigator.vibrate(30);
    } catch (e) {
      setError(t(guestErrorKey(e)));
      if (guestErrorKey(e) === 'guest.error.round_closed') void refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state.nowPlaying ? (
        <div className="flex items-center gap-3 rounded-2xl bg-surface/80 p-3 ring-1 ring-line">
          <Cover src={state.nowPlaying.imageUrl} size={44} />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wider text-accent">{t('guest.nowPlaying')}</div>
            <div className="font-semibold break-words">{state.nowPlaying.title}</div>
            <div className="text-sm break-words text-muted">{state.nowPlaying.artist}</div>
          </div>
          <SpotifyLink uri={state.nowPlaying.uri} />
        </div>
      ) : null}

      {!round ? (
        <div className="rounded-3xl bg-surface p-8 text-center ring-1 ring-line">
          <div className="text-4xl">🎶</div>
          <p className="mt-3 text-lg font-semibold">
            {state.voting && !state.voting.active && state.now < state.voting.startsAt
              ? t('guest.vote.notStarted', { time: formatTime(state.voting.startsAt) })
              : state.voting && !state.voting.active
                ? t('guest.vote.ended')
                : t('guest.vote.none')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-muted">{t('guest.vote.round', { seq: round.seq })}</span>
                <MoodBadge level={round.level} />
              </div>
              <h1 className="mt-1 text-2xl font-bold">{t('guest.vote.title')}</h1>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted">{t('guest.vote.endsIn')}</div>
              <div className="font-display text-2xl font-bold tabular-nums text-accent">
                {formatDuration(remaining)}
              </div>
            </div>
          </div>
          <p className="text-sm text-muted">{t('guest.vote.hint')}</p>
          {error ? <Notice tone="warning">{error}</Notice> : null}
          <ul className="grid grid-cols-2 gap-3">
            {round.candidates.map((c) => {
              const selected = myVote === c.songId;
              return (
                <li
                  key={c.songId}
                  className={`flex flex-col gap-2 rounded-2xl bg-surface p-1.5 ring-1 transition ${selected ? 'ring-4 ring-primary glow' : 'ring-line'}`}
                >
                  <button
                    type="button"
                    onClick={() => void vote(c.songId)}
                    disabled={pending !== null || remaining <= 0}
                    aria-pressed={selected}
                    className="flex flex-col gap-2 text-left transition active:scale-[0.98]"
                  >
                    <Cover src={c.imageUrl} size={400} className="aspect-square !h-auto !w-full" />
                    <div className={`flex flex-col gap-1 px-1 ${pending === c.songId ? 'animate-pulse' : ''}`}>
                      {selected || c.wishKey ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {selected ? (
                            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">
                              ✓ {t('guest.vote.mine')}
                            </span>
                          ) : null}
                          {c.wishKey ? (
                            <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] font-bold text-accent">
                              {c.wishKey}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="text-sm leading-tight font-semibold break-words">{c.title}</div>
                    </div>
                  </button>
                  <div className="flex items-center justify-between gap-3 pl-1">
                    <div className="min-w-0 text-xs break-words text-muted">{c.artist}</div>
                    <SpotifyLink uri={c.uri} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {state.nowPlaying || round ? <SpotifyLogo className="self-center" /> : null}
    </div>
  );
}
