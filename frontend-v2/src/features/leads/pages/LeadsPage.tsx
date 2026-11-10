import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, query, where, onSnapshot } from 'firebase/firestore';
import { db }              from '@/config/firebase';
import { useAuth }         from '@/features/auth/hooks/useAuth';
import { Spinner }         from '@/shared/components/Spinner';
import { LeadFilters }     from '../components/LeadFilters';
import { LeadTable }       from '../components/LeadTable';
import { LeadCardList }    from '../components/LeadCardList';
import { LeadDrawer }      from '../components/LeadDrawer';
import { useLeadsPage, type LeadsFilters } from '../hooks/useLeadsPage';
import { listAdvisors, type Advisor } from '../services/advisors.service';
import { collectInboxes }  from '@/features/inbox/utils/inboxes';
import { Bot, CalendarCheck, UserPlus, UserRoundCheck, UsersRound, ArrowRightLeft } from 'lucide-react';
import { ImportContactsModal } from '../components/ImportContactsModal';
import { NewLeadModal } from '../components/NewLeadModal';
import { TransferRequestsModal } from '../components/TransferRequestsModal';
import { listLeadTransferRequests } from '@/features/inbox/services/contacts.service';
import { ImportHistoryModal, LeadListsBar, SmartListModal } from '../components/LeadListsBar';
import {
  createLeadList,
  deleteLeadList,
  listLeadLists,
  type LeadList,
  type LeadListFilters,
} from '../services/leadLists.service';
import type { Lead } from '@/features/inbox/types';
import { isAdminRole } from '@/features/auth/types';
import { listLeadsPage, type LeadsPageCursor } from '../services/leadsPage.service';

import { ExportLeadsModal } from '@/features/dashboard/components/ExportLeadsModal';

const EMPTY_FILTERS: LeadsFilters = {
  search: '', status: 'all', aiEnabled: 'all', assignedTo: 'all', tags: [], inboxId: 'all', listId: 'all', source: 'all',
};

function matchesSmartList(lead: Lead, filters: LeadListFilters): boolean {
  if (filters.status !== 'all' && lead.status !== filters.status) return false;
  if (filters.aiEnabled === 'active' && !lead.aiEnabled) return false;
  if (filters.aiEnabled === 'manual' && lead.aiEnabled) return false;
  if (filters.assignedTo === 'unassigned' && lead.assignedTo) return false;
  if (filters.assignedTo !== 'all' && filters.assignedTo !== 'unassigned' && lead.assignedTo !== filters.assignedTo) return false;
  if (filters.inboxId !== 'all' && lead.inboxId !== filters.inboxId) return false;
  if (filters.tags.length && !lead.tags?.some((tag) => filters.tags.includes(tag))) return false;
  return true;
}

