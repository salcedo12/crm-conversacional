import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth }         from '@/features/auth/hooks/useAuth';
import { Spinner }         from '@/shared/components/Spinner';
import { LeadFilters }     from '../components/LeadFilters';
import { LeadTable }       from '../components/LeadTable';
import { LeadDrawer }      from '../components/LeadDrawer';
import { useLeadsPage, type LeadsFilters } from '../hooks/useLeadsPage';
import { listAdvisors, type Advisor } from '../services/advisors.service';
import { collectInboxes }  from '@/features/inbox/utils/inboxes';
import { Bot, CalendarCheck, UserRoundCheck, UsersRound } from 'lucide-react';
import { ImportContactsModal } from '../components/ImportContactsModal';
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
  const { companyId, role }  = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<LeadsPageCursor | null>(null);
  const [cursorStack, setCursorStack] = useState<(LeadsPageCursor | null)[]>([]);
  const [currentCursor, setCurrentCursor] = useState<LeadsPageCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const {
    filters,    setFilters,
    sortField,  sortDir,    toggleSort,
    filtered,
    selected,   selectedId, setSelectedId,
  } = useLeadsPage(leads);

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
    for (const l of leads) for (const t of l.tags ?? []) if (t.trim()) set.add(t.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [leads]);

  // Números (inboxes) presentes en los leads (para el filtro por número)
  const inboxes = useMemo(() => collectInboxes(leads), [leads]);

  const metrics = useMemo(() => [
    { label: 'Total', value: leads.length, icon: UsersRound, tone: 'text-zinc-300' },
    { label: 'Nuevos', value: leads.filter((lead) => lead.status === 'new').length, icon: UserRoundCheck, tone: 'text-sky-400' },
    { label: 'Agendados', value: leads.filter((lead) => lead.status === 'scheduled').length, icon: CalendarCheck, tone: 'text-amber-400' },
    { label: 'Con IA activa', value: leads.filter((lead) => lead.aiEnabled).length, icon: Bot, tone: 'text-violet-400' },
  ], [leads]);

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
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Leads</h1>
          {!loading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              Gestiona contactos, asignaciones y seguimiento comercial
            </p>
          )}
        </div>
      </div>

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
          total={leads.length}
          countForList={(list) => list.kind === 'import'
            ? leads.filter((lead) => lead.listIds?.includes(list.id)).length
            : leads.filter((lead) => list.filters ? matchesSmartList(lead, list.filters) : true).length}
          onSelect={selectList}
          onImport={() => setShowImport(true)}
          onHistory={() => setShowImportHistory(true)}
          onCreate={() => setShowSmartList(true)}
          onDelete={removeList}
          canImport={isAdminRole(role)}
        />
      )}

      {/* Filters */}
      <LeadFilters
        filters={filters}
        total={leads.length}
        filtered={filtered.length}
        advisors={advisors}
        allTags={allTags}
        inboxes={inboxes}
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
          <LeadTable
            leads={filtered}
            selectedId={selectedId}
            sortField={sortField}
            sortDir={sortDir}
            onSort={toggleSort}
            onSelect={setSelectedId}
            advisors={advisors}
          />
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
