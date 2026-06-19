import { NavLink, Outlet }  from 'react-router-dom';
import { useAuth }          from '@/features/auth/hooks/useAuth';
import { isAdminRole }      from '@/features/auth/types';

interface NavItem {
  to:        string;
  icon:      string;
  label:     string;
  adminOnly?: boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard/inbox',     icon: '💬', label: 'Bandeja'    },
  { to: '/dashboard/leads',     icon: '👥', label: 'Leads'      },
  { to: '/dashboard/templates', icon: '📋', label: 'Plantillas', adminOnly: true },
  { to: '/dashboard/calendar',  icon: '📅', label: 'Calendario' },
  { to: '/dashboard/config',    icon: '⚙️',  label: 'Config'     },
];

export function DashboardLayout() {
  const { profile, role, signOut } = useAuth();
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdminRole(role));

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* ── Sidebar (escritorio) ───────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 border-r border-zinc-800 bg-zinc-950">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-violet-600 flex items-center justify-center text-sm font-bold">M</div>
            <div>
              <p className="text-sm font-semibold text-zinc-100 leading-none">Meraki CRM</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Conversacional</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `
                flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
                ${isActive
                  ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
                  : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                }
              `}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User info + logout */}
        <div className="px-3 py-3 border-t border-zinc-800">
          <div className="mb-2 px-1">
            <p className="text-xs font-medium text-zinc-300 truncate">{profile?.displayName ?? profile?.email ?? '—'}</p>
            <p className="text-[10px] text-zinc-500 truncate">{profile?.role ?? ''}</p>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <span>🚪</span>
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {/* pb-16 en móvil para no quedar tapado por la barra inferior */}
      <main className="flex-1 overflow-hidden pb-14 md:pb-0">
        <Outlet />
      </main>

      {/* ── Barra inferior (móvil) ─────────────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `
              flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] transition-colors
              ${isActive ? 'text-violet-300' : 'text-zinc-500'}
            `}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
