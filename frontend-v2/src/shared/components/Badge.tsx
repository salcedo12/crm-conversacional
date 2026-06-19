interface BadgeProps {
  label:   string;
  color?:  'green' | 'red' | 'yellow' | 'blue' | 'violet' | 'gray';
  dot?:    boolean;
}

const colors = {
  green:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  red:    'bg-red-500/15     text-red-400     border-red-500/20',
  yellow: 'bg-yellow-500/15  text-yellow-400  border-yellow-500/20',
  blue:   'bg-blue-500/15    text-blue-400    border-blue-500/20',
  violet: 'bg-violet-500/15  text-violet-400  border-violet-500/20',
  gray:   'bg-zinc-500/15    text-zinc-400    border-zinc-500/20',
};

const dots = {
  green:  'bg-emerald-400',
  red:    'bg-red-400',
  yellow: 'bg-yellow-400',
  blue:   'bg-blue-400',
  violet: 'bg-violet-400',
  gray:   'bg-zinc-400',
};

export function Badge({ label, color = 'gray', dot = false }: BadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${colors[color]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dots[color]}`} />}
      {label}
    </span>
  );
}
