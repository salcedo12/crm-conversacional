import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { isAdminRole, type RootStackParams } from '../types';
import {
  cancelAppointment,
  completeLeadFollowUp,
  createCalendarEvent,
  deleteCalendarEvent,
  listAdvisors,
  listCalendarEvents,
  sendMorningAgendaSummaryNow,
  type Advisor,
  type CalendarEvent,
} from '../services/enterprise';
import { startGoogleAuth } from '../services/crm';
import { ScreenHeader } from '../components/ScreenHeader';
import { Icon } from '../components/Icon';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { LoadingView } from '../components/LoadingView';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import {
  DatePickerModal,
  TimePickerModal,
  formatDisplayDate,
  formatDisplayTime,
} from '../components/DateTimePickerModal';

type CalendarViewTab = 'pending' | 'calendar';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DURATIONS = [15, 30, 45, 60, 90, 120];
const TIME_PRESETS = ['08:30', '09:30', '11:00', '14:30', '16:00', '17:30'];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToTodayKey(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

function buildMonthGrid(monthCursor: Date): Date[] {
  const firstOfMonth = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
  // Monday = 0 ... Sunday = 6
  const dayOfWeek = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - dayOfWeek);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const cell = new Date(start);
    cell.setDate(start.getDate() + i);
    days.push(cell);
  }
  return days;
}

