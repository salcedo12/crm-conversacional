import type { LeadTemperature } from '@/features/inbox/types';

const TEMP_COLOR: Record<LeadTemperature, { ring: string; text: string }> = {
  hot:  { ring: '#10b981', text: 'text-emerald-300' },
  warm: { ring: '#f59e0b', text: 'text-amber-300' },
  cold: { ring: '#38bdf8', text: 'text-sky-300' },
};

interface LeadScoreBadgeProps {
  score?:       number;
  temperature?: LeadTemperature;
  size?:        'sm' | 'md';
}

/** Mini medidor de score (0-100) coloreado por temperatura. "—" si no se ha analizado. */
export function LeadScoreBadge({ score, temperature, size = 'sm' }: LeadScoreBadgeProps) {
  if (score === undefined || score === null) {
    return <span className="text-xs text-zinc-600">—</span>;
  }

  const color = TEMP_COLOR[temperature ?? 'warm'];
  const dim = size === 'md' ? 30 : 24;
  const stroke = size === 'md' ? 3 : 2.5;
  const r = (dim - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;

  return (
    <span className="inline-flex items-center gap-1.5" title={`Score IA: ${score}/100`}>
      <span className="relative inline-block" style={{ width: dim, height: dim }}>
        <svg viewBox={`0 0 ${dim} ${dim}`} className="-rotate-90" style={{ width: dim, height: dim }}>
          <circle cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke="#3f3f46" strokeWidth={stroke} />
          <circle
            cx={dim / 2} cy={dim / 2} r={r} fill="none" stroke={color.ring}
            strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          />
        </svg>
      </span>
      <span className={`text-xs font-semibold tabular-nums ${color.text}`}>{score}</span>
    </span>
  );
}
