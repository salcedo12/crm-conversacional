import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet }  from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import {
  LayoutDashboard, MessageSquare, Users, Phone, TrendingUp,
  FileText, LayoutTemplate, Megaphone, Calendar, Settings,
  LogOut, Menu, Database, Layers, ClipboardCheck, AlertTriangle, type LucideIcon,
  Handshake,
} from 'lucide-react';
import { db }               from '@/config/firebase';
import { useAuth }          from '@/features/auth/hooks/useAuth';
import { isAdminRole }      from '@/features/auth/types';
import { CallOverlay }      from '@/features/calls/components/CallOverlay';
import { CallSessionProvider } from '@/features/calls/providers/CallSessionProvider';
import { InboxNotifications } from '@/features/inbox/components/InboxNotifications';
import { InstallPrompt } from '@/shared/components/InstallPrompt';
import { useBranding } from '@/providers/BrandingProvider';
import { listPlatformCompanies, type PlatformCompany } from '@/features/platform/services/platformCompanies.service';
import { FichaTecnicaModal } from '@/features/calendar/components/FichaTecnicaModal';
import { listLeadTransferRequests } from '@/features/inbox/services/contacts.service';
import { ThemeToggle } from '@/shared/components/ThemeToggle';

interface NavItem {
  to:        string;
  icon:      LucideIcon;
  label:     string;
  adminOnly?: boolean;
  end?:      boolean;
  /** Se muestra directo en la barra inferior de móvil (máx 4). El resto va en "Más". */
  primary?:  boolean;
}

const navItems: NavItem[] = [
  { to: '/dashboard/inbox',                 icon: MessageSquare,   label: 'Bandeja',           primary: true },
  { to: '/dashboard/commercial-management', icon: ClipboardCheck,  label: 'Gestión Comercial', primary: true },
  { to: '/dashboard/pipeline',              icon: Layers,          label: 'Tablero / Embudo',  primary: true },
  { to: '/dashboard',                       icon: LayoutDashboard, label: 'Resumen', end: true, primary: true },
  { to: '/dashboard/leads',                 icon: Users,           label: 'Leads' },
  { to: '/dashboard/deals',                 icon: Handshake,       label: 'Negocios' },
  { to: '/dashboard/calendar',              icon: Calendar,        label: 'Calendario' },
  { to: '/dashboard/database',              icon: Database,        label: 'Base de Datos',     adminOnly: true },
  { to: '/dashboard/calls',                 icon: Phone,           label: 'Llamadas IA' },
  { to: '/dashboard/marketing',             icon: TrendingUp,      label: 'Marketing',         adminOnly: true },
  { to: '/dashboard/reports',               icon: FileText,        label: 'Informes',          adminOnly: true },
  { to: '/dashboard/templates',             icon: LayoutTemplate,  label: 'Plantillas',        adminOnly: true },
  { to: '/dashboard/broadcasts',            icon: Megaphone,       label: 'Masivos',           adminOnly: true },
  { to: '/dashboard/config',                icon: Settings,        label: 'Config' },
];

