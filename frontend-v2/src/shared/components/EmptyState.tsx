interface EmptyStateProps {
  icon?:    string;
  title:    string;
  subtitle?: string;
}

export function EmptyState({ icon = '📭', title, subtitle }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="text-4xl">{icon}</span>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {subtitle && <p className="text-xs text-zinc-500">{subtitle}</p>}
    </div>
  );
}
