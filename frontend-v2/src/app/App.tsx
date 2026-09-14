import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }     from '@/providers/AuthProvider';
import { BrandingProvider } from '@/providers/BrandingProvider';
import { ProtectedRoute }   from '@/routes/ProtectedRoute';
import { RoleRoute }        from '@/routes/RoleRoute';
import { DashboardLayout }  from '@/layouts/DashboardLayout';
import { Spinner }          from '@/shared/components/Spinner';
import { AppErrorBoundary } from './AppErrorBoundary';

// Carga diferida por ruta (code-splitting): cada página va en su propio chunk,
// así el arranque descarga solo lo necesario y en móvil carga mucho más rápido.
const LoginPage         = lazy(() => import('@/features/auth/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const DashboardPage     = lazy(() => import('@/features/dashboard/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const InboxPage         = lazy(() => import('@/features/inbox/pages/InboxPage').then((m) => ({ default: m.InboxPage })));
const LeadsPage         = lazy(() => import('@/features/leads/pages/LeadsPage').then((m) => ({ default: m.LeadsPage })));
const PhotoEvidencePage = lazy(() => import('@/features/photoEvidence/pages/PhotoEvidencePage').then((m) => ({ default: m.PhotoEvidencePage })));
const ConfigPage        = lazy(() => import('@/features/config/pages/ConfigPage').then((m) => ({ default: m.ConfigPage })));
const TemplatesPage     = lazy(() => import('@/features/templates/pages/TemplatesPage').then((m) => ({ default: m.TemplatesPage })));
const BroadcastsPage    = lazy(() => import('@/features/broadcasts/pages/BroadcastsPage').then((m) => ({ default: m.BroadcastsPage })));
const CalendarPage      = lazy(() => import('@/features/calendar/pages/CalendarPage').then((m) => ({ default: m.CalendarPage })));
const CallsPage         = lazy(() => import('@/features/calls/pages/CallsPage').then((m) => ({ default: m.CallsPage })));
const MarketingPage     = lazy(() => import('@/features/marketing/pages/MarketingPage').then((m) => ({ default: m.MarketingPage })));
const ReportsPage       = lazy(() => import('@/features/reports/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const BrandHomePage     = lazy(() => import('@/features/legal/pages/BrandHomePage').then((m) => ({ default: m.BrandHomePage })));
const PrivacyPolicyPage = lazy(() => import('@/features/legal/pages/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsPage         = lazy(() => import('@/features/legal/pages/TermsPage').then((m) => ({ default: m.TermsPage })));

function PageLoader() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-950 px-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <Spinner />
        {slow && (
          <div className="max-w-xs">
            <p className="text-sm font-medium text-zinc-200">La carga esta tardando mas de lo normal.</p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">Puede ser cache del navegador despues de una actualizacion.</p>
            <button
              type="button"
              onClick={() => {
                const url = new URL(window.location.href);
                url.searchParams.set('v', String(Date.now()));
                window.location.replace(url.toString());
              }}
              className="mt-3 rounded-lg bg-violet-600 px-4 py-2 text-xs font-semibold text-white hover:bg-violet-500"
            >
              Recargar CRM
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <BrandingProvider>
          <AppErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Routes>
            {/* Public */}
            <Route path="/" element={<BrandHomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/privacy" element={<PrivacyPolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />

            {/* Protected */}
            <Route element={<ProtectedRoute />}>
              <Route element={<DashboardLayout />}>
                <Route path="/dashboard"        element={<DashboardPage />} />
                <Route path="/dashboard/inbox"  element={<InboxPage />} />
                <Route path="/dashboard/leads"     element={<LeadsPage />} />
                <Route path="/dashboard/photo-evidence" element={<PhotoEvidencePage />} />
                <Route path="/dashboard/calls"     element={<CallsPage />} />
                <Route path="/dashboard/calendar"  element={<CalendarPage />} />
                <Route path="/dashboard/config"    element={<ConfigPage />} />

                {/* Solo admin/manager */}
                <Route element={<RoleRoute allowed={['admin', 'manager']} />}>
                  <Route path="/dashboard/marketing"  element={<MarketingPage />} />
                  <Route path="/dashboard/reports"    element={<ReportsPage />} />
                  <Route path="/dashboard/templates"  element={<TemplatesPage />} />
                  <Route path="/dashboard/broadcasts" element={<BroadcastsPage />} />
                </Route>

              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/dashboard/inbox" replace />} />
              </Routes>
            </Suspense>
          </AppErrorBoundary>
        </BrandingProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
