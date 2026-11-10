import { AlertCircle, AlertTriangle, Clock, FileText, Calendar, CheckCircle2 } from 'lucide-react';
import type { CommercialKPIs } from '../types/commercial.types';

interface CommercialKPIsBarProps {
  kpis: CommercialKPIs;
  activeFilter: 'all' | 'urgent' | 'today' | 'missing' | 'upcoming' | 'completed' | 'cancelled' | 'closed' | 'missing_followup';
  onSelectFilter: (filter: 'all' | 'urgent' | 'today' | 'missing' | 'upcoming' | 'completed' | 'cancelled' | 'closed' | 'missing_followup') => void;
}

export function CommercialKPIsBar({ kpis, activeFilter, onSelectFilter }: CommercialKPIsBarProps) {
  const cards = [
    {
      id: 'missing_followup' as const,
      label: 'Falta Seguimiento',
      count: kpis.missingFollowUpCount || 0,
      icon: AlertCircle,
      iconColor: 'text-rose-400',
      iconBg: 'bg-rose-500/15 border-rose-500/30',
      border: 'border-rose-500/40 hover:border-rose-400',
      activeBg: 'bg-rose-500/25 border-rose-500 text-rose-200',
      badge: 'bg-rose-500/25 text-rose-200 font-extrabold ring-1 ring-rose-500/40',
      sub: 'Captados semana sin gestión',
    },
    {
      id: 'urgent' as const,
      label: 'Vencidos / Urgentes',
      count: kpis.overdueCount,
      icon: AlertTriangle,
      iconColor: 'text-rose-400',
      iconBg: 'bg-rose-500/15 border-rose-500/30',
      border: 'border-rose-500/30 hover:border-rose-400',
      activeBg: 'bg-rose-500/20 border-rose-500 text-rose-200',
      badge: 'bg-rose-500/20 text-rose-300',
      sub: 'Atención inmediata',
    },
    {
      id: 'today' as const,
      label: 'Pendientes Hoy',
      count: kpis.todayCount,
      icon: Clock,
      iconColor: 'text-amber-400',
      iconBg: 'bg-amber-500/15 border-amber-500/30',
      border: 'border-amber-500/30 hover:border-amber-400',
      activeBg: 'bg-amber-500/20 border-amber-500 text-amber-200',
      badge: 'bg-amber-500/20 text-amber-300',
      sub: 'Agenda de hoy',
    },
    {
      id: 'missing' as const,
      label: 'Sin Ficha Técnica',
      count: kpis.missingFichaCount,
      icon: FileText,
      iconColor: 'text-sky-400',
      iconBg: 'bg-sky-500/15 border-sky-500/30',
      border: 'border-sky-500/30 hover:border-sky-400',
      activeBg: 'bg-sky-500/20 border-sky-500 text-sky-200',
      badge: 'bg-sky-500/20 text-sky-300',
      sub: 'Falta registrar',
    },
    {
      id: 'upcoming' as const,
      label: 'Próximos Días',
      count: kpis.upcomingCount,
      icon: Calendar,
      iconColor: 'text-indigo-400',
      iconBg: 'bg-indigo-500/15 border-indigo-500/30',
      border: 'border-indigo-500/30 hover:border-indigo-400',
      activeBg: 'bg-indigo-500/20 border-indigo-500 text-indigo-200',
      badge: 'bg-indigo-500/20 text-indigo-300',
      sub: 'Agenda a futuro',
    },
    {
      id: 'completed' as const,
      label: 'Gestionados Este Mes',
      count: kpis.completedThisMonthCount,
      icon: CheckCircle2,
      iconColor: 'text-emerald-400',
      iconBg: 'bg-emerald-500/15 border-emerald-500/30',
      border: 'border-emerald-500/30 hover:border-emerald-400',
      activeBg: 'bg-emerald-500/20 border-emerald-500 text-emerald-200',
      badge: 'bg-emerald-500/20 text-emerald-300',
      sub: 'Mes en curso',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
      {cards.map((c) => {
        const isActive = activeFilter === c.id;
        const IconComponent = c.icon;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectFilter(isActive ? 'all' : c.id)}
            className={`p-3 sm:p-3.5 rounded-2xl border transition-all text-left flex flex-col justify-between cursor-pointer ${
              isActive
                ? `${c.activeBg} shadow-lg shadow-black/40 ring-2 ring-rose-500/40`
                : `bg-zinc-900/60 ${c.border} text-zinc-300 hover:bg-zinc-800/60`
            }`}
          >
            <div className="flex items-center justify-between gap-1 mb-2">
              <span className={`p-2 rounded-xl border ${c.iconBg} ${c.iconColor}`}>
                <IconComponent size={16} />
              </span>
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
                {c.count}
              </span>
            </div>
            <div>
              <p className="text-xs font-semibold leading-tight">{c.label}</p>
              <p className="text-[10px] text-zinc-500 mt-0.5 font-medium">{c.sub}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
