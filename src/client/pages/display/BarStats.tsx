import { useMemo } from 'react';
import type { ChartConfiguration } from 'chart.js';
import { ChartView } from '../../components/chart.tsx';
import { Stat } from '../../components/ui.tsx';
import { useI18n } from '../../lib/i18n.tsx';
import { chartColor, theme } from '../../lib/theme.ts';
import { formatEuro, formatTime, useNow } from '../../lib/time.ts';

export interface StatsState {
  now: number;
  eventName: string;
  cratePriceCents: number;
  budgetCents: number;
  event: { startsAt: number; endsAt: number };
  stats: {
    totalCrates: number;
    totalCostCents: number;
    cratesLastHour: number;
    ratePerHour: number;
    forecastCrates: number;
    forecastCostCents: number;
    peakBucket: { bucket_start: number; crates: number } | null;
    series: Array<{ at: number; crates: number; cumulative: number; costCents: number }>;
  };
  recent: Array<{ bookingNo: string; at: number }>;
}

export function BarStats({ state }: { state: StatsState }) {
  const { t } = useI18n();
  const now = useNow(10_000);
  const { stats } = state;
  const config = useMemo<ChartConfiguration>(
    () => ({
      type: 'bar',
      data: {
        labels: stats.series.map((p) => formatTime(p.at)),
        datasets: [
          {
            type: 'bar',
            label: t('bar.perQuarter'),
            data: stats.series.map((p) => p.crates),
            backgroundColor: chartColor(1, 0.55),
            borderRadius: 6,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: t('bar.cumulative'),
            data: stats.series.map((p) => p.cumulative),
            borderColor: chartColor(0),
            backgroundColor: chartColor(0, 0.15),
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 4,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 18 } } } },
        scales: {
          x: { ticks: { font: { size: 16 }, maxTicksLimit: 12 } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, font: { size: 16 } },
            title: { display: true, text: t('bar.perQuarter') },
          },
          y1: {
            beginAtZero: true,
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: { precision: 0, font: { size: 16 } },
          },
        },
      },
    }),
    [stats.series, t],
  );

  return (
    <main className="bg-party grid h-dvh grid-rows-[auto_auto_1fr] gap-6 p-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <img src={theme.event.logo} alt="" className="h-12 w-12" />
          <h1 className="text-4xl font-bold">Party-Stattrack 🍻</h1>
        </div>
        <div className="font-display text-4xl font-bold tabular-nums">{formatTime(now)}</div>
      </header>
      <div className="grid grid-cols-4 gap-5">
        <Stat
          label={t('bar.crates')}
          value={stats.totalCrates}
          tone="primary"
          hint={formatEuro(stats.totalCostCents)}
        />
        <Stat
          label={t('bar.rate')}
          value={stats.ratePerHour.toLocaleString('de-DE')}
          hint={t('bar.perHour')}
          tone="accent"
        />
        <Stat label={t('bar.forecast')} value={stats.forecastCrates} hint={formatEuro(stats.forecastCostCents)} />
        <Stat
          label={t('bar.peak')}
          value={stats.peakBucket ? formatTime(stats.peakBucket.bucket_start) : '–'}
          hint={stats.peakBucket ? `${stats.peakBucket.crates} ${t('bar.crates')}` : undefined}
        />
      </div>
      <div className="grid min-h-0 grid-cols-[1fr_18rem] gap-6">
        <div className="min-h-0 rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <ChartView config={config} className="h-full" />
        </div>
        <div className="rounded-3xl bg-surface/70 p-6 ring-1 ring-line">
          <h2 className="mb-4 text-xl font-bold text-muted">{t('bar.last')}</h2>
          <ul className="flex flex-col gap-3">
            {state.recent.map((r) => (
              <li
                key={r.bookingNo}
                className="flex items-center justify-between rounded-xl bg-raised/70 px-4 py-3 text-xl"
              >
                <span className="font-mono text-accent">{r.bookingNo}</span>
                <span className="tabular-nums">{formatTime(r.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
