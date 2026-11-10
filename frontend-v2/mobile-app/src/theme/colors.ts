export interface MerakiThemePalette {
  mode: 'dark' | 'light';
  isDark: boolean;

  // Superficies principales (equivalentes exactos a index.css)
  bgBody: string;          // #0d0d0f dark | #f8f9fa light
  bgCanvas: string;        // bg-zinc-950: #09090b dark | #ffffff light
  bgCanvasTranslucent: string; // bg-zinc-950/95
  bgCard: string;          // bg-zinc-900: #18181b dark | #ffffff light
  bgSurface: string;       // alias bgCard
  bgCardSoft: string;      // bg-zinc-900/40..70
  bgElevated: string;      // bg-zinc-800: #27272a dark | #f1f3f5 light
  bgSubtle: string;        // bg-zinc-700: #3f3f46 dark | #e2e8f0 light
  bgHover: string;         // hover:bg-zinc-800: #27272a dark | #e9ecef light
  bgInput: string;         // input bg: #27272a dark | #ffffff light

  // Navegación y Drawers Meraki (Champagne en Modo Claro)
  bgDrawer: string;        // aside / LeadDrawer: #18181b dark | #FAF5EA light
  bgDrawerHeader: string;  // #09090b dark | rgba(183, 135, 28, 0.10) light
  bgBottomBar: string;     // nav.fixed.bottom-0: rgba(9,9,11,0.96) dark | #FAF5EA light
  bgNav: string;           // alias bgBottomBar
  borderDrawer: string;    // #27272a dark | #E8DCB8 light
  borderBottomBar: string; // #27272a dark | #E8DCB8 light
  borderNav: string;       // alias borderBottomBar
  navActiveText: string;   // #CBA95C dark | #855C0E light
  navInactiveText: string; // #71717a dark | #64748b light

  // Bordes generales
  border: string;          // border-zinc-800: #27272a dark | #e2e8f0 light
  borderStrong: string;    // border-zinc-700: #3f3f46 dark | #cbd5e1 light
  borderInput: string;     // #3f3f46 dark | #cbd5e1 light

  // Tipografía jerárquica Meraki
  textPrimary: string;     // text-zinc-100/200/white: #f4f4f5 dark | #0D060A light
  textSecondary: string;   // text-zinc-300: #d4d4d8 dark | #373634 light
  textMuted: string;       // text-zinc-400: #a1a1aa dark | #4b5563 light
  textSubtle: string;      // text-zinc-500/600: #71717a dark | #64748b light
  placeholder: string;     // #71717a dark | #94a3b8 light
  textPlaceholder: string; // alias placeholder

  // Marca Corporativa Meraki (Oro #B7871C)
  brand: string;           // #B7871C
  brandHover: string;      // #C09537
  brandDark: string;       // #947018
  brandLight: string;      // #D9B545
  brandSoft: string;       // rgba(183, 135, 28, 0.16) dark | rgba(183, 135, 28, 0.12) light
  brandBg: string;         // alias brandSoft
  brandBorder: string;     // rgba(183, 135, 28, 0.38)
  brandText: string;       // #CBA95C dark | #947018 light

  // Estados semánticos con contraste WCAG AAA en claro y oscuro
  emerald: string;         // #10b981 dark | #16a34a light
  emeraldText: string;     // #34d399 dark | #166534 light
  emeraldBg: string;       // rgba(16, 185, 129, 0.15) dark | #f0fdf4 light
  emeraldBorder: string;   // rgba(16, 185, 129, 0.30) dark | #bbf7d0 light

  amber: string;           // #f59e0b dark | #B7871C light
  amberText: string;       // #fcd34d dark | #947018 light
  amberBg: string;         // rgba(245, 158, 11, 0.15) dark | rgba(183, 135, 28, 0.12) light
  amberBorder: string;     // rgba(245, 158, 11, 0.30) dark | rgba(183, 135, 28, 0.30) light

  rose: string;            // #ef4444 dark | #dc2626 light
  roseText: string;        // #fda4af dark | #b91c1c light
  roseBg: string;          // rgba(244, 63, 94, 0.15) dark | rgba(239, 68, 68, 0.12) light
  roseBorder: string;      // rgba(244, 63, 94, 0.30) dark | rgba(239, 68, 68, 0.30) light

  sky: string;             // #38bdf8 dark | #0284c7 light
  skyText: string;         // #7dd3fc dark | #0369a1 light
  skyBg: string;           // rgba(14, 165, 233, 0.15) dark | rgba(14, 165, 233, 0.12) light
  skyBorder: string;       // rgba(14, 165, 233, 0.30) dark | rgba(14, 165, 233, 0.30) light

  // Burbujas de Chat
  inboundBubbleBg: string;
  inboundBubbleBorder: string;
  inboundBubbleText: string;
  outboundAiBg: string;
  outboundAiBorder: string;
  outboundAdvisorBg: string;
  outboundAdvisorBorder: string;
  backdrop: string;
}

