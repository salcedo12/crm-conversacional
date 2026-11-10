import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { isUnread, shortTime } from '../utils/format';
import { formatPhone } from '../utils/formatPhone';
import type { Lead } from '../types';

export interface ManualTakeoverSlaInfo {
  isManual: boolean;
  status: 'compliant' | 'pending' | 'overdue';
  hoursLeft: number;
  minsLeft: number;
  label: string;
  badgeLabel: string;
  deadlineMillis: number;
  isOverdue: boolean;
  isCompliant: boolean;
}

function toMillisSafe(ts: any): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'object' && ('_seconds' in ts || 'seconds' in ts)) {
    return (ts._seconds ?? ts.seconds) * 1000;
  }
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function getManualTakeoverSlaInfo(lead: Lead): ManualTakeoverSlaInfo | null {
  if (lead.aiEnabled) return null;

  const rawLead = lead as unknown as Record<string, unknown>;

  // Si fue marcado explícitamente como compliant o exento en base de datos
  if (lead.aiTakeoverSlaStatus === 'compliant' || (rawLead.aiTakeoverSlaStatus === 'exempt')) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
      badgeLabel: '● Modo manual',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  const disabledMillis =
    toMillisSafe(lead.aiDisabledAt) ||
    toMillisSafe(lead.aiPausedAt);

  const lastFollowUpMillis =
    toMillisSafe(lead.lastFollowUpAt) ||
    toMillisSafe(rawLead.lastFichaAt);

  // Requisito estricto: Debe existir seguimiento/ficha técnica previa registrada.
  const hasFollowUp = lastFollowUpMillis > 0;
  const isAfterDisabled = disabledMillis > 0 ? lastFollowUpMillis >= disabledMillis : hasFollowUp;

  if (hasFollowUp && isAfterDisabled) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '✅ Toma manual: Ficha / Seguimiento al día',
      badgeLabel: '✅ Ficha al día',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  // Exención de históricos anteriores a hoy:
  // Si no hubo acción explícita de apagar la IA por un asesor (disabledMillis === 0),
  // o si la toma manual ocurrió antes del lanzamiento de hoy (2026-10-26),
  // queda exento de mora para no penalizar a los asesores.
  const startOfTodayMs = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 0, 0, 0, 0).getTime();

  if (disabledMillis === 0 || disabledMillis < startOfTodayMs) {
    return {
      isManual: true,
      status: 'compliant',
      hoursLeft: 24,
      minsLeft: 0,
      label: '● Modo manual',
      badgeLabel: '● Modo manual',
      deadlineMillis: Number.MAX_SAFE_INTEGER,
      isOverdue: false,
      isCompliant: true,
    };
  }

  const deadlineMillis = disabledMillis + 24 * 3600_000;
  const diffMs = deadlineMillis - Date.now();

  if (diffMs <= 0 || lead.aiTakeoverSlaStatus === 'overdue') {
    return {
      isManual: true,
      status: 'overdue',
      hoursLeft: 0,
      minsLeft: 0,
      label: '🚨 SLA 24h vencido tras apagar IA — Llenar Ficha Técnica ahora',
      badgeLabel: '🚨 SLA 24h vencido',
      deadlineMillis,
      isOverdue: true,
      isCompliant: false,
    };
  }

  const hoursLeft = Math.floor(diffMs / 3600_000);
  const minsLeft = Math.floor((diffMs % 3600_000) / 60_000);

  return {
    isManual: true,
    status: 'pending',
    hoursLeft,
    minsLeft,
    label: `⏳ Toma manual: ${hoursLeft}h ${minsLeft}m restantes para registrar Ficha o Cita`,
    badgeLabel: `⏳ ${hoursLeft}h ${minsLeft}m restantes`,
    deadlineMillis,
    isOverdue: false,
    isCompliant: false,
  };
}

export function parseFollowUpMillis(dateStr?: string | null): number | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const clean =
    dateStr.includes('Z') || /[+-]\d{2}:\d{2}$/.test(dateStr)
      ? dateStr
      : (dateStr.trim().includes('T') ? dateStr.trim() : dateStr.trim().replace(' ', 'T')) +
        '-05:00';
  const ms = Date.parse(clean);
  return Number.isNaN(ms) ? null : ms;
}

