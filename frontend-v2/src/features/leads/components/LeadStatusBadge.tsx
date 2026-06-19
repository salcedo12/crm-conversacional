import type { LeadStatus } from '@/features/inbox/types';

interface LeadStatusBadgeProps {
  status: LeadStatus;
  size?:  'sm' | 'md';
}

const config: Record<LeadStatus, { label: string; classes: string }> = {
  new:       { label: 'Nuevo',      classes: 'bg-blue-500/20   text-blue-300   border-blue-500/20'   },
  active:    { label: 'Activo',     classes: 'bg-green-500/20  text-green-300  border-green-500/20'  },
  qualified: { label: 'Calificado', classes: 'bg-violet-500/20 text-violet-300 border-violet-500/20' },
  scheduled: { label: 'Agendado',   classes: 'bg-amber-500/20  text-amber-300  border-amber-500/20'  },
  lost:      { label: 'Perdido',    classes: 'bg-red-500/20    text-red-300    border-red-500/20'    },
  closed:    { label: 'Cerrado',    classes: 'bg-zinc-500/20   text-zinc-400   border-zinc-600/20'   },
};

export function LeadStatusBadge({ status, size = 'sm' }: LeadStatusBadgeProps) {
  const { label, classes } = config[status] ?? config.active;
  return (
    <span
      className={`
        inline-flex items-center rounded-full border font-medium
        ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}
        ${classes}
      `}
    >
      {label}
    </span>
  );
}
