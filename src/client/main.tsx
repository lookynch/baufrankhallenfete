import '@fontsource-variable/inter';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router';
import { I18nProvider } from './lib/i18n.tsx';
import { applyTheme } from './lib/theme.ts';
import { AdminApp } from './pages/admin/AdminApp.tsx';
import { BootstrapPage, InvitePage, SpotifyCallbackPage } from './pages/admin/AuthPages.tsx';
import { DisplayApp } from './pages/display/DisplayApp.tsx';
import { GuestApp, JoinPage } from './pages/guest/GuestApp.tsx';

applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <I18nProvider>
              <GuestApp />
            </I18nProvider>
          }
        />
        <Route
          path="/v/:token"
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
        <Route path="/admin/invite" element={<InvitePage />} />
        <Route path="/admin/bootstrap" element={<BootstrapPage />} />
        <Route path="/admin/spotify/callback" element={<SpotifyCallbackPage />} />
        <Route
          path="/admin/*"
          element={
            <I18nProvider fixed="de">
              <AdminApp />
            </I18nProvider>
          }
        />
        <Route
          path="*"
          element={
            <I18nProvider>
              <GuestApp />
            </I18nProvider>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