export function LeadsPage() {
  const { companyId, role, user, platformAdmin }  = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<LeadsPageCursor | null>(null);
  const [cursorStack, setCursorStack] = useState<(LeadsPageCursor | null)[]>([]);
  const [currentCursor, setCurrentCursor] = useState<LeadsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const isAdmin = platformAdmin || isAdminRole(role);
  const visibleLeads = useMemo(
    () => isAdmin ? leads : leads.filter((lead) => lead.assignedTo === user?.uid),
    [isAdmin, leads, user?.uid]
  );

  const {
    filters,    setFilters,
    sortField,  sortDir,    toggleSort,
    filtered,
    selected,   selectedId, setSelectedId,
  } = useLeadsPage(visibleLeads);

  const loadLeadsPage = useCallback(async (cursor: LeadsPageCursor | null, reset = false) => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listLeadsPage({
        companyId,
        pageSize: 50,
        cursor,
        // El score se ordena en cliente (sobre la página cargada); el servidor
        // pagina por actividad reciente.
        sortField: sortField === 'score' ? 'lastMessageAt' : sortField,
        sortDir,
        filters,
      });
      setLeads(page.leads);
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      if (reset) {
        setCursorStack([]);
        setCurrentCursor(null);
      }
    } catch (err) {
      console.error('[LeadsPage] error cargando pagina:', err);
      setError('Error cargando leads.');
    } finally {
      setLoading(false);
    }
  }, [companyId, filters, sortDir, sortField]);

  useEffect(() => {
    loadLeadsPage(null, true);
  }, [loadLeadsPage]);

  // Mantener sincronizado en tiempo real el prospecto seleccionado cuando se guarda una Ficha Técnica o Nota
  useEffect(() => {
    if (!companyId || !selectedId) return;
    const unsub = onSnapshot(
      doc(db, 'companies', companyId, 'leads', selectedId),
      (snap) => {
        if (!snap.exists()) return;
        const freshData = snap.data() as Partial<Lead>;
        setLeads((prev) =>
          prev.map((l) => (l.id === snap.id ? ({ ...l, ...freshData, id: snap.id } as Lead) : l))
        );
      },
      () => {}
    );
    return () => unsub();
  }, [companyId, selectedId]);

  const goNextPage = async () => {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, currentCursor]);
    setCurrentCursor(nextCursor);
    await loadLeadsPage(nextCursor);
  };

  const goPrevPage = async () => {
    const previous = cursorStack[cursorStack.length - 1] ?? null;
    setCursorStack((stack) => stack.slice(0, -1));
    setCurrentCursor(previous);
    await loadLeadsPage(previous);
  };

  // Asesores de la empresa (para el filtro por asesor)
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [lists, setLists] = useState<LeadList[]>([]);
  const [selectedListId, setSelectedListId] = useState('all');
  const [showImport, setShowImport] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [showSmartList, setShowSmartList] = useState(false);
  const [showNewLeadModal, setShowNewLeadModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [pendingTransfersCount, setPendingTransfersCount] = useState(0);

  const refreshPendingTransfers = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    try {
      const pending = await listLeadTransferRequests(companyId, 'pending');
      setPendingTransfersCount(pending.length);
    } catch {
      // ignore
    }
  }, [companyId, isAdmin]);

  useEffect(() => {
    refreshPendingTransfers();
    if (!companyId || !isAdmin) return;
    const q = query(
      collection(db, 'companies', companyId, 'leadTransferRequests'),
      where('status', '==', 'pending')
    );
    const unsub = onSnapshot(
      q,
      (snap) => setPendingTransfersCount(snap.size),
      () => {}
    );
    return () => unsub();
  }, [refreshPendingTransfers, companyId, isAdmin]);

  const handleLeadCreated = async (newLeadId: string) => {
    await loadLeadsPage(null);
    setSelectedId(newLeadId);
  };
  useEffect(() => {
    if (!companyId) return;
    listAdvisors(companyId)
      .then(setAdvisors)
      .catch((err) => console.error('[LeadsPage] error cargando asesores:', err));
  }, [companyId]);

  const refreshLists = async () => {
    if (!companyId) return [];
    const nextLists = await listLeadLists(companyId);
    setLists(nextLists);
    return nextLists;
  };

  useEffect(() => {
    refreshLists().catch((listError) => console.error('[LeadsPage] error cargando listas:', listError));
  }, [companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Etiquetas únicas presentes en los leads (para el filtro por etiqueta)
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const l of visibleLeads) for (const t of l.tags ?? []) if (t.trim()) set.add(t.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [visibleLeads]);

  // Números (inboxes) presentes en los leads (para el filtro por número)
  const inboxes = useMemo(() => collectInboxes(visibleLeads), [visibleLeads]);

  const metrics = useMemo(() => [
    { label: 'Total', value: visibleLeads.length, icon: UsersRound, tone: 'text-zinc-300' },
    { label: 'Nuevos', value: visibleLeads.filter((lead) => lead.status === 'new').length, icon: UserRoundCheck, tone: 'text-sky-400' },
    { label: 'Agendados', value: visibleLeads.filter((lead) => lead.status === 'scheduled').length, icon: CalendarCheck, tone: 'text-amber-400' },
    { label: 'Con IA activa', value: visibleLeads.filter((lead) => lead.aiEnabled).length, icon: Bot, tone: 'text-violet-400' },
  ], [visibleLeads]);

  const currentListFilters: LeadListFilters = {
    status: filters.status,
    aiEnabled: filters.aiEnabled,
    assignedTo: filters.assignedTo,
    tags: filters.tags,
    inboxId: filters.inboxId,
  };

  const selectList = (list: LeadList | null) => {
    setSelectedListId(list?.id ?? 'all');
    setSelectedId(null);
    if (!list) {
      setFilters({ ...EMPTY_FILTERS });
    } else if (list.kind === 'import') {
      setFilters({ ...EMPTY_FILTERS, listId: list.id });
    } else {
      setFilters({ ...EMPTY_FILTERS, ...(list.filters ?? {}), listId: 'all' });
    }
  };

  const createSmartList = async (name: string) => {
    if (!companyId) return;
    const listId = await createLeadList(companyId, name, 'smart', currentListFilters);
    const nextLists = await refreshLists();
    const created = nextLists.find((list) => list.id === listId);
    if (created) selectList(created);
    setShowSmartList(false);
  };

  const removeList = async (list: LeadList) => {
    if (!companyId || !window.confirm(`¿Eliminar la lista “${list.name}”? Los contactos no se eliminarán.`)) return;
    await deleteLeadList(companyId, list.id);
    if (selectedListId === list.id) selectList(null);
    await refreshLists();
  };

  const completeImport = async (listId: string) => {
    setShowImport(false);
    const nextLists = await refreshLists();
    const imported = nextLists.find((list) => list.id === listId);
    if (imported) selectList(imported);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Leads</h1>
          {!loading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              Gestiona contactos, asignaciones y seguimiento comercial
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && companyId && (
            <button
              onClick={() => setShowTransferModal(true)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors font-medium flex items-center gap-1.5 cursor-pointer ${
                pendingTransfersCount > 0
                  ? 'border-amber-500 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 shadow-sm'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <ArrowRightLeft size={14} className={pendingTransfersCount > 0 ? 'text-amber-400' : 'text-zinc-400'} />
              <span>Solicitudes de Traslado</span>
              {pendingTransfersCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-bold text-[10px] shadow-sm animate-pulse">
                  {pendingTransfersCount}
                </span>
              )}
            </button>
          )}
          {companyId && (
            <button
              onClick={() => setShowNewLeadModal(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors font-medium flex items-center gap-1.5"
            >
              <UserPlus size={14} /> + Nuevo Prospecto
            </button>
          )}
          {isAdmin && companyId && (
            <button
              onClick={() => setExportOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg border border-emerald-700/60 bg-emerald-900/30 text-emerald-300 hover:bg-emerald-900/50 transition-colors font-medium"
            >
              📥 Exportar Excel (.xlsx)
            </button>
          )}
        </div>
      </div>

      {/* Banner de aviso rápido para Administradores si hay solicitudes de traslado pendientes */}
      {isAdmin && pendingTransfersCount > 0 && (
        <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-500/30 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-amber-200">
            <ArrowRightLeft size={15} className="text-amber-400 shrink-0" />
            <span>
              Tienes <strong>{pendingTransfersCount} solicitud{pendingTransfersCount === 1 ? '' : 'es'} de traslado</strong> pendiente{pendingTransfersCount === 1 ? '' : 's'} de revisión por parte de tus asesores.
            </span>
          </div>
          <button
            onClick={() => setShowTransferModal(true)}
            className="text-xs font-bold px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors cursor-pointer"
          >
            Revisar y Aprobar / Rechazar
          </button>
        </div>
      )}

      {isAdmin && companyId && (
        <TransferRequestsModal
          isOpen={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          companyId={companyId}
          onResolved={() => {
            refreshPendingTransfers();
            loadLeadsPage(null);
          }}
        />
      )}

      {companyId && (
        <NewLeadModal
          isOpen={showNewLeadModal}
          onClose={() => setShowNewLeadModal(false)}
          companyId={companyId}
          advisors={advisors}
          onCreated={handleLeadCreated}
        />
      )}

      {companyId && (
        <ExportLeadsModal
          isOpen={exportOpen}
          onClose={() => setExportOpen(false)}
          companyId={companyId}
        />
      )}

      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 border-b border-zinc-800 bg-zinc-900/30">
          {metrics.map(({ label, value, icon: Icon, tone }, index) => (
            <div
              key={label}
              className={`flex items-center gap-3 px-5 py-3 ${index > 0 ? 'border-l border-zinc-800' : ''}`}
            >
              <Icon size={17} className={tone} />
              <div>
                <p className="text-base font-semibold leading-none text-zinc-100">{value}</p>
                <p className="mt-1 text-[11px] text-zinc-500">{label}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <LeadListsBar
          lists={lists}
          selectedId={selectedListId}
          total={visibleLeads.length}
          countForList={(list) => list.kind === 'import'
            ? visibleLeads.filter((lead) => lead.listIds?.includes(list.id)).length
            : visibleLeads.filter((lead) => list.filters ? matchesSmartList(lead, list.filters) : true).length}
          onSelect={selectList}
          onImport={() => setShowImport(true)}
          onHistory={() => setShowImportHistory(true)}
          onCreate={() => setShowSmartList(true)}
          onDelete={removeList}
          canImport={isAdmin}
        />
      )}

      {/* Filters */}
      <LeadFilters
        filters={filters}
        total={visibleLeads.length}
        filtered={filtered.length}
        advisors={advisors}
        allTags={allTags}
        inboxes={inboxes}
        canFilterByAdvisor={isAdmin}
        onChange={(f) => setFilters((prev) => ({ ...prev, ...f }))}
      />

      {/* Content */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Spinner />
        </div>
      ) : error ? (
        <div className="flex justify-center p-12">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      ) : (
        <>
          {/* Escritorio: tabla completa. Móvil: tarjetas apiladas (sin scroll horizontal). */}
          <div className="hidden flex-1 overflow-hidden md:flex">
            <LeadTable
              leads={filtered}
              selectedId={selectedId}
              sortField={sortField}
              sortDir={sortDir}
              onSort={toggleSort}
              onSelect={setSelectedId}
              advisors={advisors}
            />
          </div>
          <div className="flex flex-1 overflow-hidden md:hidden">
            <LeadCardList
              leads={filtered}
              selectedId={selectedId}
              advisors={advisors}
              onSelect={setSelectedId}
            />
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
            <span>Mostrando {filtered.length} leads de esta pagina</span>
            <div className="flex gap-2">
              <button
                onClick={goPrevPage}
                disabled={cursorStack.length === 0 || loading}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={goNextPage}
                disabled={!hasMore || !nextCursor || loading}
                className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          </div>
        </>
      )}

      {/* Drawer */}
      {selected && (
        <LeadDrawer
          lead={selected}
          companyId={companyId ?? ''}
          allTags={allTags}
          advisors={advisors}
          onClose={() => setSelectedId(null)}
        />
      )}


      {showImport && companyId && (
        <ImportContactsModal
          companyId={companyId}
          existingTags={allTags}
          onClose={() => setShowImport(false)}
          onComplete={completeImport}
        />
      )}

      {showImportHistory && (
        <ImportHistoryModal
          lists={lists}
          onClose={() => setShowImportHistory(false)}
        />
      )}

      {showSmartList && (
        <SmartListModal
          filters={currentListFilters}
          onClose={() => setShowSmartList(false)}
          onCreate={createSmartList}
        />
      )}
    </div>
  );
}