function formatFollowUpBadge(ms: number): {
  label: string;
  isOverdue: boolean;
  isToday: boolean;
} {
  const now = new Date();
  const target = new Date(ms);
  const isToday =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  const isOverdue = ms < now.getTime();
  const timeStr = new Intl.DateTimeFormat('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(target);

  if (isOverdue) {
    if (isToday) return { label: `🚨 Vencido hoy ${timeStr}`, isOverdue: true, isToday: true };
    const dateStr = new Intl.DateTimeFormat('es-CO', {
      day: '2-digit',
      month: 'short',
    }).format(target);
    return { label: `🚨 Vencido ${dateStr} ${timeStr}`, isOverdue: true, isToday: false };
  }
  if (isToday) {
    return { label: `⏰ Hoy ${timeStr}`, isOverdue: false, isToday: true };
  }
  const dateStr = new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
  }).format(target);
  return { label: `📅 ${dateStr} ${timeStr}`, isOverdue: false, isToday: false };
}

const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  whatsapp: { icon: '🟢', label: 'WhatsApp' },
  manual: { icon: '✍️', label: 'Manual' },
  web: { icon: '🌐', label: 'Página web' },
  facebook: { icon: '📘', label: 'Facebook' },
  instagram: { icon: '📷', label: 'Instagram' },
  meta_ads: { icon: '📣', label: 'Anuncio' },
  advisor_whatsapp: { icon: '👤', label: 'WhatsApp asesor' },
  google_ads: { icon: '🔍', label: 'Google Ads' },
};

export function sourceLabel(source: string): string {
  return SOURCE_BADGES[source]?.label ?? source;
}

function getSourceBadge(lead: Lead): { icon: string; label: string } | null {
  if (!lead.source) return null;
  if (lead.source === 'meta_ads' && lead.metadata?.metaFormId) {
    return { icon: '📋', label: 'Formulario' };
  }
  const badge = SOURCE_BADGES[lead.source];
  if (badge) return badge;
  return { icon: '🧭', label: lead.source };
}

function getChannelBadge(channel?: Lead['channel']): { icon: string; label: string } | null {
  if (channel === 'messenger') return { icon: '💬', label: 'Messenger' };
  if (channel === 'instagram') return { icon: '📷', label: 'Instagram' };
  return null;
}

function getFlag(phone: string): string {
  if (!phone) return '';
  const p = phone.startsWith('+') ? phone : `+${phone}`;
  if (p.startsWith('+57')) return '🇨🇴';
  if (p.startsWith('+52')) return '🇲🇽';
  if (p.startsWith('+56')) return '🇨🇱';
  if (p.startsWith('+54')) return '🇦🇷';
  if (p.startsWith('+51')) return '🇵🇪';
  if (p.startsWith('+593')) return '🇪🇨';
  if (p.startsWith('+507')) return '🇵🇦';
  if (p.startsWith('+58')) return '🇻🇪';
  if (p.startsWith('+55')) return '🇧🇷';
  if (p.startsWith('+34')) return '🇪🇸';
  if (p.startsWith('+1')) return '🇺🇸';
  return '';
}

