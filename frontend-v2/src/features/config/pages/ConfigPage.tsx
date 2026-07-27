import { useState } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { Spinner } from '@/shared/components/Spinner';
import { AiConfigForm } from '../components/AiConfigForm';
import { SchedulingConfigForm } from '../components/SchedulingConfigForm';
import { UserManagementPanel } from '../components/UserManagementPanel';
import { ContactFieldsPanel } from '../components/ContactFieldsPanel';
import { GoogleConnectionPanel } from '@/features/calendar/components/GoogleConnectionPanel';
import { useAiConfig } from '../hooks/useAiConfig';

type Tab = 'ia' | 'conexiones' | 'agenda' | 'usuarios' | 'campos';

const TABS: [Tab, string, boolean][] = [
  ['ia', 'Asistente IA', true],
  ['conexiones', 'Conexiones', false],
  ['agenda', 'Agenda', true],
  ['usuarios', 'Usuarios', true],
  ['campos', 'Campos', true],
];

export function ConfigPage() {
  const { companyId, profile, role, signOut } = useAuth();
  const isAdmin = isAdminRole(role);
  const visibleTabs = TABS.filter(([, , adminOnly]) => !adminOnly || isAdmin);
  const [tab, setTab] = useState<Tab>(isAdmin ? 'ia' : 'conexiones');

  const {
    draft, status, error, isDirty,
    save, reset, update,
  } = useAiConfig(companyId);

  const resolvedCompanyId = companyId ?? 'empresa_demo';

  return (
    <div className="flex h-full flex-col overflow-hidden bg-zinc-950">
      <div className="shrink-0 border-b border-zinc-800 px-6 pb-0 pt-5">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-base font-semibold text-zinc-100">Configuracion</h1>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400 md:hidden"
          >
            <span className="truncate max-w-[120px]">{profile?.displayName ?? profile?.email ?? 'Salir'}</span>
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {visibleTabs.map(([item, label]) => (
            <button
              key={item}
              onClick={() => setTab(item)}
              className={`shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-xs font-medium transition-colors ${
                tab === item
                  ? 'border-violet-500 bg-violet-500/5 text-violet-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'ia' && (
          <div className="max-w-3xl px-6 py-6">
            {status === 'loading' ? (
              <div className="flex justify-center py-16"><Spinner /></div>
            ) : !draft ? (
              <div className="flex justify-center py-16">
                <p className="text-sm text-zinc-500">{error ?? 'No se pudo cargar la configuracion.'}</p>
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

        {tab === 'conexiones' && (
          <div className="max-w-2xl px-6 py-6">
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-100">Conexiones</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Conecta tu Google Calendar y Meet para que las citas se agenden automaticamente.
              </p>
            </div>
            <GoogleConnectionPanel companyId={resolvedCompanyId} />
          </div>
        )}

        {tab === 'agenda' && (
          <div className="max-w-2xl px-6 py-6">
            <div className="mb-6">
              <h2 className="text-sm font-semibold text-zinc-100">Horario de atencion</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Define cuando la IA y los asesores pueden agendar citas.
              </p>
            </div>
            <SchedulingConfigForm companyId={resolvedCompanyId} />
          </div>
        )}

        {tab === 'usuarios' && (
          <div className="max-w-4xl px-6 py-6">
            <UserManagementPanel companyId={resolvedCompanyId} />
          </div>
        )}

        {tab === 'campos' && (
          <div className="max-w-4xl px-6 py-6">
            <ContactFieldsPanel companyId={resolvedCompanyId} />
          </div>
        )}
      </div>
    </div>
  );
}
