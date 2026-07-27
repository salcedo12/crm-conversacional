import { useEffect, useMemo, useState } from 'react';
import { useSearchParams }     from 'react-router-dom';
import { Timestamp }           from 'firebase/firestore';
import { useAuth }           from '@/features/auth/hooks/useAuth';
import { EmptyState }        from '@/shared/components/EmptyState';
import { LeadDrawer }        from '@/features/leads/components/LeadDrawer';
import { listAdvisors, type Advisor } from '@/features/leads/services/advisors.service';
import { LeadList }          from '../components/LeadList';
import { ChatWindow }        from '../components/ChatWindow';
import { NewContactModal }   from '../components/NewContactModal';
import { useLeads }          from '../hooks/useLeads';
import { useSelectedLead }   from '../hooks/useSelectedLead';
import { setLocalLeadRead, useLocalReadReceipts } from '../hooks/useLocalReadReceipts';
import { isLeadUnreadForUser } from '../utils/readState';
import { markLeadsRead } from '../services/notifications.service';

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { companyId, user, role }                = useAuth();
  const { leads, loading }                       = useLeads(companyId, 500, { uid: user?.uid ?? null, role });
  const localReadAt                              = useLocalReadReceipts();
  const visibleLeads = useMemo(() => {
    if (!user?.uid) return leads;
    return leads.map((lead) => {
      const readAtMillis = localReadAt[lead.id];
      if (!readAtMillis) return lead;

      const remoteReadAt = lead.readBy?.[user.uid]?.toMillis?.() ?? 0;
      if (remoteReadAt >= readAtMillis) return lead;

      return {
        ...lead,
        readBy: {
          ...(lead.readBy ?? {}),
          [user.uid]: Timestamp.fromMillis(readAtMillis),
        },
      };
    });
  }, [leads, localReadAt, user?.uid]);
  const { selected, selectedId, select, clear }  = useSelectedLead(visibleLeads);
  const [detailsOpen, setDetailsOpen]            = useState(false);
  const [newContactOpen, setNewContactOpen]      = useState(false);
  const [advisors, setAdvisors]                  = useState<Advisor[]>([]);
  const canWrite = role !== 'viewer';

  const requestedLeadId = searchParams.get('lead');
  useEffect(() => {
    if (requestedLeadId && requestedLeadId !== selectedId && visibleLeads.some((lead) => lead.id === requestedLeadId)) {
      select(requestedLeadId);
    }
  }, [requestedLeadId, selectedId, visibleLeads]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!companyId) return;
    listAdvisors(companyId)
      .then(setAdvisors)
      .catch((err) => console.error('[InboxPage] error cargando asesores:', err));
  }, [companyId]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const lead of visibleLeads) {
      for (const tag of lead.tags ?? []) {
        if (tag.trim()) set.add(tag.trim());
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [visibleLeads]);

  const markLocalRead = (leadId: string, readAtMillis: number) => {
    setLocalLeadRead(leadId, readAtMillis);
  };

  const handleSelect = (leadId: string) => {
    const lead = visibleLeads.find((item) => item.id === leadId);
    if (lead?.lastInboundAt) markLocalRead(leadId, lead.lastInboundAt.toMillis());
    select(leadId);
    setDetailsOpen(false);
    setSearchParams({ lead: leadId });
  };

  const handleClear = () => {
    clear();
    setDetailsOpen(false);
    setSearchParams({});
  };

  const handleContactCreated = (leadId: string) => {
    setNewContactOpen(false);
    // El lead nuevo llega por el snapshot en tiempo real; al fijar ?lead=<id>
    // el efecto de requestedLeadId lo selecciona apenas aparece en la lista.
    setSearchParams({ lead: leadId });
  };

  const handleMarkAllRead = () => {
    const unread = visibleLeads.filter((lead) => isLeadUnreadForUser(lead, user?.uid));
    if (!unread.length) return;
    // Optimista local (instantáneo) + persistencia en servidor (se comparte entre sesiones).
    for (const lead of unread) {
      if (lead.lastInboundAt) markLocalRead(lead.id, lead.lastInboundAt.toMillis());
    }
    markLeadsRead(companyId ?? 'empresa_demo', unread.map((lead) => lead.id))
      .catch((err) => console.warn('[Inbox] No se pudo marcar todo como leído:', err));
  };

  return (
    <div className="flex h-full">
      {/* Lista de leads — panel izquierdo.
          En móvil ocupa todo el ancho y se oculta cuando hay un chat abierto. */}
      <div className={`w-full md:w-72 shrink-0 h-full border-r border-zinc-800 ${selectedId ? 'hidden md:block' : 'block'}`}>
        <LeadList
          leads={visibleLeads}
          loading={loading}
          selectedId={selectedId}
          onSelect={handleSelect}
          onNewContact={canWrite ? () => setNewContactOpen(true) : undefined}
          onMarkAllRead={handleMarkAllRead}
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
            onMarkedRead={markLocalRead}
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

      {newContactOpen && (
        <NewContactModal
          companyId={companyId ?? 'empresa_demo'}
          onClose={() => setNewContactOpen(false)}
          onCreated={handleContactCreated}
        />
      )}
    </div>
  );
}
