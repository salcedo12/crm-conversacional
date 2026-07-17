import { Globe, Megaphone, MessageCircle, UserRound } from 'lucide-react';
import type { LeadSource } from '@/features/inbox/types';

interface LeadSourceBadgeProps {
  source: LeadSource;
  size?:  'sm' | 'md';
}

const config: Record<LeadSource, { label: string; classes: string; icon: typeof Megaphone }> = {
  whatsapp:  { label: 'WhatsApp',  classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20', icon: MessageCircle },
  meta_ads:  { label: 'Meta Ads',  classes: 'bg-blue-500/20    text-blue-300    border-blue-500/20',    icon: Megaphone     },
  web:       { label: 'Web',       classes: 'bg-sky-500/20     text-sky-300     border-sky-500/20',     icon: Globe         },
  manual:    { label: 'Manual',    classes: 'bg-zinc-500/20    text-zinc-400    border-zinc-600/20',    icon: UserRound     },
  facebook:  { label: 'Facebook',  classes: 'bg-blue-500/20    text-blue-300    border-blue-500/20',    icon: Megaphone     },
  instagram: { label: 'Instagram', classes: 'bg-pink-500/20    text-pink-300    border-pink-500/20',    icon: Megaphone     },
};

export function LeadSourceBadge({ source, size = 'sm' }: LeadSourceBadgeProps) {
  const { label, classes, icon: Icon } = config[source] ?? config.whatsapp;
  return (
    <span
      className={`
        inline-flex items-center gap-1 rounded-full border font-medium
        ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}
        ${classes}
      `}
    >
      <Icon size={size === 'sm' ? 10 : 12} />
      {label}
    </span>
  );
}
