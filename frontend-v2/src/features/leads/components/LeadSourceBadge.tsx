import {
  Globe,
  Megaphone,
  MessageCircle,
  UserRound,
  UserCog,
  Compass,
  Users,
  Share2,
  Tag,
} from 'lucide-react';
import type { LeadSource } from '@/features/inbox/types';

interface LeadSourceBadgeProps {
  source: LeadSource;
  fuenteUbicacion?: string | null;
  size?: 'sm' | 'md';
}

const config: Record<LeadSource, { label: string; classes: string; icon: typeof Megaphone }> = {
  whatsapp:  { label: 'Línea WhatsApp 317',  classes: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/20', icon: MessageCircle },
  meta_ads:  { label: 'PAUTA WHATSAPP 317',  classes: 'bg-blue-500/20    text-blue-300    border-blue-500/20',    icon: Megaphone     },
  google_ads: { label: 'Google Ads', classes: 'bg-amber-500/20 text-amber-300 border-amber-500/20',     icon: Megaphone     },
  web:       { label: 'Página Web', classes: 'bg-sky-500/20     text-sky-300     border-sky-500/20',     icon: Globe         },
  manual:    { label: 'Trabajo de campo',    classes: 'bg-amber-500/20    text-amber-300    border-amber-600/20',    icon: UserRound     },
  facebook:  { label: 'Redes Sociales',  classes: 'bg-blue-500/20    text-blue-300    border-blue-500/20',    icon: Megaphone     },
  instagram: { label: 'Redes Sociales', classes: 'bg-pink-500/20    text-pink-300    border-pink-500/20',    icon: Megaphone     },
  advisor_whatsapp: { label: 'WhatsApp Asesor', classes: 'bg-amber-500/20 text-amber-300 border-amber-500/20', icon: UserCog },
};

function getFuenteCustomStyle(fuente: string) {
  const f = fuente.toLowerCase();
  if (f.includes('317') || f.includes('pauta')) {
    return { classes: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30', icon: MessageCircle };
  }
  if (f.includes('campo') || f.includes('calle')) {
    return { classes: 'bg-amber-500/15 text-amber-300 border-amber-500/30', icon: UserRound };
  }
  if (f.includes('referid')) {
    return { classes: 'bg-teal-500/15 text-teal-300 border-teal-500/30', icon: Users };
  }
  if (f.includes('redes') || f.includes('facebook') || f.includes('instagram') || f.includes('tiktok')) {
    return { classes: 'bg-purple-500/15 text-purple-300 border-purple-500/30', icon: Share2 };
  }
  if (f.includes('web') || f.includes('pagina')) {
    return { classes: 'bg-sky-500/15 text-sky-300 border-sky-500/30', icon: Globe };
  }
  if (f.includes('feria') || f.includes('corferias') || f.includes('expo') || f.includes('stand')) {
    return { classes: 'bg-orange-500/15 text-orange-300 border-orange-500/30', icon: Compass };
  }
  if (f.includes('marketing') || f.includes('valla')) {
    return { classes: 'bg-blue-500/15 text-blue-300 border-blue-500/30', icon: Megaphone };
  }
  return { classes: 'bg-zinc-800/80 text-zinc-300 border-zinc-700/60', icon: Tag };
}

export function LeadSourceBadge({ source, fuenteUbicacion, size = 'sm' }: LeadSourceBadgeProps) {
  let label = config[source]?.label ?? config.whatsapp.label;
  let classes = config[source]?.classes ?? config.whatsapp.classes;
  let Icon = config[source]?.icon ?? config.whatsapp.icon;

  if (fuenteUbicacion && fuenteUbicacion.trim()) {
    label = fuenteUbicacion.trim();
    const custom = getFuenteCustomStyle(label);
    classes = custom.classes;
    Icon = custom.icon;
  }

  return (
    <span
      title={`Fuente de Ubicación: ${label}`}
      className={`
        inline-flex items-center gap-1 rounded-full border font-medium truncate max-w-[200px]
        ${size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs'}
        ${classes}
      `}
    >
      <Icon size={size === 'sm' ? 10 : 12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}
