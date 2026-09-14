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
import { useLeadById }       from '../hooks/useLeadById';
import { useSelectedLead }   from '../hooks/useSelectedLead';
import { setLocalLeadRead, useLocalReadReceipts } from '../hooks/useLocalReadReceipts';
import { isLeadUnreadForUser } from '../utils/readState';
import { markLeadsRead } from '../services/notifications.service';

export function InboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { companyId, user, role }                = useAuth();
  // Paginacion: cargamos pocos leads al inicio (menos lecturas al abrir/volver
  // a la Bandeja). Cuando hay busqueda activa subimos el limite para que el
  // buscador siga cubriendo TODOS los leads, no solo los cargados.
  const [pageSize, setPageSize]                  = useState(50);
  const [search, setSearch]                      = useState('');
  const searching                                = search.trim().length > 0;
  // Al buscar cargamos MUCHOS más (hasta 2000) para cubrir también leads antiguos
  // o cerrados/vendidos que quedan fuera del tope normal por `lastMessageAt`. Solo
  // ocurre mientras hay búsqueda activa; en reposo se mantiene el tope pequeño.
  const effectiveLimit                           = searching ? 2000 : pageSize;
  const { leads, loading }                       = useLeads(companyId, effectiveLimit, { uid: user?.uid ?? null, role });
  const hasMore                                  = !searching && leads.length >= pageSize && pageSize < 500;
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
    // Selecciona el lead de `?lead=<id>` aunque NO esté en la lista cargada/filtrada
    // (p. ej. un Vendido oculto por la pestaña de estado). Si no está en la lista,
    // useLeadById lo trae por id y el chat se abre igual.
    if (requestedLeadId && requestedLeadId !== selectedId) {
      select(requestedLeadId);
    }
  }, [requestedLeadId, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Respaldo: si el lead seleccionado no está en la lista visible, lo traemos por id.
  const inList = !!selectedId && visibleLeads.some((lead) => lead.id === selectedId);
  const { lead: fallbackLead } = useLeadById(companyId, selectedId && !inList ? selectedId : null);
  const activeLead = selected ?? fallbackLead;

  useEffect(() => {
    if (!companyId) return;
    listAdvisors(companyId)
      .then(setAdvisors)
      .catch((err) => console.error('[InboxPage] error cargando asesores:', err));
  }, [companyId]);

  const advisorNames = useMemo(
    () => new Map(advisors.map((advisor) => [advisor.id, advisor.displayName])),
    [advisors]
  );

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
          advisors={advisors}
          search={search}
          onSearchChange={setSearch}
          hasMore={hasMore}
          onLoadMore={() => setPageSize((prev) => Math.min(prev + 50, 500))}
        />
      </div>

      {/* Chat — panel derecho. En móvil solo se ve cuando hay un lead seleccionado.
          `min-w-0` es imprescindible: sin él, un hijo flex-1 no se encoge por debajo
          del ancho de su contenido (media ancha), desborda la pantalla y empuja el
          botón de enviar del composer fuera del borde derecho. */}
      <div className={`flex-1 min-w-0 h-full ${selectedId ? 'block' : 'hidden md:block'}`}>
        {activeLead ? (
          <ChatWindow
            lead={activeLead}
            companyId={companyId ?? 'empresa_demo'}
            advisorNames={advisorNames}
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

      {activeLead && detailsOpen && (
        <LeadDrawer
          lead={activeLead}
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
