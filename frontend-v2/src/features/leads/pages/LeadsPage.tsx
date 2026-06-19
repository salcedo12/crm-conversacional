import { useAuth }         from '@/features/auth/hooks/useAuth';
import { Spinner }         from '@/shared/components/Spinner';
import { useLeads }        from '@/features/inbox/hooks/useLeads';
import { LeadFilters }     from '../components/LeadFilters';
import { LeadTable }       from '../components/LeadTable';
import { LeadDrawer }      from '../components/LeadDrawer';
import { useLeadsPage }    from '../hooks/useLeadsPage';

export function LeadsPage() {
  const { companyId }  = useAuth();
  const { leads, loading, error } = useLeads(companyId);

  const {
    filters,    setFilters,
    sortField,  sortDir,    toggleSort,
    filtered,
    selected,   selectedId, setSelectedId,
  } = useLeadsPage(leads);

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
        <div>
          <h1 className="text-base font-semibold text-zinc-100">Leads</h1>
          {!loading && (
            <p className="text-xs text-zinc-500 mt-0.5">
              {leads.length} leads en total
            </p>
          )}
        </div>
      </div>

      {/* Filters */}
      <LeadFilters
        filters={filters}
        total={leads.length}
        filtered={filtered.length}
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
        <LeadTable
          leads={filtered}
          selectedId={selectedId}
          sortField={sortField}
          sortDir={sortDir}
          onSort={toggleSort}
          onSelect={setSelectedId}
        />
      )}

      {/* Drawer */}
      {selected && (
        <LeadDrawer
          lead={selected}
          companyId={companyId ?? ''}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
