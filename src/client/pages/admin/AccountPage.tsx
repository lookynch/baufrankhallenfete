import { useState } from 'react';
import { Button, Card, Empty, Input, Notice, Spinner } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { createPasskey, passkeysSupported } from '../../lib/passkey.ts';
import { formatDateTime } from '../../lib/time.ts';
import { PageTitle, useAdmin, useAdminData, useInFlight } from './shared.tsx';

interface PasskeyRow {
  id: number;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export function AccountPage() {
  const { me, run, reloadMe } = useAdmin();
  const { busy, guard } = useInFlight();
  const { data, reload } = useAdminData<{ passkeys: PasskeyRow[] }>('/api/admin/account/passkeys');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const passkeys = data?.passkeys ?? [];
  const onlyAccess = !me.hasPassword && passkeys.length === 1;

  async function refresh() {
    await Promise.all([reload(), reloadMe()]);
  }

  function add() {
    void guard('add', async () => {
      const added = await run(
        () => createPasskey('/api/admin/account/passkeys/options', '/api/admin/account/passkeys'),
        'Passkey hinzugefügt',
      );
      if (added) await refresh();
    });
  }

  function rename() {
    if (!editing) return;
    void guard(`rename-${editing.id}`, async () => {
      await run(() => api.patch(`/api/admin/account/passkeys/${editing.id}`, { name: editing.name }), 'Gespeichert');
      setEditing(null);
      await reload();
    });
  }

  function remove(passkey: PasskeyRow) {
    if (!confirm(`Passkey „${passkey.name}“ löschen? Damit kannst du dich auf diesem Gerät nicht mehr anmelden.`)) {
      return;
    }
    void guard(`delete-${passkey.id}`, async () => {
      await run(() => api.delete(`/api/admin/account/passkeys/${passkey.id}`), 'Passkey gelöscht');
      await refresh();
    });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageTitle
        title="Mein Konto"
        subtitle={`${me.displayName} · ${me.username} · ${me.hasPassword ? 'Passwort + Authenticator-App' : 'nur Passkey'}`}
      />
      <Card
        title="Passkeys"
        actions={
          passkeysSupported() ? (
            <Button size="sm" busy={busy === 'add'} disabled={busy !== null} onClick={add}>
              Passkey hinzufügen
            </Button>
          ) : null
        }
      >
        <p className="mb-4 text-sm text-muted">
          Mit einem Passkey meldest du dich per Face ID, Touch ID, Windows Hello oder Bildschirmsperre an. Passkeys
          gelten nur für diese Adresse ({window.location.host}).
        </p>
        {!passkeysSupported() ? <Notice tone="warning">Dieser Browser unterstützt keine Passkeys.</Notice> : null}
        {onlyAccess && me.role === 'owner' ? (
          <Notice tone="warning">
            Das ist dein einziger Zugang. Füge einen zweiten Passkey hinzu (z. B. Laptop) oder stelle sicher, dass es
            einen weiteren Owner gibt, der dir eine Reset-Einladung schicken kann.
          </Notice>
        ) : null}
        {!data ? (
          <Spinner />
        ) : passkeys.length === 0 ? (
          <Empty>Noch kein Passkey eingerichtet.</Empty>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-raised/50 p-3">
                <div className="min-w-0 flex-1">
                  {editing?.id === p.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        rename();
                      }}
                    >
                      <Input
                        aria-label="Name des Passkeys"
                        value={editing.name}
                        maxLength={60}
                        onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                        autoFocus
                      />
                      <Button type="submit" size="sm" busy={busy === `rename-${p.id}`}>
                        Speichern
                      </Button>
                    </form>
                  ) : (
                    <>
                      <div className="font-semibold">{p.name}</div>
                      <div className="text-sm text-muted">
                        angelegt {formatDateTime(p.created_at)} · zuletzt genutzt{' '}
                        {p.last_used_at ? formatDateTime(p.last_used_at) : 'nie'}
                      </div>
                    </>
                  )}
                </div>
                {editing?.id !== p.id ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== null}
                      onClick={() => setEditing({ id: p.id, name: p.name })}
                    >
                      Umbenennen
                    </Button>
                    <Button size="sm" variant="danger" disabled={busy !== null || onlyAccess} onClick={() => remove(p)}>
                      Löschen
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
