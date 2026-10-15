import { useState } from 'react';
import { Cover, MoodBadge } from '../../components/music.tsx';
import { Badge, Button, Card, Empty, Select, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { formatTime } from '../../lib/time.ts';
import { LevelPicker, PageTitle, useAdmin, useAdminData } from './shared.tsx';

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
  upvotes: number;
  decided_by_name: string | null;
}

const columns = [
  { key: 'open', label: 'In Prüfung' },
  { key: 'approved', label: 'Freigegeben' },
  { key: 'played', label: 'Im Voting / gespielt' },
  { key: 'rejected', label: 'Abgelehnt' },
] as const;

export function WishesPage() {
  const [status, setStatus] = useState<(typeof columns)[number]['key']>('open');
  const { data, reload } = useAdminData<{ wishes: Wish[] }>(`/api/admin/wishes?status=${status}`, 15_000);
  const sets = useAdminData<{ sets: Array<{ id: number; name: string; default_level: number; starts_at: number }> }>(
    '/api/admin/sets',
  );
  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Songwünsche"
        subtitle="Gäste-Tickets prüfen. Freigegebene Wünsche kommen in das gewählte Set und werden bei passender Stimmung bevorzugt zur Wahl gestellt."
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
  const [setId, setSetId] = useState(String(sets[0]?.id ?? ''));
  const [level, setLevel] = useState<number | null>(wish.mood_level);
  async function decide(approve: boolean) {
    const body = approve ? { approve: true, setId: Number(setId), level } : { approve: false };
    await run(
      () => api.post(`/api/admin/wishes/${wish.id}/decide`, body),
      approve ? `${wish.key} freigegeben` : `${wish.key} abgelehnt`,
    );
    await onDone();
  }
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Cover src={wish.image_url} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-accent">{wish.key}</span>
            {wish.explicit ? <Badge tone="warning">explicit</Badge> : null}
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
          <Select value={setId} onChange={(e) => setSetId(e.target.value)}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (Standard {s.default_level})
              </option>
            ))}
          </Select>
          <LevelPicker value={level} allowNull onChange={setLevel} />
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!setId} onClick={() => void decide(true)}>
              Freigeben
            </Button>
            <Button variant="danger" onClick={() => void decide(false)}>
              Ablehnen
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <MoodBadge level={wish.mood_level} />
        </div>
      )}
    </Card>
  );
}