export function LeadRow({
  lead,
  userId,
  onPress,
}: {
  lead: Lead;
  userId: string;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const unread = isUnread(lead.lastInboundAt, lead.readBy?.[userId]);
  const displayName = lead.name || formatPhone(lead.phone) || 'Sin nombre';
  const preview = lead.lastMessageText || '—';
  const time = shortTime(lead.lastMessageAt);
  const flag = getFlag(lead.phone);

  const followUpMs = parseFollowUpMillis(lead.nextFollowUpDate);
  const followUp = followUpMs ? formatFollowUpBadge(followUpMs) : null;
  const manualSla = getManualTakeoverSlaInfo(lead);
  const source = getSourceBadge(lead);
  const channel = getChannelBadge(lead.channel);
  const project = (lead.projectInterest && lead.projectInterest[0]) || lead.firstTouch?.project;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderBottomColor: palette.border,
          backgroundColor: pressed
            ? palette.bgElevated
            : unread
            ? palette.isDark
              ? 'rgba(183, 135, 28, 0.08)'
              : 'rgba(183, 135, 28, 0.05)'
            : palette.bgCanvas,
        },
      ]}
    >
      <View style={styles.inner}>
        {/* Fila 1: Bandera + Nombre y Hora */}
        <View style={styles.topRow}>
        <View style={styles.nameWrap}>
          {flag ? <Text style={styles.flag}>{flag}</Text> : null}
          <Text
            numberOfLines={1}
            style={[
              styles.name,
              {
                color: palette.textPrimary,
                fontWeight: unread ? '700' : '500',
              },
            ]}
          >
            {displayName}
          </Text>
        </View>
        {time ? (
          <Text
            style={[
              styles.time,
              {
                color: unread ? palette.brandText : palette.textSubtle,
                fontWeight: unread ? '600' : '400',
              },
            ]}
          >
            {time}
          </Text>
        ) : null}
      </View>

      {/* Fila 2: Punto sin leer + Preview */}
      <View style={styles.previewRow}>
        {unread && <View style={[styles.unreadDot, { backgroundColor: palette.brand }]} />}
        <Text
          numberOfLines={1}
          style={[
            styles.preview,
            {
              color: unread ? (palette.isDark ? '#f4f4f5' : '#18181b') : palette.textMuted,
              fontWeight: unread ? '500' : '400',
            },
          ]}
        >
          {preview}
        </Text>
      </View>

      {/* Fila 3: Chips de Estado IA, SLA 24h, Recordatorio, Fuente, Canal y Proyecto */}
      <View style={styles.badgesWrap}>
        {/* Badge IA activa / Modo manual */}
        <View
          style={[
            styles.pill,
            lead.aiEnabled
              ? {
                  backgroundColor: palette.emeraldBg,
                  borderColor: palette.emeraldBorder,
                }
              : {
                  backgroundColor: palette.bgElevated,
                  borderColor: palette.borderStrong,
                },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: lead.aiEnabled ? palette.emerald : palette.textSubtle,
              },
            ]}
          />
          <Text
            style={[
              styles.pillText,
              {
                color: lead.aiEnabled ? palette.emeraldText : palette.textMuted,
              },
            ]}
          >
            {lead.aiEnabled ? 'IA activa' : 'Modo manual'}
          </Text>
        </View>

        {/* Badge SLA Toma Manual 24h */}
        {manualSla && (
          <View
            style={[
              styles.pill,
              manualSla.isOverdue
                ? {
                    backgroundColor: palette.roseBg,
                    borderColor: palette.roseBorder,
                  }
                : manualSla.isCompliant
                ? {
                    backgroundColor: palette.emeraldBg,
                    borderColor: palette.emeraldBorder,
                  }
                : {
                    backgroundColor: palette.amberBg,
                    borderColor: palette.amberBorder,
                  },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.pillText,
                {
                  maxWidth: 175,
                  color: manualSla.isOverdue
                    ? palette.roseText
                    : manualSla.isCompliant
                    ? palette.emeraldText
                    : palette.amberText,
                },
              ]}
            >
              {manualSla.badgeLabel}
            </Text>
          </View>
        )}

        {/* Badge Seguimiento / Recordatorio */}
        {followUp && (
          <View
            style={[
              styles.pill,
              followUp.isOverdue
                ? {
                    backgroundColor: palette.roseBg,
                    borderColor: palette.roseBorder,
                  }
                : followUp.isToday
                ? {
                    backgroundColor: palette.amberBg,
                    borderColor: palette.amberBorder,
                  }
                : {
                    backgroundColor: palette.bgElevated,
                    borderColor: palette.borderStrong,
                  },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.pillText,
                {
                  maxWidth: 185,
                  color: followUp.isOverdue
                    ? palette.roseText
                    : followUp.isToday
                    ? palette.amberText
                    : palette.textSecondary,
                },
              ]}
            >
              {followUp.label}
              {lead.nextFollowUpAction ? ` · ${lead.nextFollowUpAction}` : ''}
            </Text>
          </View>
        )}

        {/* Badge Fuente */}
        {source && (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: palette.bgElevated,
                borderColor: palette.borderStrong,
              },
            ]}
          >
            <Text style={[styles.pillText, { color: palette.textMuted }]}>
              {source.icon} {source.label}
            </Text>
          </View>
        )}

        {/* Badge Canal */}
        {channel && (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: palette.bgElevated,
                borderColor: palette.borderStrong,
              },
            ]}
          >
            <Text style={[styles.pillText, { color: palette.textMuted }]}>
              {channel.icon} {channel.label}
            </Text>
          </View>
        )}

        {/* Badge Proyecto */}
        {project ? (
          <View
            style={[
              styles.pill,
              {
                backgroundColor: palette.brandBg,
                borderColor: palette.brandBorder,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.pillText, { color: palette.brandText, maxWidth: 130 }]}
            >
              🏡 {project}
            </Text>
          </View>
        ) : null}
      </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inner: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  nameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  flag: {
    fontSize: 14,
    marginRight: 6,
    lineHeight: 18,
  },
  name: {
    flex: 1,
    fontSize: 14.5,
    letterSpacing: -0.2,
  },
  time: {
    fontSize: 11,
    flexShrink: 0,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  unreadDot: {
    width: 6.5,
    height: 6.5,
    borderRadius: 3.25,
    flexShrink: 0,
  },
  preview: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 16,
  },
  badgesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4.5,
    paddingHorizontal: 7.5,
    paddingVertical: 2.5,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  pillText: {
    fontSize: 10.5,
    fontWeight: '500',
  },
});
