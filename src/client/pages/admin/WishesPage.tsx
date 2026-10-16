import { useState } from 'react';
import { Cover, MoodBadge } from '../../components/music.tsx';
import { Badge, Button, Card, Empty, Select, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { formatTime } from '../../lib/time.ts';
import { LevelPicker, PageTitle, useAdmin, useAdminData, useInFlight } from './shared.tsx';

interface Wish {
  id: number;
  key: string;
  status: string;
  created_at: number;
  title: string;
  artist: string;
  image_url: string | null;
  explicit: number;
  mood_level: number | null;
  auto_level: number | null;
  blocked_tag: string | null;
  vetoed: number;
  upvotes: number;
  decided_by_name: string | null;
}

const columns = [
  { key: 'approved', label: 'Freigegeben, wartend' },
  { key: 'open', label: 'In Prüfung' },
  { key: 'played', label: 'Gewonnen / gespielt' },
  { key: 'rejected', label: 'Abgelehnt / Veto' },
] as const;

export function WishesPage() {
  const [status, setStatus] = useState<(typeof columns)[number]['key']>('approved');
  const { data, reload } = useAdminData<{ wishes: Wish[] }>(`/api/admin/wishes?status=${status}`, 15_000);
  const sets = useAdminData<{ sets: Array<{ id: number; name: string; default_level: number; starts_at: number }> }>(
    '/api/admin/sets',
  );
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Songwünsche"
        subtitle="Wünsche, die zur Party passen, werden automatisch freigegeben und kommen ins laufende Set. Mit Veto fliegt ein Song raus und kann nicht erneut gewünscht werden. „In Prüfung“ füllt sich nur, wenn die automatische Freigabe aus ist oder kein Set existiert."
      />
      <div className="flex flex-wrap gap-2">
        {columns.map((c) => (
          <Button
            key={c.key}
            size="sm"
            variant={status === c.key ? 'primary' : 'outline'}
            onClick={() => setStatus(c.key)}
          >
            {c.label}
          </Button>
        ))}
      </div>
      {!data ? (
        <Spinner />
      ) : data.wishes.length === 0 ? (
        <Empty>Keine Wünsche in dieser Spalte.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.wishes.map((w) => (
            <WishCard key={w.id} wish={w} sets={sets.data?.sets ?? []} onDone={reload} />
          ))}
        </div>
      )}
    </div>
  );
}

function WishCard({
  wish,
  sets,
  onDone,
}: {
  wish: Wish;
  sets: Array<{ id: number; name: string; default_level: number }>;
  onDone: () => Promise<void>;
}) {
  const { run } = useAdmin();
  const { busy, guard } = useInFlight();
  const [setId, setSetId] = useState('');
  const [level, setLevel] = useState<number | null>(wish.mood_level ?? wish.auto_level);
  const effectiveSetId = sets.some((s) => String(s.id) === setId) ? setId : String(sets[0]?.id ?? '');
  function decide(approve: boolean) {
    if (
      !approve &&
      !confirm(`${wish.title} per Veto aussortieren? Der Song verschwindet aus Voting und Warteschlange.`)
    )
      return;
    return guard(approve ? 'approve' : 'reject', async () => {
      const body = approve ? { approve: true, setId: Number(effectiveSetId), level } : { approve: false };
      await run(
        () => api.post(`/api/admin/wishes/${wish.id}/decide`, body),
        approve ? `${wish.key} freigegeben` : `${wish.key} aussortiert`,
      );
      await onDone();
    });
  }
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Cover src={wish.image_url} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-accent">{wish.key}</span>
            {wish.explicit ? <Badge tone="warning">explicit</Badge> : null}
            {wish.blocked_tag ? <Badge tone="danger">gesperrt: {wish.blocked_tag}</Badge> : null}
            {wish.vetoed ? <Badge tone="danger">Veto</Badge> : null}
            <span className="ml-auto text-xs text-muted">{formatTime(wish.created_at)}</span>
          </div>
          <div className="mt-1 truncate font-semibold">{wish.title}</div>
          <div className="truncate text-sm text-muted">{wish.artist}</div>
          <div className="mt-1 text-xs text-muted">
            +{wish.upvotes} {wish.decided_by_name ? `· entschieden von ${wish.decided_by_name}` : ''}
          </div>
        </div>
      </div>
      {wish.status === 'open' ? (
        <div className="mt-4 flex flex-col gap-3">
          <Select value={effectiveSetId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (Standard {s.default_level})
              </option>
            ))}
          </Select>
          <LevelPicker value={level} allowNull onChange={setLevel} />
          <div className="flex gap-2">
            <Button
              className="flex-1"
              busy={busy === 'approve'}
              disabled={!effectiveSetId || busy !== null}
              onClick={() => void decide(true)}
            >
              Freigeben
            </Button>
            <Button
              variant="danger"
              busy={busy === 'reject'}
              disabled={busy !== null}
              onClick={() => void decide(false)}
            >
              Veto
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <MoodBadge level={wish.mood_level ?? wish.auto_level} />
          {wish.mood_level === null && wish.auto_level !== null ? (
            <span className="text-xs text-muted">geschätzt</span>
          ) : null}
          {wish.status === 'approved' ? (
            <Button
              size="sm"
              variant="danger"
              className="ml-auto"
              busy={busy === 'reject'}
              disabled={busy !== null}
              onClick={() => void decide(false)}
            >
              Veto
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}
