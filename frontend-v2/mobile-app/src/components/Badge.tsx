import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

export type BadgeColor = 'green' | 'red' | 'yellow' | 'blue' | 'violet' | 'gray';

export interface BadgeProps {
  label?: string;
  children?: React.ReactNode;
  color?: BadgeColor;
  tone?: string;
  dot?: boolean;
  size?: 'xs' | 'sm';
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, children, color, tone, dot = false, size = 'sm', style }: BadgeProps) {
  const { palette } = useTheme();

  // Resolve color from tone or color prop
  let resolvedColor: BadgeColor = 'gray';
  const raw = (tone || color || 'gray').toLowerCase();
  if (raw === 'green' || raw === 'emerald') resolvedColor = 'green';
  else if (raw === 'red' || raw === 'rose') resolvedColor = 'red';
  else if (raw === 'yellow' || raw === 'amber') resolvedColor = 'yellow';
  else if (raw === 'blue' || raw === 'sky') resolvedColor = 'blue';
  else if (raw === 'violet' || raw === 'brand' || raw === 'gold') resolvedColor = 'violet';
  else resolvedColor = 'gray';

  const token = {
    green: { bg: palette.emeraldBg, border: palette.emeraldBorder, text: palette.emeraldText, dot: palette.emerald },
    red: { bg: palette.roseBg, border: palette.roseBorder, text: palette.roseText, dot: palette.rose },
    yellow: { bg: palette.amberBg, border: palette.amberBorder, text: palette.amberText, dot: palette.amber },
    blue: { bg: palette.skyBg, border: palette.skyBorder, text: palette.skyText, dot: palette.sky },
    violet: { bg: palette.brandSoft, border: palette.brandBorder, text: palette.brandText, dot: palette.brand },
    gray: {
      bg: palette.isDark ? 'rgba(113, 113, 122, 0.15)' : '#f1f5f9',
      border: palette.isDark ? 'rgba(113, 113, 122, 0.25)' : '#cbd5e1',
      text: palette.textMuted,
      dot: palette.textSubtle,
    },
  }[resolvedColor];

  const content = children ?? label ?? '';

  return (
    <View
      style={[
        styles.pill,
        size === 'xs' ? styles.pillXs : styles.pillSm,
        { backgroundColor: token.bg, borderColor: token.border },
        style,
      ]}
    >
      {dot && <View style={[styles.dot, { backgroundColor: token.dot }]} />}
      {typeof content === 'string' || typeof content === 'number' ? (
        <Text style={[size === 'xs' ? styles.textXs : styles.textSm, { color: token.text }]} numberOfLines={1}>
          {content}
        </Text>
      ) : (
        content
      )}
    </View>
  );
}

const STATUS_MAP: Record<string, { label: string; color: BadgeColor }> = {
  new: { label: 'Nuevo', color: 'blue' },
  active: { label: 'Activo', color: 'green' },
  qualified: { label: 'Calificado', color: 'violet' },
  scheduled: { label: 'Agendado', color: 'yellow' },
  lost: { label: 'Perdido', color: 'red' },
  closed: { label: 'Vendido', color: 'green' },
};

export function LeadStatusBadge({ status, size = 'xs' }: { status?: string; size?: 'xs' | 'sm' }) {
  const info = STATUS_MAP[status ?? 'new'] ?? { label: status || 'Nuevo', color: 'gray' };
  return <Badge label={info.label} color={info.color} size={size} dot />;
}

export function LeadScoreBadge({ score }: { score?: number | null }) {
  const { palette } = useTheme();
  if (typeof score !== 'number') return null;
  const color = score >= 66 ? palette.emerald : score >= 33 ? palette.amber : palette.sky;
  const bg = score >= 66 ? palette.emeraldBg : score >= 33 ? palette.amberBg : palette.skyBg;
  return (
    <View style={[styles.scoreCircle, { borderColor: color, backgroundColor: bg }]}>
      <Text style={[styles.scoreText, { color }]}>{Math.round(score)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillSm: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillXs: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  textSm: {
    fontSize: 11,
    fontWeight: '600',
  },
  textXs: {
    fontSize: 10,
    fontWeight: '600',
  },
  scoreCircle: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 5,
    borderRadius: 13,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