export const MERAKI_CORPORATE = {
  goldPrimary: '#B7871C',
  goldWarm: '#B49739',
  goldDark: '#947018',
  goldLight: '#D9B545',
  charcoal: '#373634',
  black: '#0D060A',
} as const;

export const darkPalette: MerakiThemePalette = {
  mode: 'dark',
  isDark: true,
  bgBody: '#0d0d0f',
  bgCanvas: '#09090b',
  bgCanvasTranslucent: 'rgba(9, 9, 11, 0.95)',
  bgCard: '#18181b',
  bgSurface: '#18181b',
  bgCardSoft: 'rgba(24, 24, 27, 0.55)',
  bgElevated: '#27272a',
  bgSubtle: '#3f3f46',
  bgHover: '#27272a',
  bgInput: '#27272a',

  bgDrawer: '#18181b',
  bgDrawerHeader: '#09090b',
  bgBottomBar: 'rgba(9, 9, 11, 0.96)',
  bgNav: 'rgba(9, 9, 11, 0.96)',
  borderDrawer: '#27272a',
  borderBottomBar: '#27272a',
  borderNav: '#27272a',
  navActiveText: '#CBA95C',
  navInactiveText: '#71717a',

  border: '#27272a',
  borderStrong: '#3f3f46',
  borderInput: '#3f3f46',

  textPrimary: '#f4f4f5',
  textSecondary: '#d4d4d8',
  textMuted: '#a1a1aa',
  textSubtle: '#71717a',
  placeholder: '#71717a',
  textPlaceholder: '#71717a',

  brand: '#B7871C',
  brandHover: '#C09537',
  brandDark: '#947018',
  brandLight: '#D9B545',
  brandSoft: 'rgba(183, 135, 28, 0.16)',
  brandBg: 'rgba(183, 135, 28, 0.16)',
  brandBorder: 'rgba(183, 135, 28, 0.38)',
  brandText: '#CBA95C',

  emerald: '#10b981',
  emeraldText: '#34d399',
  emeraldBg: 'rgba(16, 185, 129, 0.15)',
  emeraldBorder: 'rgba(16, 185, 129, 0.28)',

  amber: '#f59e0b',
  amberText: '#fcd34d',
  amberBg: 'rgba(245, 158, 11, 0.15)',
  amberBorder: 'rgba(245, 158, 11, 0.30)',

  rose: '#ef4444',
  roseText: '#fda4af',
  roseBg: 'rgba(244, 63, 94, 0.15)',
  roseBorder: 'rgba(244, 63, 94, 0.30)',

  sky: '#38bdf8',
  skyText: '#7dd3fc',
  skyBg: 'rgba(14, 165, 233, 0.15)',
  skyBorder: 'rgba(14, 165, 233, 0.30)',

  inboundBubbleBg: '#3f3f46',
  inboundBubbleBorder: '#52525b',
  inboundBubbleText: '#f4f4f5',
  outboundAiBg: '#121f38',
  outboundAiBorder: 'rgba(59, 130, 246, 0.25)',
  outboundAdvisorBg: '#121f38',
  outboundAdvisorBorder: 'rgba(59, 130, 246, 0.28)',
  backdrop: 'rgba(0, 0, 0, 0.65)',
};

