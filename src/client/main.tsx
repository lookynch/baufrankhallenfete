import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { guestHome } from '../shared/pwa.ts';
import { I18nProvider } from './lib/i18n.tsx';
import { applyTheme } from './lib/theme.ts';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { BootstrapPage, InvitePage, SpotifyCallbackPage } from './pages/admin/AuthPages.tsx';
import { DisplayApp } from './pages/display/DisplayApp.tsx';
import { GuestApp, JoinPage } from './pages/guest/GuestApp.tsx';
import { ImprintPage, PrivacyPage } from './pages/legal/LegalPages.tsx';

applyTheme();

function LegacyJoinRedirect() {
  const { token = '' } = useParams();
  return <Navigate to={`${guestHome}v/${token}`} replace />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to={guestHome} replace />} />
        <Route path="/v/:token" element={<LegacyJoinRedirect />} />
        <Route
          path="/fete"
          element={
            <I18nProvider>
              <GuestApp />
            </I18nProvider>
          }
        />
        <Route
          path="/fete/v/:token"
          element={
            <I18nProvider>
              <JoinPage />
            </I18nProvider>
          }
        />
        <Route
          path="/display"
          element={
            <I18nProvider fixed="de">
              <DisplayApp />
            </I18nProvider>
          }
        />
        {['/datenschutz', '/fete/datenschutz'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <I18nProvider>
                <PrivacyPage />
              </I18nProvider>
            }
          />
        ))}
        {['/impressum', '/fete/impressum'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <I18nProvider>
                <ImprintPage />
              </I18nProvider>
            }
          />
        ))}
        <Route
          path="/admin/invite"
          element={
            <I18nProvider fixed="de">
              <InvitePage />
            </I18nProvider>
          }
        />
        <Route
          path="/admin/bootstrap"
          element={
            <I18nProvider fixed="de">
              <BootstrapPage />
            </I18nProvider>
          }
        />
        <Route
          path="/admin/spotify/callback"
          element={
            <I18nProvider fixed="de">
              <SpotifyCallbackPage />
            </I18nProvider>
          }
        />
        <Route
          path="/admin/*"
          element={
            <I18nProvider fixed="de">
              <AdminApp />
            </I18nProvider>
          }
        />
        <Route path="*" element={<Navigate to={guestHome} replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