export function DashboardLayout() {
  const { companyId, profile, role, platformAdmin, setActiveCompanyId, signOut } = useAuth();
  const { branding } = useBranding();
  const [moreOpen, setMoreOpen] = useState(false);
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [companiesError, setCompaniesError] = useState(false);
  const [showUnblockFichaModal, setShowUnblockFichaModal] = useState(false);
  const [pendingTransfersCount, setPendingTransfersCount] = useState(0);
  const isAdmin = platformAdmin || isAdminRole(role);
  const visibleNavItems = navItems.filter((item) => !item.adminOnly || isAdmin);
  const isTester = profile?.email?.toLowerCase().includes('google.tester');
  const canAccessDemo = isTester || platformAdmin;
  const availableCompanies = useMemo(
    () => companies.filter((company) => canAccessDemo || company.id !== 'empresa_demo'),
    [companies, canAccessDemo]
  );
  const activeCompany = useMemo(
    () => availableCompanies.find((company) => company.id === companyId),
    [availableCompanies, companyId]
  );

  useEffect(() => {
    if (!platformAdmin) return;
    let cancelled = false;
    listPlatformCompanies()
      .then((rows) => {
        if (cancelled) return;
        setCompanies(rows);
        setCompaniesError(false);
      })
      .catch((err) => {
        console.error('[DashboardLayout] companies load error:', err);
        if (!cancelled) setCompaniesError(true);
      });

    return () => { cancelled = true; };
  }, [platformAdmin]);

  // Bloqueo estricto de SLA para asesores desactivado temporalmente hasta su capacitación
  const ENABLE_LIVE_SLA_BLOCK_BANNER = false;

  // Escuchar en vivo las solicitudes de traslado pendientes (para Admin)
  useEffect(() => {
    if (!companyId || !isAdmin) {
      setPendingTransfersCount(0);
      return;
    }
    let active = true;
    listLeadTransferRequests(companyId, 'pending')
      .then((list) => {
        if (active) setPendingTransfersCount(list.length);
      })
      .catch(() => {});

    const q = query(
      collection(db, 'companies', companyId, 'leadTransferRequests'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        if (active) setPendingTransfersCount(snap.size);
      },
      () => {
        // Si las reglas de Firestore restringen lectura directa, usamos el polling de la callable
      }
    );
    const timer = window.setInterval(() => {
      listLeadTransferRequests(companyId, 'pending')
        .then((list) => {
          if (active) setPendingTransfersCount(list.length);
        })
        .catch(() => {});
    }, 30_000);

    return () => {
      active = false;
      unsub();
      window.clearInterval(timer);
    };
  }, [companyId, isAdmin]);

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
            <img src={branding.logoUrl || '/meraki-logo.png'} alt={`${branding.appName} logo`} className="h-8 w-8 rounded-full object-cover" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-100 leading-none">{branding.appName}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">{branding.tagline}</p>
            </div>
          </div>
          {platformAdmin && (
            <div className="mt-3">
              <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                Empresa activa
              </label>
              <select
                value={companyId ?? ''}
                onChange={(event) => setActiveCompanyId(event.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2.5 py-2 text-xs font-medium text-zinc-100 outline-none focus:border-emerald-500"
              >
                {!availableCompanies.some((company) => company.id === companyId) && companyId && (companyId !== 'empresa_demo' || canAccessDemo) && (
                  <option value={companyId}>{companyId}</option>
                )}
                {availableCompanies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-zinc-500">
                {activeCompany && (
                  <>
                    <span className={activeCompany.environment === 'demo' ? 'text-amber-300' : 'text-emerald-300'}>
                      {activeCompany.environment === 'demo' ? 'Demo' : 'Produccion'}
                    </span>
                    <span>·</span>
                    <span>{activeCompany.channelRoutes.length} canales</span>
                    {activeCompany.smartHomeEnabled && <span className="text-sky-300">· SmartHome</span>}
                  </>
                )}
                {companiesError && <span className="text-red-300">No cargo empresas</span>}
              </div>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 flex flex-col gap-0.5 overflow-y-auto">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `
                  flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors
                  ${isActive
                    ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
                  }
                `}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon size={17} className="shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {isAdmin && pendingTransfersCount > 0 && (item.to === '/dashboard/leads' || item.to === '/dashboard/commercial-management') && (
                  <span
                    className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.2 text-[10px] font-bold text-white shadow-sm animate-pulse"
                    title={`${pendingTransfersCount} solicitud(es) de traslado pendiente(s)`}
                  >
                    {pendingTransfersCount}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        {/* Selector de Tema Meraki (2 Opciones: Modo Oscuro vs Modo Claro) */}
        <div className="px-3 py-2.5 border-t border-zinc-800">
          <div className="mb-1.5 px-0.5 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Tema Visual
            </span>
            <span className="text-[10px] font-mono text-amber-500/90 font-medium">
              Meraki
            </span>
          </div>
          <ThemeToggle className="w-full" />
        </div>

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
            <LogOut size={15} />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Banner de llamada entrante / barra de llamada activa (WhatsApp Calling) */}
      <CallOverlay />
      <InboxNotifications />
      <InstallPrompt />

      {/* ── Contenido ──────────────────────────────────────────────────────── */}
      {/* pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] y pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] para librar la Dynamic Island/Notch y Home Bar en iPhone PWA */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom,0px))] pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] md:pb-0 md:pt-0">
        {ENABLE_LIVE_SLA_BLOCK_BANNER && profile?.isBlockedForLeads && (
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-rose-950/95 via-amber-950/90 to-zinc-950 border-b border-rose-500/40 px-4 py-2.5 text-xs text-rose-100 shadow-md">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0 animate-pulse" />
              <p className="leading-snug">
                <strong className="text-rose-300">
                  {profile.receiveLeads === false
                    ? '⚠️ Alerta de Mora de Seguimiento (SLA):'
                    : '⚠️ Recepción de leads nuevos PAUSADA:'}
                </strong>{' '}
                {profile.blockedReason?.startsWith('SLA_TOMA_MANUAL')
                  ? `Apagaste la IA hace más de 24h sin registrar Ficha Técnica${profile.unresolvedLeadName ? ` para ${profile.unresolvedLeadName}` : ''}.`
                  : profile.blockedReason?.startsWith('SLA_POST_CITA')
                  ? 'Tienes una cita finalizada pendiente de reporte en Ficha Técnica.'
                  : 'Incumplimiento de SLA de contacto previo a cita.'}{' '}
                <span className="text-amber-200/90">
                  Diligencia la Ficha Técnica ahora para reactivarte automáticamente.
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(profile.unresolvedLeadId || profile.unresolvedAppointmentId) && (
                <button
                  type="button"
                  onClick={() => setShowUnblockFichaModal(true)}
                  className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-3 py-1.5 rounded-lg font-bold text-xs transition-colors shadow-sm cursor-pointer"
                >
                  📝 Llenar Ficha Técnica Ahora ({profile.unresolvedLeadName || 'Autodesbloquear'})
                </button>
              )}
              <NavLink
                to="/dashboard/commercial-management"
                className="bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors"
              >
                Ver Mis Pendientes
              </NavLink>
            </div>
          </div>
        )}
        {showUnblockFichaModal && companyId && (
          <FichaTecnicaModal
            isOpen={showUnblockFichaModal}
            onClose={() => setShowUnblockFichaModal(false)}
            companyId={companyId}
            lead={
              profile?.unresolvedLeadId
                ? {
                    id: profile.unresolvedLeadId,
                    name: profile.unresolvedLeadName || 'Prospecto Pendiente',
                    advisorName: profile.displayName,
                  }
                : undefined
            }
            appointment={
              profile?.unresolvedAppointmentId
                ? {
                    id: profile.unresolvedAppointmentId,
                    leadId: profile.unresolvedLeadId || undefined,
                    leadName: profile.unresolvedLeadName || 'Cita Pendiente',
                    advisorName: profile.displayName,
                  }
                : undefined
            }
          />
        )}
        <Outlet />
      </main>

      {/* ── Barra inferior (móvil): 4 principales + Más ─────────────────────── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch border-t border-zinc-800 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          return (
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
              <Icon size={22} className="shrink-0" />
              <span className="truncate max-w-full px-0.5">{item.label}</span>
            </NavLink>
          );
        })}
        <button
          onClick={() => setMoreOpen((open) => !open)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${moreOpen ? 'text-violet-300' : 'text-zinc-500'}`}
        >
          <Menu size={22} className="shrink-0" />
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

            {/* Selector de Modo Oscuro vs Modo Claro en Móvil */}
            <div className="px-5 py-2 mb-2 border-b border-zinc-800/80">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 block mb-1.5">
                Tema Visual Meraki
              </span>
              <ThemeToggle className="w-full" />
            </div>

            <div className="grid grid-cols-3 gap-1 px-3 pb-2">
              {moreItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMoreOpen(false)}
                    className={({ isActive }) => `
                      flex flex-col items-center justify-center gap-1.5 rounded-xl py-3 text-[11px] font-medium transition-colors
                      ${isActive ? 'bg-violet-600/20 text-violet-300' : 'text-zinc-300 hover:bg-zinc-800/70'}
                    `}
                  >
                    <Icon size={24} className="shrink-0" />
                    <span className="truncate max-w-full px-1">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>

            <div className="border-t border-zinc-800 px-3 pt-2">
              <button
                onClick={() => { setMoreOpen(false); signOut(); }}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
              >
                <LogOut size={16} /> Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </CallSessionProvider>
  );
}
