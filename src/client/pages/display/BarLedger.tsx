import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartView } from '../../components/chart.tsx';
import { Stat } from '../../components/ui.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { chartColor, theme, tokenColor } from '../../lib/theme.ts';
import { formatEuro, formatTime } from '../../lib/time.ts';

export interface LedgerState {
  now: number;
  eventName: string;
  budgetCents: number;
  cratePriceCents: number;
  totalCostCents: number;
  totalCrates: number;
  forecastCostCents: number;
  costPerHourCents: number;
  journal: Array<{
    id: number;
    booking_no: string;
    effective_at: number;
    kind: string;
    debit_account: string;
    credit_account: string;
    amount_cents: number;
    text: string;
    reversed_by: number | null;
  }>;
  balances: Array<{ code: string; name: string; debit_cents: number; credit_cents: number }>;
}

export function BarLedger({ state }: { state: LedgerState }) {
  const { t } = useI18n();
  const used = Math.min(state.totalCostCents, state.budgetCents);
  const remaining = Math.max(0, state.budgetCents - state.totalCostCents);
  const over = state.totalCostCents > state.budgetCents;
  const gauge = useMemo<ChartConfiguration>(
    () => ({
      type: 'doughnut',
      data: {
        labels: [t('bar.cost'), t('bar.remaining')],
        datasets: [
          {
            data: [used, remaining],
            backgroundColor: [over ? tokenColor('danger') : chartColor(0), tokenColor('surfaceRaised')],
            borderWidth: 0,
          },
        ],
      },
      options: {
        rotation: -90,
        circumference: 180,
        cutout: '72%',
        plugins: { legend: { display: false } },
        maintainAspectRatio: false,
      },
    }),
    [used, remaining, over, t],
  );

  return (
    <main className="bg-party grid h-dvh grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] grid-rows-[auto_1fr] gap-6 p-8">
      <header className="col-span-2 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={theme.event.logo} alt="" className="h-12 w-12" />
          <div>
            <h1 className="text-4xl font-bold">Fete-Buchhaltung 📒</h1>
            <p className="text-muted">{t('bar.statistic')}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Stat label={t('bar.cost')} value={formatEuro(state.totalCostCents)} tone="primary" />
          <Stat label={t('bar.costPerHour')} value={formatEuro(state.costPerHourCents)} />
          <Stat label={t('bar.forecast')} value={formatEuro(state.forecastCostCents)} tone="accent" />
        </div>
      </header>

      <section className="min-h-0 overflow-hidden rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
        <h2 className="mb-4 text-2xl font-bold">{t('bar.journal')}</h2>
        <table className="w-full text-lg">
          <thead className="text-left text-sm tracking-wider text-muted uppercase">
            <tr>
              <th className="pb-2">Beleg</th>
              <th className="pb-2">Zeit</th>
              <th className="pb-2">{t('bar.debit')}</th>
              <th className="pb-2">{t('bar.credit')}</th>
              <th className="pb-2 text-right">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {state.journal.map((e) => (
              <tr key={e.id} className={`border-t border-line/50 ${e.reversed_by ? 'text-muted line-through' : ''}`}>
                <td className="py-2 font-mono text-accent">{e.booking_no}</td>
                <td className="py-2 tabular-nums">{formatTime(e.effective_at)}</td>
                <td className="py-2 font-mono">{e.debit_account}</td>
                <td className="py-2 font-mono">{e.credit_account}</td>
                <td className={`py-2 text-right tabular-nums ${e.kind === 'reversal' ? 'text-danger' : ''}`}>
                  {e.kind === 'reversal' ? '−' : ''}
                  {formatEuro(e.amount_cents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex min-h-0 flex-col gap-6">
        <div className="rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <h2 className="text-2xl font-bold">{t('bar.budget')}</h2>
          <div className="relative h-44">
            <ChartView config={gauge} className="h-full" />
            <div className="absolute inset-x-0 bottom-2 text-center">
              <div className={`font-display text-4xl font-bold ${over ? 'text-danger' : ''}`}>
                {formatEuro(state.totalCostCents)}
              </div>
              <div className="text-muted">
                / {formatEuro(state.budgetCents)} · {formatEuro(remaining)} {t('bar.remaining')}
              </div>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <h2 className="mb-4 text-2xl font-bold">{t('bar.accounts')}</h2>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {state.balances.map((a) => (
              <div key={a.code} className="rounded-2xl bg-raised/60 p-4">
                <div className="truncate font-semibold">
                  <span className="font-mono text-accent">{a.code}</span> {a.name}
                </div>
                <div className="mt-2 grid grid-cols-2 border-t border-line pt-2 tabular-nums">
                  <div className="border-r border-line pr-2">
                    <div className="text-xs text-muted uppercase">{t('bar.debit')}</div>
                    {formatEuro(a.debit_cents)}
                  </div>
                  <div className="pl-2 text-right">
                    <div className="text-xs text-muted uppercase">{t('bar.credit')}</div>
                    {formatEuro(a.credit_cents)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
