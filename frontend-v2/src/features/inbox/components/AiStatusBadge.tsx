interface AiStatusBadgeProps {
  aiEnabled: boolean;
  className?: string;
}

export function AiStatusBadge({ aiEnabled, className = '' }: AiStatusBadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
        ${aiEnabled
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
          : 'bg-zinc-700/50    text-zinc-400   border border-zinc-600/30'
        }
        ${className}
      `}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${aiEnabled ? 'bg-violet-400 animate-pulse' : 'bg-zinc-500'}`}
      />
      {aiEnabled ? 'IA activa' : 'Modo manual'}
    </span>
  );
}
