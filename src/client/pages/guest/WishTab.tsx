import { useCallback, useEffect, useRef, useState } from 'react';
import { Cover } from '../../components/music.tsx';
import { Badge, Button, Empty, Input, Notice, Spinner } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { hasMessage, useI18n, type MessageKey } from '../../lib/i18n.tsx';
import { guestErrorKey } from './GuestApp.tsx';

interface Track {
  uri: string;
  title: string;
  artist: string;
  imageUrl: string | null;
  explicit: boolean;
}

interface Wish {
  id: number;
  key: string;
  status: 'open' | 'approved' | 'rejected' | 'played';
  title: string;
  artist: string;
  image_url: string | null;
  upvotes: number;
  mine: boolean;
  upvoted: boolean;
}

const statusTone = { open: 'warning', approved: 'success', rejected: 'danger', played: 'accent' } as const;

export function WishTab({ toast }: { toast: (message: string, tone?: 'success' | 'danger') => void }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const searchId = useRef(0);

  const loadWishes = useCallback(async () => {
    try {
      setWishes((await api.get<{ wishes: Wish[] }>('/api/public/wishes')).wishes);
    } catch {
      setWishes((current) => current);
    }
  }, []);

  useEffect(() => {
    void loadWishes();
  }, [loadWishes]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setResults([]);
      return;
    }
    const id = ++searchId.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await api.get<{ tracks: Track[]; limited: boolean }>(
          `/api/public/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (id !== searchId.current) return;
        setResults(response.tracks);
        setNotice(response.limited ? t('guest.wish.limited') : null);
      } catch (e) {
        if (id === searchId.current) setNotice(t(guestErrorKey(e)));
      } finally {
        if (id === searchId.current) setSearching(false);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [query, t]);

  async function wish(track: Track) {
    setBusy(track.uri);
    try {
      const result = await api.post<{ key: string; merged: boolean }>('/api/public/wishes', { uri: track.uri });
      toast(result.merged ? t('guest.wish.merged', { key: result.key }) : t('guest.wish.sent', { key: result.key }));
      setQuery('');
      setResults([]);
      await loadWishes();
    } catch (e) {
      const key = e instanceof ApiError ? `guest.wish.error.${e.code}` : '';
      toast(hasMessage(key) ? t(key) : t(guestErrorKey(e)), 'danger');
    } finally {
      setBusy(null);
    }
  }

  async function upvote(w: Wish) {
    setBusy(w.key);
    try {
      await api.post(`/api/public/wishes/${w.id}/upvote`);
      await loadWishes();
    } catch (e) {
      toast(t(guestErrorKey(e)), 'danger');
    } finally {
      setBusy(null);
    }
  }

  const mine = wishes.filter((w) => w.mine);
  const others = wishes.filter((w) => !w.mine);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold">{t('guest.wish.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('guest.wish.hint')}</p>
      </div>
      <div className="relative">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('guest.wish.search')}
          className="h-14 text-lg"
          maxLength={100}
          enterKeyHint="search"
        />
        {searching ? (
          <span className="absolute top-1/2 right-4 -translate-y-1/2 text-muted">
            <Spinner small />
          </span>
        ) : null}
      </div>
      {notice ? <Notice tone="warning">{notice}</Notice> : null}
      {results.length ? (
        <ul className="flex flex-col gap-2">
          {results.map((track) => (
            <li key={track.uri} className="flex items-center gap-3 rounded-2xl bg-surface p-2.5 ring-1 ring-line">
              <Cover src={track.imageUrl} size={52} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{track.title}</div>
                <div className="truncate text-sm text-muted">{track.artist}</div>
              </div>
              <Button size="sm" busy={busy === track.uri} onClick={() => void wish(track)}>
                {t('guest.wish.send')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      <WishList title={t('guest.wish.mine')} wishes={mine} />
      <WishList title={t('guest.wish.public')} wishes={others} onUpvote={upvote} busy={busy} />
    </div>
  );
}

function WishList({
  title,
  wishes: list,
  onUpvote,
  busy: busyKey,
}: {
  title: string;
  wishes: Wish[];
  onUpvote?: (w: Wish) => void;
  busy?: string | null;
}) {
  const { t } = useI18n();
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold tracking-wider text-muted uppercase">{title}</h2>
      {list.length === 0 ? (
        <Empty>{t('guest.wish.empty')}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((w) => (
            <li key={w.id} className="flex items-center gap-3 rounded-2xl bg-surface p-2.5 ring-1 ring-line">
              <Cover src={w.image_url} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-accent">{w.key}</span>
                  <Badge tone={statusTone[w.status]}>{t(`status.${w.status}` as MessageKey)}</Badge>
                </div>
                <div className="truncate font-semibold">{w.title}</div>
                <div className="truncate text-xs text-muted">{w.artist}</div>
              </div>
              {onUpvote && w.status === 'approved' ? (
                <Button
                  size="sm"
                  variant={w.upvoted ? 'outline' : 'accent'}
                  disabled={w.upvoted}
                  busy={busyKey === w.key}
                  onClick={() => onUpvote(w)}
                >
                  {t('guest.wish.upvote')} · {w.upvotes}
                </Button>
              ) : (
                <span className="text-sm text-muted tabular-nums">{w.upvotes > 0 ? `+${w.upvotes}` : ''}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
