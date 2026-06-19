import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider }     from '@/providers/AuthProvider';
import { ProtectedRoute }   from '@/routes/ProtectedRoute';
import { RoleRoute }        from '@/routes/RoleRoute';
import { DashboardLayout }  from '@/layouts/DashboardLayout';
import { LoginPage }        from '@/features/auth/pages/LoginPage';
import { InboxPage }        from '@/features/inbox/pages/InboxPage';
import { LeadsPage }        from '@/features/leads/pages/LeadsPage';
import { ConfigPage }       from '@/features/config/pages/ConfigPage';
import { TemplatesPage }    from '@/features/templates/pages/TemplatesPage';
import { CalendarPage }     from '@/features/calendar/pages/CalendarPage';

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
              <Route path="/dashboard/inbox"  element={<InboxPage />} />
              <Route path="/dashboard/leads"     element={<LeadsPage />} />
              <Route path="/dashboard/calendar"  element={<CalendarPage />} />
              <Route path="/dashboard/config"    element={<ConfigPage />} />

              {/* Solo admin/manager */}
              <Route element={<RoleRoute allowed={['admin', 'manager']} />}>
                <Route path="/dashboard/templates" element={<TemplatesPage />} />
              </Route>

              {/* Default redirect */}
              <Route path="/dashboard" element={<Navigate to="/dashboard/inbox" replace />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard/inbox" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
