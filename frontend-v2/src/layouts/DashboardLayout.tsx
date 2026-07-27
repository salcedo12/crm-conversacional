import { useState } from 'react';
import { NavLink, Outlet }  from 'react-router-dom';
import { useAuth }          from '@/features/auth/hooks/useAuth';
import { isAdminRole }      from '@/features/auth/types';
import { CallOverlay }      from '@/features/calls/components/CallOverlay';
import { CallSessionProvider } from '@/features/calls/providers/CallSessionProvider';
import { InboxNotifications } from '@/features/inbox/components/InboxNotifications';

interface NavItem {
  to:        string;
  icon:      string;
  label:     string;
  adminOnly?: boolean;
  end?:      boolean;
  /** Se muestra directo en la barra inferior de móvil (máx 4). El resto va en "Más". */
  primary?:  boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard',           icon: '📊', label: 'Resumen', end: true, primary: true },
  { to: '/dashboard/inbox',     icon: '💬', label: 'Bandeja',    primary: true },
  { to: '/dashboard/leads',     icon: '👥', label: 'Leads',      primary: true },
  { to: '/dashboard/calls',     icon: '📞', label: 'Llamadas IA' },
  { to: '/dashboard/marketing', icon: '📈', label: 'Marketing',  adminOnly: true },
  { to: '/dashboard/reports',   icon: '📄', label: 'Informes',   adminOnly: true },
  { to: '/dashboard/templates', icon: '📋', label: 'Plantillas', adminOnly: true },
  { to: '/dashboard/broadcasts', icon: '📣', label: 'Masivos',   adminOnly: true },
  { to: '/dashboard/calendar',  icon: '📅', label: 'Calendario', primary: true },
  { to: '/dashboard/config',    icon: '⚙️',  label: 'Config'     },
];

export function DashboardLayout() {
  const { profile, role, signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdminRole(role));

  // Móvil: 4 principales en la barra + el resto en la hoja "Más".
  const primaryItems = visibleNavItems.filter((item) => item.primary).slice(0, 4);
  const moreItems     = visibleNavItems.filter((item) => !primaryItems.includes(item));

  return (
    <CallSessionProvider>
    <div className="flex h-dvh bg-zinc-950 text-zinc-100 overflow-hidden overscroll-none">
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
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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

      {/* Banner de llamada entrante / barra de llamada activa (WhatsApp Calling) */}
      <CallOverlay />
      <InboxNotifications />

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {/* pb-14 en móvil para no quedar tapado por la barra inferior */}
      <main className="flex-1 overflow-hidden pb-14 md:pb-0">
        <Outlet />
      </main>

      {/* ── Barra inferior (móvil): 4 principales + Más ─────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {primaryItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setMoreOpen(false)}
            className={({ isActive }) => `
              flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors
              ${isActive ? 'text-violet-300' : 'text-zinc-500'}
            `}
          >
            <span className="text-xl leading-none">{item.icon}</span>
            <span className="truncate max-w-full px-0.5">{item.label}</span>
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${moreOpen ? 'text-violet-300' : 'text-zinc-500'}`}
        >
          <span className="text-xl leading-none">☰</span>
          <span>Más</span>
        </button>
      </nav>

      {/* ── Hoja "Más" (móvil) ──────────────────────────────────────────────── */}
      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-zinc-800 bg-zinc-900 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <span className="h-1 w-10 rounded-full bg-zinc-700" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-1">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-200">{profile?.displayName ?? profile?.email ?? '—'}</p>
                <p className="truncate text-[10px] text-zinc-500">{profile?.role ?? ''}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 px-3 pb-2">
              {moreItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) => `
                    flex flex-col items-center justify-center gap-1 rounded-xl py-3 text-[11px] font-medium transition-colors
                    ${isActive ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-300 hover:bg-zinc-800/70'}
                  `}
                >
                  <span className="text-2xl leading-none">{item.icon}</span>
                  <span className="truncate max-w-full px-1">{item.label}</span>
                </NavLink>
              ))}
            </div>

            <div className="border-t border-zinc-800 px-3 pt-2">
              <button
                onClick={() => { setMoreOpen(false); signOut(); }}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                <span>🚪</span> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </CallSessionProvider>
  );
}
