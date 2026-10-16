import { useCallback, useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { Notice, Spinner, useToast } from '../../components/ui.tsx';
import { api, ApiError } from '../../lib/api.ts';
import { theme } from '../../lib/theme.ts';
import { LegalLinks } from '../legal/LegalPages.tsx';
import { AccountPage } from './AccountPage.tsx';
import { LoginPage } from './AuthPages.tsx';
import { Dashboard } from './Dashboard.tsx';
import { LedgerPage } from './LedgerPage.tsx';
import { MusicPage } from './MusicPage.tsx';
import { RoundsPage } from './RoundsPage.tsx';
import { AdminProvider, type Me } from './shared.tsx';
import { AuditPage, BuzzerPage, DisplaysPage, SettingsPage, UsersPage } from './SystemPages.tsx';
import { WishesPage } from './WishesPage.tsx';

const nav = [
  { to: '/admin', label: 'Übersicht', icon: '◎', end: true },
  { to: '/admin/rounds', label: 'Voting & Queue', icon: '🗳' },
  { to: '/admin/music', label: 'Musik & Sets', icon: '♫' },
  { to: '/admin/wishes', label: 'Wünsche', icon: '✦' },
  { to: '/admin/ledger', label: 'Buchhaltung', icon: '€' },
  { to: '/admin/buzzer', label: 'Buzzer', icon: '◉' },
  { to: '/admin/displays', label: 'Displays', icon: '▭' },
  { to: '/admin/settings', label: 'Einstellungen', icon: '⚙' },
  { to: '/admin/users', label: 'Admins', icon: '👤' },
  { to: '/admin/audit', label: 'Audit & Sicherheit', icon: '⛨' },
  { to: '/admin/account', label: 'Mein Konto', icon: '🔑' },
];

export function AdminApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>('loading');
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/admin/auth/me'));
      setState('ready');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 401 ? 'login' : 'error');
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  if (state === 'loading') {
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner />
      </main>
    );
  }
  if (state === 'login') return <LoginPage onLoggedIn={() => void loadMe()} />;
  if (state === 'error' || !me) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Notice tone="danger">Adminbereich nicht erreichbar (Cloudflare Access oder Netzwerk prüfen).</Notice>
      </main>
    );
  }

  async function logout() {
    await api.post('/api/admin/auth/logout').catch(() => undefined);
    window.location.href = '/admin';
  }

  return (
    <AdminProvider me={me} reloadMe={loadMe} notify={toast.show}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-64 transform border-r border-line bg-surface p-4 transition lg:static lg:translate-x-0 ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="mb-6 flex items-center gap-3 px-2">
            <img src={theme.event.logo} alt="" className="h-9 w-9" />
            <div>
              <div className="font-display font-bold">{theme.event.name}</div>
              <div className="text-xs text-muted">Admin</div>
            </div>
          </div>
          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-primary text-on-primary' : 'text-muted hover:bg-raised hover:text-fg'}`
                }
              >
                <span className="w-5 text-center">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-8 border-t border-line pt-4 text-sm">
            <div className="px-2 font-semibold">{me.displayName}</div>
            <div className="px-2 text-xs text-muted">
              {me.username} · {me.role}
            </div>
            {me.hasTotp && me.recoveryCodesLeft < 3 ? (
              <div className="mt-2 px-2 text-xs text-warning">
                Nur noch {me.recoveryCodesLeft} Wiederherstellungscodes!
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-3 w-full rounded-xl px-3 py-2 text-left text-muted hover:bg-raised hover:text-fg"
            >
              Abmelden
            </button>
            <div className="mt-4">
              <LegalLinks admin />
            </div>
          </div>
        </aside>
        {menuOpen ? (
          <button
            type="button"
            aria-label="Menü schließen"
            className="fixed inset-0 z-30 bg-bg/60 lg:hidden"
            onClick={() => setMenuOpen(false)}
          />
        ) : null}
        <div className="min-w-0">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/85 px-4 py-3 backdrop-blur lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="rounded-lg bg-raised px-3 py-1.5 text-sm font-semibold"
              aria-label="Menü öffnen"
            >
              ☰
            </button>
            <span className="font-display font-bold">Admin</span>
          </header>
          <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
            <Routes>
              <Route index element={<Dashboard />} />
              <Route path="rounds" element={<RoundsPage />} />
              <Route path="music" element={<MusicPage />} />
              <Route path="wishes" element={<WishesPage />} />
              <Route path="ledger" element={<LedgerPage />} />
              <Route path="buzzer" element={<BuzzerPage />} />
              <Route path="displays" element={<DisplaysPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="audit" element={<AuditPage />} />
              <Route path="account" element={<AccountPage />} />
              <Route path="*" element={<Notice>Seite nicht gefunden.</Notice>} />
            </Routes>
          </main>
        </div>
      </div>
      {toast.element}
    </AdminProvider>
  );
}
