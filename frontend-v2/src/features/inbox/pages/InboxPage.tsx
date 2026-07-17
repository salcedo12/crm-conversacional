import { useEffect, useMemo, useState } from 'react';
import { useSearchParams }     from 'react-router-dom';
import { useAuth }           from '@/features/auth/hooks/useAuth';
import { EmptyState }        from '@/shared/components/EmptyState';
import { LeadDrawer }        from '@/features/leads/components/LeadDrawer';
import { listAdvisors, type Advisor } from '@/features/leads/services/advisors.service';
import { LeadList }          from '../components/LeadList';
import { ChatWindow }        from '../components/ChatWindow';
import { useLeads }          from '../hooks/useLeads';
import { useSelectedLead }   from '../hooks/useSelectedLead';

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { companyId, user, role }                = useAuth();
  const { leads, loading }                       = useLeads(companyId, 500, { uid: user?.uid ?? null, role });
  const { selected, selectedId, select, clear }  = useSelectedLead(leads);
  const [detailsOpen, setDetailsOpen]            = useState(false);
  const [advisors, setAdvisors]                  = useState<Advisor[]>([]);

  const requestedLeadId = searchParams.get('lead');
  useEffect(() => {
    if (requestedLeadId && requestedLeadId !== selectedId && leads.some((lead) => lead.id === requestedLeadId)) {
      select(requestedLeadId);
    }
  }, [requestedLeadId, selectedId, leads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return;
    listAdvisors(companyId)
      .then(setAdvisors)
      .catch((err) => console.error('[InboxPage] error cargando asesores:', err));
  }, [companyId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const lead of leads) {
      for (const tag of lead.tags ?? []) {
        if (tag.trim()) set.add(tag.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leads]);

  const handleSelect = (leadId: string) => {
    select(leadId);
    setDetailsOpen(false);
    setSearchParams({ lead: leadId });
  };

  const handleClear = () => {
    clear();
    setDetailsOpen(false);
    setSearchParams({});
  };

  return (
    <div className="flex h-full">
      {/* Lista de leads — panel izquierdo.
          En móvil ocupa todo el ancho y se oculta cuando hay un chat abierto. */}
      <div className={`w-full md:w-72 shrink-0 h-full border-r border-zinc-800 ${selectedId ? 'hidden md:block' : 'block'}`}>
        <LeadList
          leads={leads}
          loading={loading}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </div>

      {/* Chat — panel derecho. En móvil solo se ve cuando hay un lead seleccionado. */}
      <div className={`flex-1 h-full ${selectedId ? 'block' : 'hidden md:block'}`}>
        {selected ? (
          <ChatWindow
            lead={selected}
            companyId={companyId ?? 'empresa_demo'}
            onBack={handleClear}
            onOpenLeadDetails={() => setDetailsOpen(true)}
          />
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

      {selected && detailsOpen && (
        <LeadDrawer
          lead={selected}
          companyId={companyId ?? ''}
          allTags={allTags}
          advisors={advisors}
          onClose={() => setDetailsOpen(false)}
        />
      )}
    </div>
  );
}
