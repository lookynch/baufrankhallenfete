import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Select, Spinner, Stat } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { formatDateTime, formatEuro } from '../../lib/time.ts';
import { PageTitle, useAdmin, useAdminData } from './shared.tsx';

interface LedgerData {
  journal: Array<{
    id: number;
    booking_no: string;
    booked_at: number;
    effective_at: number;
    kind: string;
    debit_account: string;
    credit_account: string;
    amount_cents: number;
    quantity: number;
    text: string;
    reversal_of: number | null;
    reversed_by: number | null;
    created_by_name: string | null;
  }>;
  balances: Array<{ code: string; name: string; type: string; debit_cents: number; credit_cents: number }>;
  accounts: Array<{ code: string; name: string; type: string }>;
  stats: { totalCrates: number; totalCostCents: number; forecastCostCents: number };
  settings: {
    cratePriceCents: number;
    budgetCents: number;
    inventoryAccount: string;
    expenseAccount: string;
    payableAccount: string;
  };
}

const kindLabel: Record<string, string> = {
  consumption: 'Verbrauch',
  purchase: 'Einkauf',
  manual: 'Manuell',
  reversal: 'Storno',
};

export function LedgerPage() {
  const { run } = useAdmin();
  const { data, reload } = useAdminData<LedgerData>('/api/admin/ledger', 15_000);
  const [form, setForm] = useState({
    kind: 'consumption',
    debitAccount: '',
    creditAccount: '',
    amount: '',
    quantity: '1',
    text: 'Kasten Getränke (nachgetragen)',
  });
  const [account, setAccount] = useState({ code: '', name: '', type: 'expense' });
  if (!data) return <Spinner />;

  const debit =
    form.debitAccount || (form.kind === 'purchase' ? data.settings.inventoryAccount : data.settings.expenseAccount);
  const credit =
    form.creditAccount || (form.kind === 'purchase' ? data.settings.payableAccount : data.settings.inventoryAccount);
  const amountCents =
    form.amount.trim() !== ''
      ? Math.round(Number(form.amount.replace(',', '.')) * 100)
      : form.kind === 'consumption'
        ? Number(form.quantity) * data.settings.cratePriceCents
        : 0;
  const totalDebit = data.balances.reduce((s, a) => s + a.debit_cents, 0);
  const totalCredit = data.balances.reduce((s, a) => s + a.credit_cents, 0);

  async function book() {
    await run(
      () =>
        api.post('/api/admin/ledger/entries', {
          kind: form.kind,
          debitAccount: debit,
          creditAccount: credit,
          amountCents,
          quantity: form.kind === 'consumption' ? Number(form.quantity) : 0,
          text: form.text,
        }),
      'Gebucht',
    );
    await reload();
  }

  async function reverse(id: number, bookingNo: string) {
    const reason = prompt(`Storno-Grund für ${bookingNo}:`);
    if (!reason) return;
    await run(() => api.post(`/api/admin/ledger/entries/${id}/reverse`, { reason }), 'Storniert');
    await reload();
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title="Buchhaltung"
        subtitle="Neben- und Statistikbuchhaltung (Kostenschätzung). Korrekturen nur per Storno – nichts wird gelöscht."
        actions={
          <a
            href="/api/admin/ledger/export.csv"
            className="inline-flex h-11 items-center rounded-xl bg-surface px-4 font-semibold ring-1 ring-line hover:bg-raised"
          >
            Verbrauchsprotokoll (CSV)
          </a>
        }
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Kästen" value={data.stats.totalCrates} tone="primary" />
        <Stat label="Kosten" value={formatEuro(data.stats.totalCostCents)} />
        <Stat label="Prognose" value={formatEuro(data.stats.forecastCostCents)} tone="accent" />
        <Stat
          label="Soll = Haben"
          value={totalDebit === totalCredit ? '✓' : '✗'}
          hint={`${formatEuro(totalDebit)} / ${formatEuro(totalCredit)}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card title="Journal">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-2">Beleg</th>
                  <th>Wirksam</th>
                  <th>Art</th>
                  <th>Soll</th>
                  <th>Haben</th>
                  <th className="text-right">Betrag</th>
                  <th>Text</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.journal.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-t border-line/60 ${e.reversed_by ? 'text-muted line-through' : ''}`}
                  >
                    <td className="py-2 font-mono text-accent">{e.booking_no}</td>
                    <td className="whitespace-nowrap">{formatDateTime(e.effective_at)}</td>
                    <td>
                      <Badge tone={e.kind === 'reversal' ? 'danger' : e.kind === 'consumption' ? 'primary' : 'neutral'}>
                        {kindLabel[e.kind] ?? e.kind}
                      </Badge>
                    </td>
                    <td className="font-mono">{e.debit_account}</td>
                    <td className="font-mono">{e.credit_account}</td>
                    <td className="text-right tabular-nums">{formatEuro(e.amount_cents)}</td>
                    <td className="max-w-[16rem] truncate" title={e.text}>
                      {e.text} {e.created_by_name ? <span className="text-muted">({e.created_by_name})</span> : null}
                    </td>
                    <td>
                      {e.kind !== 'reversal' && !e.reversed_by ? (
                        <Button size="sm" variant="ghost" onClick={() => void reverse(e.id, e.booking_no)}>
                          Storno
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Buchung erfassen">
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void book();
              }}
            >
              <Field label="Art">
                <Select
                  value={form.kind}
                  onChange={(e) => setForm({ ...form, kind: e.target.value, debitAccount: '', creditAccount: '' })}
                >
                  <option value="consumption">Verbrauch (Kästen nachtragen)</option>
                  <option value="purchase">Einkauf / Anfangsbestand</option>
                  <option value="manual">Manuelle Buchung</option>
                </Select>
              </Field>
              {form.kind === 'consumption' ? (
                <Field label="Anzahl Kästen">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                  />
                </Field>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Soll">
                  <Select value={debit} onChange={(e) => setForm({ ...form, debitAccount: e.target.value })}>
                    {data.accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Haben">
                  <Select value={credit} onChange={(e) => setForm({ ...form, creditAccount: e.target.value })}>
                    {data.accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field
                label="Betrag in €"
                hint={
                  form.kind === 'consumption' ? `leer = ${formatEuro(amountCents)} (Durchschnittspreis)` : undefined
                }
              >
                <Input
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0,00"
                />
              </Field>
              <Field label="Buchungstext">
                <Input
                  value={form.text}
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  maxLength={200}
                  required
                />
              </Field>
              <Button type="submit" disabled={amountCents <= 0 || debit === credit}>
                {formatEuro(amountCents)} buchen
              </Button>
            </form>
          </Card>

          <Card title="Konten (T-Konten)">
            <ul className="flex flex-col gap-2 text-sm">
              {data.balances.map((a) => (
                <li key={a.code} className="rounded-xl bg-raised/50 p-3">
                  <div className="font-semibold">
                    <span className="font-mono text-accent">{a.code}</span> {a.name}
                  </div>
                  <div className="mt-1 grid grid-cols-2 tabular-nums">
                    <span>Soll {formatEuro(a.debit_cents)}</span>
                    <span className="text-right">Haben {formatEuro(a.credit_cents)}</span>
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="mt-4 grid grid-cols-[5rem_1fr] gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                await run(
                  () =>
                    api.put(`/api/admin/ledger/accounts/${account.code}`, { name: account.name, type: account.type }),
                  'Konto gespeichert',
                );
                await reload();
              }}
            >
              <Input
                placeholder="Nr."
                value={account.code}
                onChange={(e) => setAccount({ ...account, code: e.target.value })}
                required
              />
              <Input
                placeholder="Bezeichnung"
                value={account.name}
                onChange={(e) => setAccount({ ...account, name: e.target.value })}
                required
              />
              <Select
                value={account.type}
                onChange={(e) => setAccount({ ...account, type: e.target.value })}
                className="col-span-2"
              >
                <option value="asset">Aktivkonto</option>
                <option value="liability">Passivkonto</option>
                <option value="expense">Aufwand</option>
                <option value="income">Ertrag</option>
                <option value="equity">Eigenkapital</option>
              </Select>
              <Button type="submit" variant="outline" className="col-span-2">
                Konto anlegen / ändern
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