function formatHourMinute(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatShortDayMonth(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}

function formatRelativeDelta(ms: number, nowMs: number): string {
  const diffMin = Math.round((ms - nowMs) / 60_000);
  const absMin = Math.abs(diffMin);
  if (absMin < 60) {
    return diffMin < 0 ? `Vencido hace ${absMin}m` : `En ${absMin}m`;
  }
  const absHr = Math.round(absMin / 60);
  if (absHr < 24) {
    return diffMin < 0 ? `Vencido hace ${absHr}h` : `En ${absHr}h`;
  }
  const absDays = Math.round(absHr / 24);
  return diffMin < 0 ? `Hace ${absDays}d` : `En ${absDays}d`;
}

function cleanPhone(raw?: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function formatWaPhone(raw?: string): string {
  const d = cleanPhone(raw);
  if (!d) return '';
  if (d.length === 10 && d.startsWith('3')) return `57${d}`;
  return d;
}

export function CalendarScreen() {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const authCtx = useAuth();
  const { user, profile, companyId, role, platformAdmin } = authCtx;
  const isAdmin = Boolean((authCtx as { isAdmin?: boolean }).isAdmin ?? (platformAdmin || isAdminRole(role)));
  const currentUserId = user?.uid || '';

  const routeMode = (route.params as RootStackParams['Calendario'])?.mode;

  // ── View & Filter State ────────────────────────────────────────────────────
  const [viewTab, setViewTab] = useState<CalendarViewTab>(() =>
    routeMode === 'calendar' ? 'calendar' : 'pending'
  );
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [advisorFilter, setAdvisorFilter] = useState<string>(() =>
    isAdmin ? 'all' : currentUserId || 'all'
  );

  // ── Data State ─────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [dismissedGoogleNotice, setDismissedGoogleNotice] = useState(false);
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sendingMorningSummary, setSendingMorningSummary] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  // ── Modals State ───────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaultDate, setCreateDefaultDate] = useState<string>(() => toDateKey(new Date()));
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [dayDetailDate, setDayDetailDate] = useState<Date | null>(null);
  const [fichaEvent, setFichaEvent] = useState<CalendarEvent | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!isAdmin && currentUserId && advisorFilter === 'all') {
      setAdvisorFilter(currentUserId);
    }
  }, [isAdmin, currentUserId, advisorFilter]);

  const gridDays = useMemo(() => buildMonthGrid(monthCursor), [monthCursor]);

  const loadAdvisorsList = useCallback(async () => {
    if (!companyId || !isAdmin) return;
    try {
      const list = await listAdvisors(companyId);
      setAdvisors(list);
    } catch {
      // Optional
    }
  }, [companyId, isAdmin]);

  useEffect(() => {
    loadAdvisorsList();
  }, [loadAdvisorsList]);

  const loadEvents = useCallback(
    async (showFullLoader = true) => {
      if (!companyId) {
        setLoading(false);
        return;
      }
      if (showFullLoader) setLoading(true);
      try {
        const now = new Date();
        const pastWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 35, 0, 0, 0);
        const futureWindow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 21, 23, 59, 59);

        const gridStart = new Date(gridDays[0]);
        gridStart.setHours(0, 0, 0, 0);
        const gridEnd = new Date(gridDays[gridDays.length - 1]);
        gridEnd.setHours(23, 59, 59, 999);

        const from = gridStart < pastWindow ? gridStart : pastWindow;
        const to = gridEnd > futureWindow ? gridEnd : futureWindow;

        const res = await listCalendarEvents(companyId, from, to);
        setGoogleConnected(res.connected);
        setEvents(res.events || []);
      } catch (err: any) {
        Alert.alert('Error al cargar agenda', err?.message || 'Intenta nuevamente.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId, gridDays]
  );

  useEffect(() => {
    loadEvents(true);
  }, [loadEvents]);

  const advisorMap = useMemo(() => {
    const m = new Map<string, string>();
    advisors.forEach((a) => m.set(a.id, a.displayName || a.email));
    return m;
  }, [advisors]);

  const advisorOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'Todos los Asesores' }];
    if (currentUserId) {
      opts.push({ value: currentUserId, label: `Mi Agenda (${profile?.displayName || 'Mía'})` });
    }
    const seen = new Set(opts.map((o) => o.value));
    advisors.forEach((a) => {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        opts.push({ value: a.id, label: a.displayName || a.email });
      }
    });
    return opts;
  }, [advisors, currentUserId, profile?.displayName]);

  // Filter events by advisor selection
  const filteredEvents = useMemo(() => {
    const target = isAdmin ? advisorFilter : currentUserId || advisorFilter;
    if (!target || target === 'all') return events;
    return events.filter((ev) => {
      if (!ev.advisorId) return target === currentUserId;
      return ev.advisorId === target;
    });
  }, [events, isAdmin, advisorFilter, currentUserId]);

  // Categorize Pending Tasks (Overdue, Today, Next 7 Days)
  const pendingBuckets = useMemo(() => {
    const now = new Date();
    const nowMs = now.getTime();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
    const endNext7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59, 999).getTime();

    const actionable = filteredEvents.filter((ev) => {
      if (ev.status === 'canceled' || ev.status === 'completed') return false;
      if (ev.postCitaStatus === 'reported' || ev.attended === true) return false;
      return ev.source === 'reminder' || ev.source === 'crm';
    });

    const overdue: CalendarEvent[] = [];
    const today: CalendarEvent[] = [];
    const upcoming: CalendarEvent[] = [];

    for (const ev of actionable) {
      if (ev.start < startToday || (ev.start < nowMs && ev.source === 'reminder')) {
        if (ev.start >= startToday && ev.start <= endToday) {
          // Still today, keep in overdue if past hour, or today if later today
          if (ev.start < nowMs) overdue.push(ev);
          else today.push(ev);
        } else {
          overdue.push(ev);
        }
      } else if (ev.start >= startToday && ev.start <= endToday) {
        today.push(ev);
      } else if (ev.start > endToday && ev.start <= endNext7) {
        upcoming.push(ev);
      }
    }

    overdue.sort((a, b) => a.start - b.start);
    today.sort((a, b) => a.start - b.start);
    upcoming.sort((a, b) => a.start - b.start);

    return {
      overdue,
      today,
      upcoming,
      urgentCount: overdue.length + today.length,
    };
  }, [filteredEvents]);

  // Group events by YYYY-MM-DD for the Monthly Grid
  const eventsByDateKey = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of filteredEvents) {
      const k = toDateKey(new Date(ev.start));
      if (!map[k]) map[k] = [];
      map[k].push(ev);
    }
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.start - b.start));
    return map;
  }, [filteredEvents]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleSendMorningSummary = async () => {
    if (!companyId || sendingMorningSummary) return;
    setSendingMorningSummary(true);
    try {
      const targetAdv =
        isAdmin && advisorFilter !== 'all'
          ? advisorFilter
          : !isAdmin && currentUserId
          ? currentUserId
          : undefined;
      const res = await sendMorningAgendaSummaryNow(companyId, targetAdv);
      Alert.alert(
        'Resumen WhatsApp enviado',
        `Se notificó a ${res.advisorsNotified} asesor(es) con un total de ${res.totalItems} pendiente(s) del día.`
      );
    } catch (err: any) {
      Alert.alert('Error al enviar resumen', err?.message || 'Verifica la configuración de WhatsApp.');
    } finally {
      setSendingMorningSummary(false);
    }
  };

  const handleConnectGoogle = async () => {
    if (!companyId || connectingGoogle) return;
    setConnectingGoogle(true);
    try {
      const url = await startGoogleAuth(companyId);
      if (url) await Linking.openURL(url);
    } catch (err: any) {
      Alert.alert('Error Google Calendar', err?.message || 'No se pudo iniciar la conexión con Google.');
    } finally {
      setConnectingGoogle(false);
    }
  };

  const handleCompleteFollowUp = async (ev: CalendarEvent) => {
    if (!companyId || !ev.leadId || completingId) return;
    setCompletingId(ev.id);
    try {
      await completeLeadFollowUp(companyId, ev.leadId);
      setEvents((prev) => prev.filter((item) => item.id !== ev.id));
      if (selectedEvent?.id === ev.id) setSelectedEvent(null);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'No se pudo marcar como completado.');
    } finally {
      setCompletingId(null);
    }
  };

  const handleCancelOrDeleteEvent = (ev: CalendarEvent) => {
    if (!companyId) return;
    const isCrm = ev.source === 'crm';
    Alert.alert(
      isCrm ? 'Cancelar cita' : 'Eliminar evento',
      isCrm
        ? `¿Deseas cancelar la cita "${ev.title}"?`
        : `¿Deseas eliminar "${ev.title}" de tu Google Calendar?`,
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: isCrm ? 'Sí, cancelar cita' : 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setActionBusy(true);
            try {
              if (isCrm) {
                await cancelAppointment(companyId, ev.id);
              } else {
                await deleteCalendarEvent(companyId, ev.id);
              }
              setSelectedEvent(null);
              await loadEvents(false);
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'No se pudo procesar la solicitud.');
            } finally {
              setActionBusy(false);
            }
          },
        },
      ]
    );
  };

  const handleCopyMeetLink = async (link: string) => {
    try {
      await Clipboard.setStringAsync(link);
      Alert.alert('Enlace copiado', 'El enlace de Google Meet se copió al portapapeles.');
    } catch {
      Alert.alert('Enlace Google Meet', link);
    }
  };

  // ── Render Task Card for PendingTasksView ──────────────────────────────────
  const renderPendingCard = (ev: CalendarEvent, tone: 'overdue' | 'today' | 'upcoming') => {
    const nowMs = Date.now();
    const digits = cleanPhone(ev.leadPhone);
    const isReminder = ev.source === 'reminder';
    const advName = ev.advisorId ? advisorMap.get(ev.advisorId) : undefined;

    const accent =
      tone === 'overdue'
        ? palette.roseText
        : tone === 'today'
        ? palette.amberText
        : palette.skyText;
    const softBg =
      tone === 'overdue'
        ? palette.roseBg
        : tone === 'today'
        ? palette.amberBg
        : palette.skyBg;
    const softBorder =
      tone === 'overdue'
        ? palette.roseBorder
        : tone === 'today'
        ? palette.amberBorder
        : palette.skyBorder;

    return (
      <Pressable
        key={ev.id}
        onPress={() => setSelectedEvent(ev)}
        style={[
          styles.taskCard,
          {
            backgroundColor: palette.bgCard,
            borderColor: tone === 'overdue' ? palette.roseBorder : palette.border,
          },
        ]}
      >
        <View style={styles.taskTopRow}>
          {/* Time Box */}
          <View
            style={[
              styles.timeBadgeBox,
              { backgroundColor: softBg, borderColor: softBorder },
            ]}
          >
            <Text style={[styles.timeBadgeHour, { color: accent }]}>
              {formatHourMinute(ev.start)}
            </Text>
            <Text style={[styles.timeBadgeDate, { color: palette.textMuted }]}>
              {formatShortDayMonth(ev.start)}
            </Text>
          </View>

          <View style={{ flex: 1, gap: 4 }}>
            <View style={styles.taskBadgesRow}>
              <Badge
                label={isReminder ? 'Seguimiento / Llamada' : 'Cita Agendada'}
                color={isReminder ? 'yellow' : 'violet'}
                size="xs"
              />
              <View
                style={[
                  styles.relChip,
                  { backgroundColor: softBg, borderColor: softBorder },
                ]}
              >
                <Text style={[styles.relChipText, { color: accent }]}>
                  {formatRelativeDelta(ev.start, nowMs)}
                </Text>
              </View>
              {ev.meetLink && <Badge label="Meet" color="blue" size="xs" />}
            </View>

            <Text style={[styles.taskTitle, { color: palette.textPrimary }]} numberOfLines={2}>
              {ev.nextAction || ev.title}
            </Text>

            {(ev.leadName || ev.leadPhone) && (
              <Text style={[styles.taskSub, { color: palette.textSecondary }]} numberOfLines={1}>
                {ev.leadName || 'Prospecto'}
                {ev.leadPhone ? ` · ${ev.leadPhone}` : ''}
              </Text>
            )}

            <View style={styles.taskBadgesRow}>
              {ev.project ? (
                <View
                  style={[
                    styles.metaTag,
                    { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                  ]}
                >
                  <Icon name="Building2" size={10} color={palette.brandText} />
                  <Text style={[styles.metaTagText, { color: palette.brandText }]} numberOfLines={1}>
                    {ev.project}
                  </Text>
                </View>
              ) : null}

              {isAdmin && advName ? (
                <View
                  style={[
                    styles.metaTag,
                    { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                  ]}
                >
                  <Icon name="User" size={10} color={palette.textMuted} />
                  <Text style={[styles.metaTagText, { color: palette.textSecondary }]} numberOfLines={1}>
                    {advName}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        {/* Action Buttons Row */}
        <View style={[styles.taskActionsRow, { borderTopColor: palette.border }]}>
          <Pressable
            disabled={!digits}
            onPress={() => digits && Linking.openURL(`tel:${digits}`)}
            style={[
              styles.taskActionBtn,
              {
                backgroundColor: palette.emeraldBg,
                borderColor: palette.emeraldBorder,
                opacity: digits ? 1 : 0.4,
              },
            ]}
          >
            <Icon name="Phone" size={12} color={palette.emeraldText} />
            <Text style={[styles.taskActionText, { color: palette.emeraldText }]}>Llamar</Text>
          </Pressable>

          {ev.leadId && (
            <Pressable
              onPress={() => navigation.navigate('Chat', { leadId: ev.leadId })}
              style={[
                styles.taskActionBtn,
                { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
              ]}
            >
              <Icon name="MessageSquare" size={12} color={palette.skyText} />
              <Text style={[styles.taskActionText, { color: palette.skyText }]}>Chat CRM</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => setFichaEvent(ev)}
            style={[
              styles.taskActionBtn,
              { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
            ]}
          >
            <Icon name="ClipboardCheck" size={12} color={palette.brandText} />
            <Text style={[styles.taskActionText, { color: palette.brandText }]}>Ficha</Text>
          </Pressable>

          {isReminder && ev.leadId && (
            <Pressable
              disabled={completingId === ev.id}
              onPress={() => handleCompleteFollowUp(ev)}
              style={[
                styles.taskActionBtn,
                { backgroundColor: palette.bgSubtle, borderColor: palette.borderStrong },
              ]}
            >
              {completingId === ev.id ? (
                <ActivityIndicator size="small" color={palette.emerald} />
              ) : (
                <>
                  <Icon name="Check" size={12} color={palette.emeraldText} />
                  <Text style={[styles.taskActionText, { color: palette.textPrimary }]}>Hecho</Text>
                </>
              )}
            </Pressable>
          )}
        </View>
      </Pressable>
    );
  };

  // ── Render Monthly Grid View ───────────────────────────────────────────────
  const monthLabel = useMemo(
    () =>
      monthCursor.toLocaleDateString('es-CO', {
        month: 'long',
        year: 'numeric',
      }),
    [monthCursor]
  );

  const todayKey = toDateKey(new Date());
  const dayDetailKey = dayDetailDate ? toDateKey(dayDetailDate) : '';
  const dayDetailEvents = dayDetailKey ? eventsByDateKey[dayDetailKey] || [] : [];

  return (
    <View style={[styles.root, { backgroundColor: palette.bgBody }]}>
      <ScreenHeader
        title="Calendario & Agenda"
        subtitle="Seguimientos programados, citas virtuales Meet y agenda mensual"
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
        action={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pressable
              onPress={() => loadEvents(true)}
              style={[
                styles.headerIconBtn,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Icon name="RefreshCw" size={15} color={palette.textSecondary} />
            </Pressable>
            <Button
              size="sm"
              variant="primary"
              onPress={() => {
                setCreateDefaultDate(toDateKey(new Date()));
                setCreateOpen(true);
              }}
              icon={<Icon name="Plus" size={14} color={isDark ? '#09090b' : '#ffffff'} />}
            >
              Evento
            </Button>
          </View>
        }
      />

      {/* Top Controls & Segmented Tabs */}
      <View
        style={[
          styles.topToolbar,
          { backgroundColor: palette.bgCanvas, borderBottomColor: palette.border },
        ]}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.toolbarRow}
        >
          {isAdmin ? (
            <SelectModal
              value={advisorFilter}
              options={advisorOptions}
              onChange={setAdvisorFilter}
              title="Seleccionar Agenda de Asesor"
              icon="Users"
              searchable
              compact
            />
          ) : (
            <View
              style={[
                styles.lockedScopePill,
                { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
              ]}
            >
              <Icon name="User" size={12} color={palette.brandText} />
              <Text style={[styles.lockedScopeText, { color: palette.brandText }]}>
                Mi Agenda ({profile?.displayName || 'Asesor'})
              </Text>
            </View>
          )}

          <Pressable
            disabled={sendingMorningSummary}
            onPress={handleSendMorningSummary}
            style={[
              styles.summaryWaBtn,
              { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
            ]}
          >
            {sendingMorningSummary ? (
              <ActivityIndicator size="small" color={palette.amberText} />
            ) : (
              <Icon name="Sun" size={13} color={palette.amberText} />
            )}
            <Text style={[styles.summaryWaText, { color: palette.amberText }]}>
              Resumen WA
            </Text>
          </Pressable>
        </ScrollView>

        {/* View Switcher */}
        <View
          style={[
            styles.tabsContainer,
            { backgroundColor: palette.bgSubtle, borderColor: palette.border },
          ]}
        >
          <Pressable
            onPress={() => setViewTab('pending')}
            style={[
              styles.tabPill,
              viewTab === 'pending' && { backgroundColor: palette.bgCard },
            ]}
          >
            <Icon
              name="ClipboardCheck"
              size={14}
              color={viewTab === 'pending' ? palette.brandText : palette.textMuted}
            />
            <Text
              style={[
                styles.tabPillText,
                { color: viewTab === 'pending' ? palette.textPrimary : palette.textMuted },
              ]}
              numberOfLines={1}
            >
              Mis Pendientes
            </Text>
            {pendingBuckets.urgentCount > 0 && (
              <View style={[styles.urgentBubble, { backgroundColor: palette.rose }]}>
                <Text style={styles.urgentBubbleText}>{pendingBuckets.urgentCount}</Text>
              </View>
            )}
          </Pressable>

          <Pressable
            onPress={() => setViewTab('calendar')}
            style={[
              styles.tabPill,
              viewTab === 'calendar' && { backgroundColor: palette.bgCard },
            ]}
          >
            <Icon
              name="Calendar"
              size={14}
              color={viewTab === 'calendar' ? palette.brandText : palette.textMuted}
            />
            <Text
              style={[
                styles.tabPillText,
                { color: viewTab === 'calendar' ? palette.textPrimary : palette.textMuted },
              ]}
              numberOfLines={1}
            >
              Calendario Mensual
            </Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <LoadingView label="Cargando agenda y seguimientos..." />
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 14,
            paddingBottom: Math.max(insets.bottom + 24, 36),
            gap: 14,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadEvents(false);
              }}
              tintColor={palette.brand}
            />
          }
        >
          {/* Dismissible Google Calendar Notice */}
          {googleConnected === false && !dismissedGoogleNotice && (
            <View
              style={[
                styles.googleBanner,
                { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
              ]}
            >
              <Icon name="Info" size={16} color={palette.skyText} />
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={[styles.googleBannerTitle, { color: palette.skyText }]}>
                  Google Calendar no vinculado
                </Text>
                <Text style={[styles.googleBannerSub, { color: palette.textSecondary }]}>
                  Tus citas y recordatorios del CRM funcionan normalmente. Vincula Google para crear enlaces de Meet automáticos.
                </Text>
                <Pressable onPress={handleConnectGoogle} disabled={connectingGoogle}>
                  <Text style={[styles.connectGoogleLink, { color: palette.skyText }]}>
                    {connectingGoogle ? 'Abriendo Google...' : 'Conectar Google Calendar →'}
                  </Text>
                </Pressable>
              </View>
              <Pressable onPress={() => setDismissedGoogleNotice(true)} hitSlop={8}>
                <Icon name="X" size={15} color={palette.textMuted} />
              </Pressable>
            </View>
          )}

          {viewTab === 'pending' ? (
            <>
              {/* 3 Summary KPI Cards */}
              <View style={styles.pendingKpiRow}>
                <View
                  style={[
                    styles.pendingKpiBox,
                    { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                  ]}
                >
                  <Icon name="AlertTriangle" size={15} color={palette.roseText} />
                  <Text style={[styles.pendingKpiNum, { color: palette.roseText }]}>
                    {pendingBuckets.overdue.length}
                  </Text>
                  <Text style={[styles.pendingKpiLabel, { color: palette.roseText }]} numberOfLines={1}>
                    En Mora
                  </Text>
                </View>

                <View
                  style={[
                    styles.pendingKpiBox,
                    { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
                  ]}
                >
                  <Icon name="Clock" size={15} color={palette.amberText} />
                  <Text style={[styles.pendingKpiNum, { color: palette.amberText }]}>
                    {pendingBuckets.today.length}
                  </Text>
                  <Text style={[styles.pendingKpiLabel, { color: palette.amberText }]} numberOfLines={1}>
                    Para Hoy
                  </Text>
                </View>

                <View
                  style={[
                    styles.pendingKpiBox,
                    { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
                  ]}
                >
                  <Icon name="Calendar" size={15} color={palette.skyText} />
                  <Text style={[styles.pendingKpiNum, { color: palette.skyText }]}>
                    {pendingBuckets.upcoming.length}
                  </Text>
                  <Text style={[styles.pendingKpiLabel, { color: palette.skyText }]} numberOfLines={1}>
                    Próx. 7 Días
                  </Text>
                </View>
              </View>

              {pendingBuckets.overdue.length === 0 &&
              pendingBuckets.today.length === 0 &&
              pendingBuckets.upcoming.length === 0 ? (
                <View
                  style={[
                    styles.allClearCard,
                    { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
                  ]}
                >
                  <Icon name="CheckCheck" size={26} color={palette.emeraldText} />
                  <Text style={[styles.allClearTitle, { color: palette.emeraldText }]}>
                    ¡Estás 100% al día con tus seguimientos!
                  </Text>
                  <Text style={[styles.allClearSub, { color: palette.textSecondary }]}>
                    No tienes llamadas en mora ni citas pendientes para los próximos 7 días.
                  </Text>
                </View>
              ) : (
                <>
                  {pendingBuckets.overdue.length > 0 && (
                    <View style={styles.sectionGroup}>
                      <View style={styles.sectionTitleRow}>
                        <Icon name="AlertTriangle" size={14} color={palette.roseText} />
                        <Text style={[styles.sectionTitleText, { color: palette.roseText }]}>
                          Vencidos / En Mora ({pendingBuckets.overdue.length})
                        </Text>
                      </View>
                      {pendingBuckets.overdue.map((ev) => renderPendingCard(ev, 'overdue'))}
                    </View>
                  )}

                  {pendingBuckets.today.length > 0 && (
                    <View style={styles.sectionGroup}>
                      <View style={styles.sectionTitleRow}>
                        <Icon name="Clock" size={14} color={palette.amberText} />
                        <Text style={[styles.sectionTitleText, { color: palette.amberText }]}>
                          Programados para Hoy ({pendingBuckets.today.length})
                        </Text>
                      </View>
                      {pendingBuckets.today.map((ev) => renderPendingCard(ev, 'today'))}
                    </View>
                  )}

                  {pendingBuckets.upcoming.length > 0 && (
                    <View style={styles.sectionGroup}>
                      <View style={styles.sectionTitleRow}>
                        <Icon name="Calendar" size={14} color={palette.skyText} />
                        <Text style={[styles.sectionTitleText, { color: palette.skyText }]}>
                          Próximos 7 Días ({pendingBuckets.upcoming.length})
                        </Text>
                      </View>
                      {pendingBuckets.upcoming.map((ev) => renderPendingCard(ev, 'upcoming'))}
                    </View>
                  )}
                </>
              )}
            </>
          ) : (
            /* ── Monthly Calendar 7-Column Grid ── */
            <View
              style={[
                styles.calendarCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              {/* Month Navigation Header */}
              <View style={styles.monthNavBar}>
                <Pressable
                  onPress={() =>
                    setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
                  }
                  style={[
                    styles.navSquareBtn,
                    { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                  ]}
                >
                  <Icon name="ChevronLeft" size={16} color={palette.textPrimary} />
                </Pressable>

                <Text style={[styles.monthTitleText, { color: palette.textPrimary }]}>
                  {monthLabel}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable
                    onPress={() => {
                      const now = new Date();
                      setMonthCursor(new Date(now.getFullYear(), now.getMonth(), 1));
                    }}
                    style={[
                      styles.todayBtn,
                      { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
                    ]}
                  >
                    <Text style={[styles.todayBtnText, { color: palette.brandText }]}>Hoy</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
                    }
                    style={[
                      styles.navSquareBtn,
                      { backgroundColor: palette.bgSubtle, borderColor: palette.border },
                    ]}
                  >
                    <Icon name="ChevronRight" size={16} color={palette.textPrimary} />
                  </Pressable>
                </View>
              </View>

              {/* Weekday Headers */}
              <View style={[styles.weekHeaderRow, { borderBottomColor: palette.border }]}>
                {WEEKDAYS.map((wd) => (
                  <View key={wd} style={styles.weekHeaderCell}>
                    <Text style={[styles.weekHeaderText, { color: palette.textMuted }]}>{wd}</Text>
                  </View>
                ))}
              </View>

              {/* 6 Rows x 7 Days */}
              <View style={styles.daysGrid}>
                {gridDays.map((dayDate) => {
                  const key = toDateKey(dayDate);
                  const inMonth = dayDate.getMonth() === monthCursor.getMonth();
                  const isToday = key === todayKey;
                  const cellEvents = eventsByDateKey[key] || [];

                  return (
                    <Pressable
                      key={key}
                      onPress={() => setDayDetailDate(dayDate)}
                      style={[
                        styles.dayCell,
                        {
                          borderColor: palette.border,
                          backgroundColor: isToday
                            ? palette.brandSoft
                            : inMonth
                            ? 'transparent'
                            : palette.bgSubtle,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.dayNumberCircle,
                          isToday && { backgroundColor: palette.brand },
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayNumberText,
                            {
                              color: isToday
                                ? isDark
                                  ? '#09090b'
                                  : '#ffffff'
                                : inMonth
                                ? palette.textPrimary
                                : palette.textSubtle,
                            },
                          ]}
                        >
                          {dayDate.getDate()}
                        </Text>
                      </View>

                      <View style={styles.cellEventsStack}>
                        {cellEvents.slice(0, 2).map((ev) => {
                          const canceled = ev.status === 'canceled';
                          const pillBg =
                            ev.source === 'reminder'
                              ? palette.amberBg
                              : ev.source === 'crm'
                              ? palette.brandSoft
                              : palette.skyBg;
                          const pillColor =
                            ev.source === 'reminder'
                              ? palette.amberText
                              : ev.source === 'crm'
                              ? palette.brandText
                              : palette.skyText;

                          return (
                            <Pressable
                              key={ev.id}
                              onPress={() => setSelectedEvent(ev)}
                              style={[
                                styles.cellEventPill,
                                { backgroundColor: pillBg, opacity: canceled ? 0.45 : 1 },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.cellEventText,
                                  {
                                    color: pillColor,
                                    textDecorationLine: canceled ? 'line-through' : 'none',
                                  },
                                ]}
                                numberOfLines={1}
                              >
                                {ev.leadName || ev.title}
                              </Text>
                            </Pressable>
                          );
                        })}
                        {cellEvents.length > 2 && (
                          <Text style={[styles.moreEventsLabel, { color: palette.textMuted }]}>
                            +{cellEvents.length - 2} más
                          </Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Color Legend */}
              <View style={[styles.legendRow, { borderTopColor: palette.border }]}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: palette.brand }]} />
                  <Text style={[styles.legendText, { color: palette.textMuted }]}>Cita CRM</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: palette.amber }]} />
                  <Text style={[styles.legendText, { color: palette.textMuted }]}>Seguimiento</Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: palette.sky }]} />
                  <Text style={[styles.legendText, { color: palette.textMuted }]}>Google</Text>
                </View>
              </View>
            </View>
          )}
        </ScrollView>
      )}

      {/* Day Detail Bottom Sheet */}
      <Modal
        visible={!!dayDetailDate}
        transparent
        animationType="slide"
        onRequestClose={() => setDayDetailDate(null)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: palette.backdrop }]}
          onPress={() => setDayDetailDate(null)}
        >
          <Pressable
            style={[
              styles.bottomSheet,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 16, 24),
              },
            ]}
            onPress={() => {}}
          >
            <View style={styles.sheetHeaderRow}>
              <View>
                <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>
                  {dayDetailDate?.toLocaleDateString('es-CO', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </Text>
                <Text style={[styles.sheetSub, { color: palette.textMuted }]}>
                  {dayDetailEvents.length} actividad{dayDetailEvents.length === 1 ? '' : 'es'} programada
                  {dayDetailEvents.length === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable onPress={() => setDayDetailDate(null)} hitSlop={8}>
                <Icon name="X" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 340 }} contentContainerStyle={{ gap: 8, paddingVertical: 8 }}>
              {dayDetailEvents.length === 0 ? (
                <Text style={[styles.sheetSub, { color: palette.textMuted, paddingVertical: 16, textAlign: 'center' }]}>
                  No hay eventos agendados en esta fecha.
                </Text>
              ) : (
                dayDetailEvents.map((ev) => (
                  <Pressable
                    key={ev.id}
                    onPress={() => {
                      setDayDetailDate(null);
                      setSelectedEvent(ev);
                    }}
                    style={[
                      styles.dayEventRow,
                      { backgroundColor: palette.bgCard, borderColor: palette.border },
                    ]}
                  >
                    <Text style={[styles.dayEventTime, { color: palette.brandText }]}>
                      {ev.allDay ? 'Todo el día' : formatHourMinute(ev.start)}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.dayEventTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                        {ev.title}
                      </Text>
                      {ev.leadName ? (
                        <Text style={[styles.sheetSub, { color: palette.textMuted }]} numberOfLines={1}>
                          {ev.leadName}
                        </Text>
                      ) : null}
                    </View>
                    <Icon name="ChevronRight" size={15} color={palette.textMuted} />
                  </Pressable>
                ))
              )}
            </ScrollView>

            <Button
              variant="primary"
              fullWidth
              onPress={() => {
                const targetKey = dayDetailDate ? toDateKey(dayDetailDate) : toDateKey(new Date());
                setDayDetailDate(null);
                setCreateDefaultDate(targetKey);
                setCreateOpen(true);
              }}
              icon={<Icon name="Plus" size={15} color={isDark ? '#09090b' : '#ffffff'} />}
            >
              Agendar Evento en este Día
            </Button>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Event Detail Modal */}
      <Modal
        visible={!!selectedEvent}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedEvent(null)}
      >
        <Pressable
          style={[styles.backdrop, { backgroundColor: palette.backdrop }]}
          onPress={() => setSelectedEvent(null)}
        >
          <Pressable
            style={[
              styles.bottomSheet,
              {
                backgroundColor: palette.bgDrawer,
                borderColor: palette.borderDrawer,
                paddingBottom: Math.max(insets.bottom + 16, 24),
              },
            ]}
            onPress={() => {}}
          >
            {selectedEvent && (
              <View style={{ gap: 12 }}>
                <View style={styles.sheetHeaderRow}>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', flex: 1 }}>
                    <Badge
                      label={
                        selectedEvent.source === 'crm'
                          ? 'Cita CRM'
                          : selectedEvent.source === 'reminder'
                          ? 'Seguimiento'
                          : 'Google Calendar'
                      }
                      color={
                        selectedEvent.source === 'crm'
                          ? 'violet'
                          : selectedEvent.source === 'reminder'
                          ? 'yellow'
                          : 'blue'
                      }
                      size="sm"
                    />
                    {selectedEvent.status && (
                      <Badge
                        label={
                          selectedEvent.status === 'canceled'
                            ? 'Cancelada'
                            : selectedEvent.status === 'completed'
                            ? 'Completada'
                            : 'Programada'
                        }
                        color={
                          selectedEvent.status === 'canceled'
                            ? 'red'
                            : selectedEvent.status === 'completed'
                            ? 'green'
                            : 'gray'
                        }
                        size="sm"
                      />
                    )}
                  </View>
                  <Pressable onPress={() => setSelectedEvent(null)} hitSlop={8}>
                    <Icon name="X" size={20} color={palette.textMuted} />
                  </Pressable>
                </View>

                <Text style={[styles.detailTitle, { color: palette.textPrimary }]}>
                  {selectedEvent.nextAction || selectedEvent.title}
                </Text>

                <View style={styles.detailMetaBlock}>
                  <View style={styles.detailMetaRow}>
                    <Icon name="Calendar" size={14} color={palette.brandText} />
                    <Text style={[styles.detailMetaText, { color: palette.textSecondary }]}>
                      {new Date(selectedEvent.start).toLocaleDateString('es-CO', {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                      {' · '}
                      {formatHourMinute(selectedEvent.start)}
                      {selectedEvent.end ? ` - ${formatHourMinute(selectedEvent.end)}` : ''}
                    </Text>
                  </View>

                  {(selectedEvent.leadName || selectedEvent.leadPhone) && (
                    <View style={styles.detailMetaRow}>
                      <Icon name="User" size={14} color={palette.brandText} />
                      <Text style={[styles.detailMetaText, { color: palette.textPrimary }]}>
                        {selectedEvent.leadName || 'Prospecto'}
                        {selectedEvent.leadPhone ? ` · ${selectedEvent.leadPhone}` : ''}
                      </Text>
                    </View>
                  )}

                  {selectedEvent.project && (
                    <View style={styles.detailMetaRow}>
                      <Icon name="Building2" size={14} color={palette.brandText} />
                      <Text style={[styles.detailMetaText, { color: palette.textSecondary }]}>
                        Proyecto: {selectedEvent.project}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Google Meet Box */}
                {selectedEvent.meetLink && (
                  <View
                    style={[
                      styles.meetBox,
                      { backgroundColor: palette.skyBg, borderColor: palette.skyBorder },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Icon name="Video" size={16} color={palette.skyText} />
                      <Text style={[styles.meetBoxTitle, { color: palette.skyText, flex: 1 }]}>
                        Videollamada Google Meet activa
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <Button
                        variant="primary"
                        size="sm"
                        style={{ flex: 1.3 }}
                        onPress={() => selectedEvent.meetLink && Linking.openURL(selectedEvent.meetLink)}
                        icon={<Icon name="ExternalLink" size={13} color={isDark ? '#09090b' : '#ffffff'} />}
                      >
                        Unirse a Meet
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => selectedEvent.meetLink && handleCopyMeetLink(selectedEvent.meetLink)}
                        icon={<Icon name="Copy" size={13} color={palette.textPrimary} />}
                      >
                        Copiar enlace
                      </Button>
                    </View>
                  </View>
                )}

                {/* Contact Quick Buttons */}
                {(selectedEvent.leadPhone || selectedEvent.leadId) && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {cleanPhone(selectedEvent.leadPhone) ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => Linking.openURL(`tel:${cleanPhone(selectedEvent.leadPhone)}`)}
                        icon={<Icon name="Phone" size={13} color={palette.emeraldText} />}
                      >
                        Llamar
                      </Button>
                    ) : null}

                    {formatWaPhone(selectedEvent.leadPhone) ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() =>
                          Linking.openURL(`https://wa.me/${formatWaPhone(selectedEvent.leadPhone)}`)
                        }
                        icon={<Icon name="ExternalLink" size={13} color={palette.emerald} />}
                      >
                        WhatsApp
                      </Button>
                    ) : null}

                    {selectedEvent.leadId ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ flex: 1 }}
                        onPress={() => {
                          const targetLeadId = selectedEvent.leadId;
                          setSelectedEvent(null);
                          navigation.navigate('Chat', { leadId: targetLeadId });
                        }}
                        icon={<Icon name="MessageSquare" size={13} color={palette.skyText} />}
                      >
                        Chat CRM
                      </Button>
                    ) : null}
                  </View>
                )}

                {/* Ficha Técnica CTA */}
                {(selectedEvent.source === 'crm' || selectedEvent.leadId) && (
                  <Button
                    variant="primary"
                    fullWidth
                    onPress={() => {
                      const target = selectedEvent;
                      setSelectedEvent(null);
                      setFichaEvent(target);
                    }}
                    icon={
                      <Icon
                        name="ClipboardCheck"
                        size={15}
                        color={isDark ? '#09090b' : '#ffffff'}
                      />
                    }
                  >
                    Diligenciar Ficha Técnica
                  </Button>
                )}

                {/* Complete Reminder or Cancel/Delete Event */}
                {selectedEvent.source === 'reminder' && selectedEvent.leadId ? (
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={completingId === selectedEvent.id}
                    onPress={() => handleCompleteFollowUp(selectedEvent)}
                    icon={<Icon name="Check" size={15} color={palette.emeraldText} />}
                  >
                    Marcar Seguimiento como Hecho
                  </Button>
                ) : selectedEvent.status !== 'canceled' ? (
                  <Button
                    variant="danger"
                    fullWidth
                    loading={actionBusy}
                    onPress={() => handleCancelOrDeleteEvent(selectedEvent)}
                    icon={<Icon name="Trash2" size={14} color={palette.roseText} />}
                  >
                    {selectedEvent.source === 'crm'
                      ? 'Cancelar Cita'
                      : 'Eliminar Evento de Google Calendar'}
                  </Button>
                ) : null}
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Create Event Modal (1:1 con EventModal.tsx) */}
      {companyId && createOpen ? (
        <CreateEventModal
          visible={createOpen}
          companyId={companyId}
          initialDate={createDefaultDate}
          googleConnected={!!googleConnected}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            loadEvents(false);
          }}
        />
      ) : null}

      {/* Ficha Técnica Modal */}
      {companyId ? (
        <FichaTecnicaModal
          isOpen={!!fichaEvent}
          onClose={() => setFichaEvent(null)}
          onSuccess={() => {
            setFichaEvent(null);
            loadEvents(false);
          }}
          companyId={companyId}
          lead={
            fichaEvent?.leadId
              ? {
                  id: fichaEvent.leadId,
                  name: fichaEvent.leadName || undefined,
                  phone: fichaEvent.leadPhone,
                  project: fichaEvent.project,
                }
              : undefined
          }
          appointment={
            fichaEvent?.source === 'crm'
              ? {
                  id: fichaEvent.id,
                  leadId: fichaEvent.leadId,
                  leadName: fichaEvent.leadName || undefined,
                  leadPhone: fichaEvent.leadPhone,
                  title: fichaEvent.title,
                  project: fichaEvent.project,
                }
              : undefined
          }
        />
      ) : null}
    </View>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUB-MODAL: CreateEventModal (1:1 con EventModal.tsx)
// ══════════════════════════════════════════════════════════════════════════════
function CreateEventModal({
  visible,
  companyId,
  initialDate,
  googleConnected,
  onClose,
  onCreated,
}: {
  visible: boolean;
  companyId: string;
  initialDate: string;
  googleConnected: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();

  const [title, setTitle] = useState('');
  const [dateStr, setDateStr] = useState(initialDate);
  const [timeStr, setTimeStr] = useState('10:00');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [description, setDescription] = useState('');
  const [withMeet, setWithMeet] = useState(googleConnected);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Título requerido', 'Ingresa un título para el evento.');
      return;
    }
    const isoCandidate = `${dateStr.trim()}T${timeStr.trim() || '10:00'}:00`;
    const parsed = new Date(isoCandidate);
    if (isNaN(parsed.getTime())) {
      Alert.alert('Fecha u hora inválida', 'Usa el formato YYYY-MM-DD para fecha y HH:MM para hora.');
      return;
    }

    setSaving(true);
    try {
      const res = await createCalendarEvent(companyId, {
        title: title.trim(),
        startISO: parsed.toISOString(),
        durationMinutes,
        description: description.trim() || undefined,
        withMeet,
      });
      if (res.meetLink) {
        Alert.alert('Evento creado con Google Meet', `Enlace generado:\n${res.meetLink}`);
      }
      onCreated();
    } catch (err: any) {
      Alert.alert(
        'No se pudo crear el evento',
        err?.message || 'Verifica que tu cuenta de Google Calendar esté conectada.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.root, { backgroundColor: palette.bgBody }]}
      >
        <View
          style={[
            styles.createHeader,
            {
              paddingTop: Math.max(insets.top + 8, 16),
              backgroundColor: palette.bgDrawerHeader,
              borderBottomColor: palette.border,
            },
          ]}
        >
          <View>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>Crear Nuevo Evento</Text>
            <Text style={[styles.sheetSub, { color: palette.textMuted }]}>
              Sincronizado con tu calendario comercial
            </Text>
          </View>
          <Pressable onPress={onClose} hitSlop={8}>
            <Icon name="X" size={22} color={palette.textMuted} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: Math.max(insets.bottom + 24, 36),
            gap: 14,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ gap: 5 }}>
            <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Título del evento *</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Ej. Presentación Laguna Mar con cliente"
              placeholderTextColor={palette.placeholder}
              style={[
                styles.inputBox,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderInput,
                  color: palette.textPrimary,
                },
              ]}
            />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Fecha (YYYY-MM-DD)</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'Hoy', d: 0 },
                { label: 'Mañana', d: 1 },
                { label: '+2 días', d: 2 },
                { label: '+7 días', d: 7 },
              ].map((p) => {
                const val = addDaysToTodayKey(p.d);
                const active = dateStr === val;
                return (
                  <Pressable
                    key={p.label}
                    onPress={() => setDateStr(val)}
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setShowDatePicker(true)}
              style={[
                styles.inputBox,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: dateStr ? '#10b981' : palette.borderInput,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                },
              ]}
            >
              <Icon name="Calendar" size={15} color={dateStr ? '#10b981' : palette.textMuted} />
              <Text
                style={{
                  color: dateStr ? palette.textPrimary : palette.placeholder,
                  fontSize: 13,
                  fontWeight: dateStr ? '700' : '400',
                }}
              >
                {dateStr ? formatDisplayDate(dateStr) : 'Toca para elegir fecha...'}
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Hora de inicio (HH:MM)</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {TIME_PRESETS.map((tp) => {
                const active = timeStr === tp;
                return (
                  <Pressable
                    key={tp}
                    onPress={() => setTimeStr(tp)}
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {tp}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              onPress={() => setShowTimePicker(true)}
              style={[
                styles.inputBox,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: timeStr ? '#10b981' : palette.borderInput,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                },
              ]}
            >
              <Icon name="Clock" size={15} color={timeStr ? '#10b981' : palette.textMuted} />
              <Text
                style={{
                  color: timeStr ? palette.textPrimary : palette.placeholder,
                  fontSize: 13,
                  fontWeight: timeStr ? '700' : '400',
                }}
              >
                {timeStr ? formatDisplayTime(timeStr) : 'Toca para elegir hora...'}
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Duración</Text>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {DURATIONS.map((dur) => {
                const active = durationMinutes === dur;
                return (
                  <Pressable
                    key={dur}
                    onPress={() => setDurationMinutes(dur)}
                    style={[
                      styles.quickChip,
                      {
                        backgroundColor: active ? palette.brandSoft : palette.bgCard,
                        borderColor: active ? palette.brand : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.quickChipText,
                        { color: active ? palette.brandText : palette.textSecondary },
                      ]}
                    >
                      {dur} min
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={() => setWithMeet((m) => !m)}
            style={[
              styles.meetToggleCard,
              {
                backgroundColor: withMeet ? palette.skyBg : palette.bgCard,
                borderColor: withMeet ? palette.skyBorder : palette.border,
              },
            ]}
          >
            <Icon name="Video" size={18} color={withMeet ? palette.skyText : palette.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>
                Crear enlace de Google Meet
              </Text>
              <Text style={[styles.sheetSub, { color: palette.textMuted }]}>
                Genera sala de videollamada automáticamente en Google Calendar
              </Text>
            </View>
            <Icon
              name={withMeet ? 'CheckCheck' : 'Square'}
              size={18}
              color={withMeet ? palette.skyText : palette.textMuted}
            />
          </Pressable>

          <View style={{ gap: 5 }}>
            <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>Descripción / Notas</Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
              placeholder="Detalles o agenda de la reunión..."
              placeholderTextColor={palette.placeholder}
              style={[
                styles.textAreaBox,
                {
                  backgroundColor: palette.bgInput,
                  borderColor: palette.borderInput,
                  color: palette.textPrimary,
                },
              ]}
            />
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Button variant="secondary" style={{ flex: 1 }} onPress={onClose}>
              Cancelar
            </Button>
            <Button variant="primary" style={{ flex: 1.5 }} loading={saving} onPress={handleSubmit}>
              Guardar Evento
            </Button>
          </View>

          <DatePickerModal
            visible={showDatePicker}
            value={dateStr}
            onClose={() => setShowDatePicker(false)}
            onSelect={(d) => setDateStr(d)}
            title="Seleccionar Fecha del Evento"
          />
          <TimePickerModal
            visible={showTimePicker}
            value={timeStr}
            onClose={() => setShowTimePicker(false)}
            onSelect={(t) => setTimeStr(t)}
            title="Seleccionar Hora del Evento"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topToolbar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    gap: 9,
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockedScopePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  lockedScopeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryWaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
  },
  summaryWaText: {
    fontSize: 12,
    fontWeight: '700',
  },
  tabsContainer: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 11,
    borderWidth: 1,
    gap: 4,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  tabPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  urgentBubble: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentBubbleText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  googleBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  googleBannerTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  googleBannerSub: {
    fontSize: 11,
    lineHeight: 16,
  },
  connectGoogleLink: {
    fontSize: 12,
    fontWeight: '800',
  },
  pendingKpiRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pendingKpiBox: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 3,
  },
  pendingKpiNum: {
    fontSize: 20,
    fontWeight: '800',
  },
  pendingKpiLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  allClearCard: {
    padding: 22,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    gap: 8,
  },
  allClearTitle: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  allClearSub: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  sectionGroup: {
    gap: 9,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitleText: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  taskCard: {
    borderRadius: 13,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  taskTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  timeBadgeBox: {
    width: 58,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeBadgeHour: {
    fontSize: 14,
    fontWeight: '800',
  },
  timeBadgeDate: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  taskBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 5,
  },
  relChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  relChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  taskSub: {
    fontSize: 12,
  },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    maxWidth: 150,
  },
  metaTagText: {
    fontSize: 10,
    fontWeight: '600',
  },
  taskActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  taskActionBtn: {
    flex: 1,
    minWidth: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  taskActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // ── Monthly Grid Styles ────────────────────────────────────────────────────
  calendarCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  monthNavBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  navSquareBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitleText: {
    fontSize: 15,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  todayBtn: {
    paddingHorizontal: 10,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  weekHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingVertical: 6,
  },
  weekHeaderCell: {
    width: '14.2857%',
    alignItems: 'center',
  },
  weekHeaderText: {
    fontSize: 11,
    fontWeight: '700',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.2857%',
    minHeight: 74,
    padding: 3,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  dayNumberCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  dayNumberText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cellEventsStack: {
    gap: 2,
  },
  cellEventPill: {
    paddingHorizontal: 3,
    paddingVertical: 1.5,
    borderRadius: 4,
  },
  cellEventText: {
    fontSize: 8.5,
    fontWeight: '700',
  },
  moreEventsLabel: {
    fontSize: 8.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
    fontWeight: '600',
  },
  // ── Modals ─────────────────────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bottomSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'capitalize',
  },
  sheetSub: {
    fontSize: 12,
    marginTop: 2,
  },
  dayEventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 11,
    borderWidth: 1,
  },
  dayEventTime: {
    fontSize: 12,
    fontWeight: '800',
    minWidth: 52,
  },
  dayEventTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  detailTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  detailMetaBlock: {
    gap: 6,
  },
  detailMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailMetaText: {
    fontSize: 13,
    flex: 1,
  },
  meetBox: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  meetBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  inputBox: {
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13,
  },
  textAreaBox: {
    minHeight: 82,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    textAlignVertical: 'top',
  },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  meetToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
});
