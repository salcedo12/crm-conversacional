const fs = require('fs');
const path = './frontend-v2/src/layouts/DashboardLayout.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add AlertTriangle import
content = content.replace(
  "ClipboardCheck, type LucideIcon,",
  "ClipboardCheck, AlertTriangle, type LucideIcon,"
);

// 2. Add SLA banner inside <main>
const targetMain = `<main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-14 pt-[env(safe-area-inset-top)] md:pb-0 md:pt-0">
        <Outlet />
      </main>`;

const newMain = `<main className="flex-1 flex flex-col min-h-0 overflow-hidden pb-14 pt-[env(safe-area-inset-top)] md:pb-0 md:pt-0">
        {profile?.isBlockedForLeads && (
          <div className="shrink-0 flex items-center justify-between gap-3 bg-amber-950/90 border-b border-amber-500/40 px-4 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
              <p className="truncate">
                <strong>Atención:</strong> Tu recepción de prospectos nuevos está pausada ({profile.blockedReason?.startsWith('SLA_POST_CITA') ? 'Plazo de Ficha Técnica vencido' : 'SLA de cita previa'}). Diligencia la Ficha Técnica para reactivarte automáticamente.
              </p>
            </div>
            <NavLink
              to="/dashboard/commercial-management"
              className="bg-amber-500 hover:bg-amber-400 text-zinc-950 px-3 py-1 rounded-md font-semibold text-xs transition-colors shrink-0"
            >
              Ver Tareas Pendientes
            </NavLink>
          </div>
        )}
        <Outlet />
      </main>`;

content = content.replace(targetMain, newMain);

fs.writeFileSync(path, content, 'utf8');
console.log('DashboardLayout.tsx successfully patched with SLA banner!');
