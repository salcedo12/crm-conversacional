import { useAuth }           from '@/features/auth/hooks/useAuth';
import { EmptyState }        from '@/shared/components/EmptyState';
import { LeadList }          from '../components/LeadList';
import { ChatWindow }        from '../components/ChatWindow';
import { useLeads }          from '../hooks/useLeads';
import { useSelectedLead }   from '../hooks/useSelectedLead';

export function InboxPage() {
  const { companyId }                            = useAuth();
  const { leads, loading }                       = useLeads(companyId);
  const { selected, selectedId, select, clear }  = useSelectedLead(leads);

  return (
    <div className="flex h-full">
      {/* Lista de leads — panel izquierdo.
          En móvil ocupa todo el ancho y se oculta cuando hay un chat abierto. */}
      <div className={`w-full md:w-72 shrink-0 h-full border-r border-zinc-800 ${selectedId ? 'hidden md:block' : 'block'}`}>
        <LeadList
          leads={leads}
          loading={loading}
          selectedId={selectedId}
          onSelect={select}
        />
      </div>

      {/* Chat — panel derecho. En móvil solo se ve cuando hay un lead seleccionado. */}
      <div className={`flex-1 h-full ${selectedId ? 'block' : 'hidden md:block'}`}>
        {selected ? (
          <ChatWindow lead={selected} companyId={companyId ?? 'empresa_demo'} onBack={clear} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              icon="👈"
              title="Selecciona un lead"
              subtitle="Elige una conversación de la lista para comenzar"
            />
          </div>
        )}
      </div>
    </div>
  );
}
