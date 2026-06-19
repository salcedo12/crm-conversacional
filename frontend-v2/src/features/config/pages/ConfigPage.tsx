import { useState }                    from 'react';
import { useAuth }                    from '@/features/auth/hooks/useAuth';
import { isAdminRole }                from '@/features/auth/types';
import { Spinner }                    from '@/shared/components/Spinner';
import { AiConfigForm }               from '../components/AiConfigForm';
import { WhatsappConnectionPanel }    from '../components/WhatsappConnectionPanel';
import { GoogleConnectionPanel }      from '@/features/calendar/components/GoogleConnectionPanel';
import { useAiConfig }                from '../hooks/useAiConfig';

type Tab = 'ia' | 'whatsapp' | 'conexiones' | 'general';

// adminOnly: solo visible para admin/manager. Conexiones (Google) es por asesor.
const TABS: [Tab, string, boolean][] = [
  ['ia',         '🤖 Asistente IA', true],
  ['whatsapp',   '📱 WhatsApp',     true],
  ['conexiones', '🔗 Conexiones',   false],
  ['general',    '⚙️ General',      true],
];

export function ConfigPage() {
  const { companyId, profile, role, signOut } = useAuth();
  const isAdmin = isAdminRole(role);
  const visibleTabs = TABS.filter(([, , adminOnly]) => !adminOnly || isAdmin);
  // Los asesores solo ven "Conexiones", así que arrancan ahí.
  const [tab, setTab]  = useState<Tab>(isAdmin ? 'ia' : 'conexiones');

  const {
    draft, status, error, isDirty,
    save, reset, update,
  } = useAiConfig(companyId);

  return (
    <div className="flex flex-col h-full bg-zinc-950 overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-0 border-b border-zinc-800 shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-zinc-100">Configuración</h1>
          {/* Usuario + logout (solo móvil; en escritorio está en la barra lateral) */}
          <button
            onClick={signOut}
            className="md:hidden flex items-center gap-1.5 text-xs text-zinc-400 hover:text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            🚪 <span className="truncate max-w-[120px]">{profile?.displayName ?? profile?.email ?? 'Salir'}</span>
          </button>
        </div>

        {/* Tabs (scroll horizontal en móvil para que no se corten) */}
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {visibleTabs.map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`
                shrink-0 whitespace-nowrap px-4 py-2 text-xs font-medium rounded-t-lg transition-colors border-b-2
                ${tab === t
                  ? 'text-violet-300 border-violet-500 bg-violet-500/5'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">

        {/* ── IA ─────────────────────────────────────────────────────────── */}
        {tab === 'ia' && (
          <div className="max-w-2xl mx-auto px-6 py-6">
            {status === 'loading' ? (
              <div className="flex justify-center py-16"><Spinner /></div>
            ) : !draft ? (
              <div className="flex justify-center py-16">
                <p className="text-sm text-zinc-500">{error ?? 'No se pudo cargar la configuración.'}</p>
              </div>
            ) : (
              <AiConfigForm
                draft={draft}
                status={status}
                error={error}
                isDirty={isDirty}
                onUpdate={update}
                onSave={save}
                onReset={reset}
              />
            )}
          </div>
        )}

        {/* ── WhatsApp ────────────────────────────────────────────────────── */}
        {tab === 'whatsapp' && (
          <div className="max-w-xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-100">Conexión de WhatsApp</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Conecta tu número de WhatsApp Business al CRM usando el flujo oficial de Meta.
                La app del teléfono sigue funcionando (coexistencia).
              </p>
            </div>
            <WhatsappConnectionPanel companyId={companyId ?? 'empresa_demo'} />
          </div>
        )}

        {/* ── Conexiones (Google Calendar + Meet) ─────────────────────────── */}
        {tab === 'conexiones' && (
          <div className="max-w-2xl mx-auto px-6 py-6">
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-100">Conexiones</h2>
              <p className="text-xs text-zinc-500 mt-1">
                Conecta tu Google Calendar y Meet para que las citas se agenden automáticamente con enlace de videollamada.
              </p>
            </div>
            <GoogleConnectionPanel companyId={companyId ?? 'empresa_demo'} />
          </div>
        )}

        {/* ── General ────────────────────────────────────────────────────── */}
        {tab === 'general' && (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-3xl mb-3">🛠</p>
              <p className="text-sm font-medium text-zinc-300">Próximamente</p>
              <p className="text-xs text-zinc-500 mt-1">Gestión de usuarios, notificaciones y más</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