export const lightPalette: MerakiThemePalette = {
  mode: 'light',
  isDark: false,
  bgBody: '#f8f9fa',
  bgCanvas: '#ffffff',
  bgCanvasTranslucent: 'rgba(255, 255, 255, 0.96)',
  bgCard: '#ffffff',
  bgSurface: '#ffffff',
  bgCardSoft: '#ffffff',
  bgElevated: '#f1f3f5',
  bgSubtle: '#e2e8f0',
  bgHover: '#e9ecef',
  bgInput: '#ffffff',

  bgDrawer: '#FAF5EA',
  bgDrawerHeader: 'rgba(183, 135, 28, 0.10)',
  bgBottomBar: '#FAF5EA',
  bgNav: '#FAF5EA',
  borderDrawer: '#E8DCB8',
  borderBottomBar: '#E8DCB8',
  borderNav: '#E8DCB8',
  navActiveText: '#855C0E',
  navInactiveText: '#64748b',

  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  borderInput: '#cbd5e1',

  textPrimary: '#0D060A',
  textSecondary: '#373634',
  textMuted: '#4b5563',
  textSubtle: '#64748b',
  placeholder: '#94a3b8',
  textPlaceholder: '#94a3b8',

  brand: '#B7871C',
  brandHover: '#947018',
  brandDark: '#947018',
  brandLight: '#D9B545',
  brandSoft: 'rgba(183, 135, 28, 0.12)',
  brandBg: 'rgba(183, 135, 28, 0.12)',
  brandBorder: 'rgba(183, 135, 28, 0.38)',
  brandText: '#947018',

  emerald: '#16a34a',
  emeraldText: '#166534',
  emeraldBg: '#f0fdf4',
  emeraldBorder: '#bbf7d0',

  amber: '#B7871C',
  amberText: '#947018',
  amberBg: 'rgba(183, 135, 28, 0.12)',
  amberBorder: 'rgba(183, 135, 28, 0.30)',

  rose: '#dc2626',
  roseText: '#b91c1c',
  roseBg: 'rgba(239, 68, 68, 0.12)',
  roseBorder: 'rgba(239, 68, 68, 0.30)',

  sky: '#0284c7',
  skyText: '#0369a1',
  skyBg: 'rgba(14, 165, 233, 0.12)',
  skyBorder: 'rgba(14, 165, 233, 0.30)',

  inboundBubbleBg: '#ffffff',
  inboundBubbleBorder: '#e2e8f0',
  inboundBubbleText: '#0D060A',
  outboundAiBg: 'rgba(183, 135, 28, 0.14)',
  outboundAiBorder: 'rgba(183, 135, 28, 0.35)',
  outboundAdvisorBg: 'rgba(14, 165, 233, 0.13)',
  outboundAdvisorBorder: 'rgba(14, 165, 233, 0.32)',
  backdrop: 'rgba(13, 6, 10, 0.45)',
};

/** Compatibilidad estática con archivos existentes mientras usan useTheme() */
export const colors = {
  background: '#09090b',
  surface: '#18181b',
  raised: '#18181b',
  subtle: '#27272a',
  border: '#27272a',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  faint: '#71717a',
  brand: '#B7871C',
  brandDark: 'rgba(183, 135, 28, 0.16)',
  brandBorder: 'rgba(183, 135, 28, 0.38)',
  emerald: '#10b981',
  emeraldDark: 'rgba(16, 185, 129, 0.15)',
  cyan: '#06b6d4',
  sky: '#38bdf8',
  amber: '#B7871C',
  red: '#ef4444',
  violet: '#B7871C',
  white: '#FFFFFF',
} as const;
