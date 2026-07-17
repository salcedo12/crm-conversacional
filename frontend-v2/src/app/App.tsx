import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }     from '@/providers/AuthProvider';
import { ProtectedRoute }   from '@/routes/ProtectedRoute';
import { RoleRoute }        from '@/routes/RoleRoute';
import { DashboardLayout }  from '@/layouts/DashboardLayout';
import { LoginPage }        from '@/features/auth/pages/LoginPage';
import { DashboardPage }    from '@/features/dashboard/pages/DashboardPage';
import { InboxPage }        from '@/features/inbox/pages/InboxPage';
import { LeadsPage }        from '@/features/leads/pages/LeadsPage';
import { ConfigPage }       from '@/features/config/pages/ConfigPage';
import { TemplatesPage }    from '@/features/templates/pages/TemplatesPage';
import { BroadcastsPage }   from '@/features/broadcasts/pages/BroadcastsPage';
import { CalendarPage }     from '@/features/calendar/pages/CalendarPage';
import { CallsPage }        from '@/features/calls/pages/CallsPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected */}
          <Route element={<ProtectedRoute />}>
            <Route element={<DashboardLayout />}>
              <Route path="/dashboard"        element={<DashboardPage />} />
              <Route path="/dashboard/inbox"  element={<InboxPage />} />
              <Route path="/dashboard/leads"     element={<LeadsPage />} />
              <Route path="/dashboard/calls"     element={<CallsPage />} />
              <Route path="/dashboard/calendar"  element={<CalendarPage />} />
              <Route path="/dashboard/config"    element={<ConfigPage />} />

              {/* Solo admin/manager */}
              <Route element={<RoleRoute allowed={['admin', 'manager']} />}>
                <Route path="/dashboard/templates"  element={<TemplatesPage />} />
                <Route path="/dashboard/broadcasts" element={<BroadcastsPage />} />
              </Route>

            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard/inbox" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
