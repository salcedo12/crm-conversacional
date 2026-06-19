import { useState, useMemo } from 'react';
import type { Lead, LeadStatus } from '@/features/inbox/types';

export type SortField = 'lastMessageAt' | 'createdAt' | 'name' | 'status';
export type SortDir   = 'asc' | 'desc';

export interface LeadsFilters {
  search:    string;
  status:    LeadStatus | 'all';
  aiEnabled: 'all' | 'active' | 'manual';
}

const DEFAULT_FILTERS: LeadsFilters = {
  search:    '',
  status:    'all',
  aiEnabled: 'all',
};

export function useLeadsPage(leads: Lead[]) {
  const [filters,    setFilters]    = useState<LeadsFilters>(DEFAULT_FILTERS);
  const [sortField,  setSortField]  = useState<SortField>('lastMessageAt');
  const [sortDir,    setSortDir]    = useState<SortDir>('desc');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = [...leads];

    // Búsqueda
    const q = filters.search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (l) =>
          l.name?.toLowerCase().includes(q) ||
          l.phone.includes(q) ||
          l.lastMessageText?.toLowerCase().includes(q) ||
          l.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }

    // Filtro estado
    if (filters.status !== 'all') {
      list = list.filter((l) => l.status === filters.status);
    }

    // Filtro IA
    if (filters.aiEnabled === 'active') {
      list = list.filter((l) => l.aiEnabled);
    } else if (filters.aiEnabled === 'manual') {
      list = list.filter((l) => !l.aiEnabled);
    }

    // Ordenamiento
    list.sort((a, b) => {
      let valA: number | string = 0;
      let valB: number | string = 0;

      if (sortField === 'lastMessageAt') {
        valA = a.lastMessageAt?.toMillis() ?? 0;
        valB = b.lastMessageAt?.toMillis() ?? 0;
      } else if (sortField === 'createdAt') {
        valA = a.createdAt?.toMillis() ?? 0;
        valB = b.createdAt?.toMillis() ?? 0;
      } else if (sortField === 'name') {
        valA = (a.name ?? a.phone).toLowerCase();
        valB = (b.name ?? b.phone).toLowerCase();
      } else if (sortField === 'status') {
        valA = a.status;
        valB = b.status;
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });

    return list;
  }, [leads, filters, sortField, sortDir]);

  const selected = leads.find((l) => l.id === selectedId) ?? null;

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return {
    filters,    setFilters,
    sortField,  sortDir,    toggleSort,
    filtered,
    selected,   selectedId, setSelectedId,
  };
}
