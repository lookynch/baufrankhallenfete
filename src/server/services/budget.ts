import type { Env } from '../env.ts';
import { getKv, setKv, tryLock } from './kv.ts';

export const DAILY_REQUEST_LIMIT = 100_000;
const BUDGET_KEY = 'request_budget';
const REFRESH_MS = 60_000;

export interface RequestBudget {
  requestsToday: number | null;
  fraction: number | null;
  fetchedAt: number;
  error: string | null;
}

const DATASETS = ['workersInvocationsAdaptive', 'pagesFunctionsInvocationsAdaptiveGroups'] as const;

async function queryDataset(env: Env, dataset: string, start: string, end: string, fetcher: typeof fetch) {
  const query = `query($account: string!, $start: Time!, $end: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      data: ${dataset}(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end }) { sum { requests } }
    } }
  }`;
  const response = await fetcher('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, start, end } }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as {
    data?: { viewer?: { accounts?: Array<{ data?: Array<{ sum?: { requests?: number } }> }> } };
    errors?: unknown[];
  };
  if (json.errors?.length) return null;
  return (json.data?.viewer?.accounts?.[0]?.data ?? []).reduce((sum, row) => sum + (row.sum?.requests ?? 0), 0);
}

export async function refreshBudget(env: Env, now: number, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ACCOUNT_ID) return;
  if (!(await tryLock(env.DB, 'budget_refresh', now, REFRESH_MS))) return;
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const totals = await Promise.all(
    DATASETS.map((d) =>
      queryDataset(env, d, dayStart.toISOString(), new Date(now).toISOString(), fetcher).catch(() => null),
    ),
  );
  const known = totals.filter((t): t is number => t !== null);
  const requestsToday = known.length ? Math.max(...known) : null;
  const budget: RequestBudget = {
    requestsToday,
    fraction: requestsToday === null ? null : requestsToday / DAILY_REQUEST_LIMIT,
    fetchedAt: now,
    error: requestsToday === null ? 'analytics_unavailable' : null,
  };
  await setKv(env.DB, BUDGET_KEY, budget, now);
}

export async function readBudget(db: D1Database): Promise<RequestBudget | null> {
  return (await getKv<RequestBudget>(db, BUDGET_KEY))?.value ?? null;
}

export function throttleFactor(budget: RequestBudget | null, now: number): number {
  if (!budget?.fraction || now - budget.fetchedAt > 15 * 60_000) return 1;
  if (budget.fraction >= 0.8) return 4;
  if (budget.fraction >= 0.6) return 2;
  return 1;
}
