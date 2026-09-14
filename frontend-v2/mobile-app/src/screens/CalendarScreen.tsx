import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { useLeads } from '../hooks/useLeads';
import { bookAppointmentManual, getGoogleConnection, listAppointments, startGoogleAuth } from '../services/crm';
import { colors } from '../theme/colors';
import type { Appointment, Lead } from '../types';

const dayMs = 24 * 60 * 60 * 1000;
const timeOptions = Array.from({ length: 29 }, (_, index) => {
  const totalMinutes = 7 * 60 + index * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
});
const durationOptions = ['15', '30', '45', '60', '90', '120'];
type GoogleConnection = { connected: boolean; email: string | null };

export function CalendarScreen() {
  const { companyId, profile, user } = useAuth();
  const { leads } = useLeads(companyId, user?.uid ?? null, profile?.role);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDay, setSelectedDay] = useState(startOfDay(new Date()).getTime());
  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(new Date()).getTime());
  const [loading, setLoading] = useState(false);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [calendarConnection, setCalendarConnection] = useState<GoogleConnection | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const from = startOfDay(new Date(Date.now() - 35 * dayMs));
    const to = startOfDay(new Date(Date.now() + 70 * dayMs));
    try {
      const items = await listAppointments(companyId, from, to);
      setAppointments(items.filter((item) => item.status === 'scheduled'));
    } catch {
      Alert.alert('Calendario', 'No se pudo cargar el calendario.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  const loadConnection = useCallback(async () => {
    if (!companyId) return;
    setConnectionLoading(true);
    try {
      setCalendarConnection(await getGoogleConnection(companyId));
    } catch {
      setCalendarConnection({ connected: false, email: null });
    } finally {
      setConnectionLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadConnection(); }, [loadConnection]);

  const handleConnect = async () => {
    if (!companyId) return;
    setConnectionLoading(true);
    try {
      const url = await startGoogleAuth(companyId);
      if (url) {
        Linking.openURL(url);
      }
    } catch {
      Alert.alert('Error', 'No se pudo iniciar la conexión con Google.');
    } finally {
      setConnectionLoading(false);
    }
  };

  const calendarDays = useMemo(() => buildMonthGrid(new Date(visibleMonth)), [visibleMonth]);
  const dayAppointments = appointments
    .filter((appointment) => startOfDay(new Date(appointment.startTime)).getTime() === selectedDay)
    .sort((a, b) => a.startTime - b.startTime);
  const monthLabel = capitalize(new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(new Date(visibleMonth)));
  const visibleMonthDate = new Date(visibleMonth);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader
        title={monthLabel}
        action={<Pressable onPress={() => setModalOpen(true)} style={styles.headerAdd}><Text style={styles.headerAddText}>+ Evento</Text></Pressable>}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading || connectionLoading} onRefresh={() => { load(); loadConnection(); }} tintColor={colors.brand} />}
      >
        <CalendarConnectionCard connection={calendarConnection} loading={connectionLoading} onRefresh={loadConnection} onConnect={handleConnect} />

        <View style={styles.monthControls}>
          <Pressable onPress={() => setVisibleMonth(addMonths(visibleMonth, -1))} style={styles.monthButton}>
            <Ionicons name="caret-back" size={18} color={colors.muted} />
          </Pressable>
          <Pressable onPress={() => {
            setVisibleMonth(startOfMonth(new Date()).getTime());
            setSelectedDay(startOfDay(new Date()).getTime());
          }} style={styles.todayButton}>
            <Text style={styles.todayText}>Hoy</Text>
          </Pressable>
          <Pressable onPress={() => setVisibleMonth(addMonths(visibleMonth, 1))} style={styles.monthButton}>
            <Ionicons name="caret-forward" size={18} color={colors.muted} />
          </Pressable>
        </View>

        <View style={styles.calendarGrid}>
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((day) => <Text key={day} style={styles.weekday}>{day}</Text>)}
          {calendarDays.map((day) => {
            const dayTime = startOfDay(day).getTime();
            const selected = dayTime === selectedDay;
            const inMonth = day.getMonth() === visibleMonthDate.getMonth();
            const events = appointments.filter((appointment) => startOfDay(new Date(appointment.startTime)).getTime() === dayTime).slice(0, 2);
            return (
              <Pressable key={day.toISOString()} onPress={() => setSelectedDay(dayTime)} style={[styles.dayCell, !inMonth && styles.dayCellMuted]}>
                <Text style={[styles.dayCellNumber, selected && styles.dayCellNumberActive, !inMonth && styles.dayCellTextMuted]}>{day.getDate()}</Text>
                {events.map((event) => <Text key={event.id} numberOfLines={1} style={styles.eventPill}>{formatHour(event.startTime)}...</Text>)}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.dayTitle}>
          {capitalize(new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selectedDay)))}
        </Text>
        {dayAppointments.map((appointment) => (
          <View key={appointment.id} style={styles.event}>
            <View style={styles.timeBox}>
              <Text style={styles.time}>{formatHour(appointment.startTime)}</Text>
              <Text style={styles.duration}>{Math.round((appointment.endTime - appointment.startTime) / 60000)} min</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.title}>{appointment.title}</Text>
              <Text numberOfLines={1} style={styles.client}>{appointment.leadName || appointment.leadPhone}</Text>
            </View>
          </View>
        ))}
        {!loading && dayAppointments.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={40} color={colors.faint} />
            <Text style={styles.emptyTitle}>Sin citas este día</Text>
            <Text style={styles.emptyText}>Agenda una cita manual o revisa otro día.</Text>
          </View>
        ) : null}
      </ScrollView>
      {companyId ? <AppointmentModal visible={modalOpen} companyId={companyId} leads={leads} selectedDay={selectedDay} onClose={() => setModalOpen(false)} onSaved={load} /> : null}
    </SafeAreaView>
  );
}

function CalendarConnectionCard({ connection, loading, onRefresh, onConnect }: { connection: GoogleConnection | null; loading: boolean; onRefresh: () => void; onConnect: () => void }) {
  const connected = !!connection?.connected;
  const title = loading ? 'Revisando Google Calendar' : connected ? 'Google Calendar conectado' : 'Google Calendar desconectado';
  const detail = loading
    ? 'Validando la conexion de agenda...'
    : connected
      ? connection?.email || 'Conexion activa'
      : 'Toca aquí para conectar Google Calendar y Meet.';

  return (
    <Pressable onPress={connected ? onRefresh : onConnect} style={[styles.connectionCard, connected ? styles.connectionCardOk : styles.connectionCardWarn]}>
      <View style={[styles.connectionIcon, connected ? styles.connectionIconOk : styles.connectionIconWarn]}>
        <Ionicons
          name={loading ? 'sync-outline' : connected ? 'checkmark-circle-outline' : 'alert-circle-outline'}
          size={20}
          color={connected ? colors.emerald : colors.brand}
        />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.connectionTitle, connected ? styles.connectionTitleOk : styles.connectionTitleWarn]}>{title}</Text>
        <Text numberOfLines={2} style={styles.connectionDetail}>{detail}</Text>
      </View>
      <Ionicons name={connected ? "refresh" : "open-outline"} size={18} color={colors.muted} />
    </Pressable>
  );
}

function AppointmentModal({ visible, companyId, leads, selectedDay, onClose, onSaved }: { visible: boolean; companyId: string; leads: Lead[]; selectedDay: number; onClose: () => void; onSaved: () => void }) {
  const [leadId, setLeadId] = useState('');
  const [date, setDate] = useState(toDateInput(new Date(selectedDay)));
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('30');
  const [search, setSearch] = useState('');
  const [picker, setPicker] = useState<'date' | 'time' | 'duration' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDate(toDateInput(new Date(selectedDay)));
    setLeadId((current) => current || leads[0]?.id || '');
  }, [leads, selectedDay]);

  const selectedLead = leads.find((lead) => lead.id === leadId);
  const filteredLeads = leads
    .filter((lead) => {
      const term = search.trim().toLowerCase();
      return !term || `${lead.name ?? ''} ${lead.phone}`.toLowerCase().includes(term);
    })
    .slice(0, 12);

  const save = async () => {
    if (!leadId) return Alert.alert('Cita', 'Selecciona un lead.');
    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) return Alert.alert('Cita', 'Fecha u hora inválida.');
    setSaving(true);
    try {
      await bookAppointmentManual(companyId, { leadId, startISO: start.toISOString(), durationMinutes: Number(duration) || 30 });
      onClose();
      await onSaved();
    } catch {
      Alert.alert('No se pudo agendar', 'Revisa disponibilidad y conexión de calendario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <View style={styles.modalHeader}>
            <View><Text style={styles.modalTitle}>Agendar cita</Text><Text style={styles.modalSub}>Programa una reunion con un contacto</Text></View>
            <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
            <View style={styles.summaryCard}>
              <View style={styles.summaryIcon}><Ionicons name="calendar-outline" size={18} color={colors.brand} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={styles.summaryTitle}>{selectedLead?.name || selectedLead?.phone || 'Selecciona un contacto'}</Text>
                <Text style={styles.summaryText}>{date} a las {time} - {duration} min</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Cuando sera</Text>
            <View style={styles.fieldGrid}>
              <View style={styles.fieldHalf}><SelectField label="Fecha" value={formatDateLabel(date)} icon="calendar-outline" onPress={() => setPicker('date')} /></View>
              <View style={styles.fieldHalf}><SelectField label="Hora" value={time} icon="time-outline" onPress={() => setPicker('time')} /></View>
            </View>
            <SelectField label="Duracion" value={`${duration} min`} icon="hourglass-outline" onPress={() => setPicker('duration')} />

            <Text style={styles.sectionTitle}>Contacto</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={17} color={colors.muted} />
              <TextInput value={search} onChangeText={setSearch} placeholder="Buscar por nombre o telefono" placeholderTextColor={colors.faint} style={styles.searchInput} />
              {search ? <Ionicons onPress={() => setSearch('')} name="close-circle" size={18} color={colors.muted} /> : null}
            </View>
            <View style={styles.leadList}>
              {filteredLeads.map((lead) => (
                <Pressable key={lead.id} onPress={() => setLeadId(lead.id)} style={[styles.leadOption, leadId === lead.id && styles.leadOptionActive]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.leadOptionName}>{lead.name || lead.phone}</Text>
                    <Text style={styles.leadOptionPhone}>{lead.phone}</Text>
                  </View>
                  {leadId === lead.id ? <Ionicons name="checkmark-circle" size={20} color={colors.brand} /> : null}
                </Pressable>
              ))}
              {filteredLeads.length === 0 ? <Text style={styles.noResults}>No encontramos contactos con esa busqueda.</Text> : null}
            </View>
            <Field label="Duración minutos" value={duration} onChangeText={setDuration} />
          </ScrollView>
          <View style={styles.modalFooter}>
            <Pressable disabled={saving || !leadId} onPress={save} style={[styles.addButton, (saving || !leadId) && styles.addButtonDisabled]}>
              <Ionicons name="calendar-outline" size={18} color={colors.background} />
              <Text style={styles.addButtonText}>{saving ? 'Guardando...' : 'Guardar cita'}</Text>
            </Pressable>
          </View>
          <AppointmentPickerSheet
            picker={picker}
            date={date}
            time={time}
            duration={duration}
            onDate={setDate}
            onTime={setTime}
            onDuration={setDuration}
            onClose={() => setPicker(null)}
          />
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function SelectField({ label, value, icon, onPress }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        <Ionicons name={icon} size={16} color={colors.muted} />
        <Text numberOfLines={1} style={styles.selectValue}>{value}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.faint} />
      </View>
    </Pressable>
  );
}

function AppointmentPickerSheet({
  picker,
  date,
  time,
  duration,
  onDate,
  onTime,
  onDuration,
  onClose,
}: {
  picker: 'date' | 'time' | 'duration' | null;
  date: string;
  time: string;
  duration: string;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
  onDuration: (value: string) => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(startOfMonth(parseDateInput(date) ?? new Date()).getTime());
  useEffect(() => {
    if (picker === 'date') setMonth(startOfMonth(parseDateInput(date) ?? new Date()).getTime());
  }, [date, picker]);

  if (!picker) return null;

  const monthDate = new Date(month);
  const monthDays = buildMonthGrid(monthDate);
  const title = picker === 'date' ? 'Selecciona fecha' : picker === 'time' ? 'Selecciona hora' : 'Duracion';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={onClose} style={styles.sheetClose}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        {picker === 'date' ? (
          <>
            <View style={styles.sheetMonthRow}>
              <Pressable onPress={() => setMonth(addMonths(month, -1))} style={styles.monthButton}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable>
              <Text style={styles.sheetMonth}>{capitalize(new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(monthDate))}</Text>
              <Pressable onPress={() => setMonth(addMonths(month, 1))} style={styles.monthButton}><Ionicons name="chevron-forward" size={20} color={colors.text} /></Pressable>
            </View>
            <View style={styles.sheetCalendar}>
              {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((day, index) => <Text key={`${day}-${index}`} style={styles.sheetWeekday}>{day}</Text>)}
              {monthDays.map((day) => {
                const value = toDateInput(day);
                const selected = value === date;
                const inMonth = day.getMonth() === monthDate.getMonth();
                return (
                  <Pressable key={day.toISOString()} onPress={() => { onDate(value); onClose(); }} style={[styles.sheetDay, selected && styles.sheetDayActive]}>
                    <Text style={[styles.sheetDayText, !inMonth && styles.sheetDayMuted, selected && styles.sheetDayTextActive]}>{day.getDate()}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <View style={styles.optionGrid}>
            {(picker === 'time' ? timeOptions : durationOptions).map((value) => {
              const selected = picker === 'time' ? value === time : value === duration;
              return (
                <Pressable
                  key={value}
                  onPress={() => {
                    if (picker === 'time') onTime(value);
                    else onDuration(value);
                    onClose();
                  }}
                  style={[styles.optionPill, selected && styles.optionPillActive]}
                >
                  <Text style={[styles.optionText, selected && styles.optionTextActive]}>{picker === 'duration' ? `${value} min` : value}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

function Field({ label, value, onChangeText, placeholder, icon }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  if (!icon && label.toLowerCase().includes('minutos')) return null;

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputWrap}>
        {icon ? <Ionicons name={icon} size={16} color={colors.muted} /> : null}
        <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.faint} style={styles.input} />
      </View>
    </View>
  );
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(monthMs: number, count: number) {
  const date = new Date(monthMs);
  return new Date(date.getFullYear(), date.getMonth() + count, 1).getTime();
}

function buildMonthGrid(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function toDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateInput(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatDateLabel(value: string) {
  const date = parseDateInput(value);
  return date ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' }).format(date) : value;
}

function formatHour(value: number) {
  return new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(value);
}

function capitalize(value: string) {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 34, gap: 14 },
  headerAdd: { minHeight: 34, borderRadius: 8, backgroundColor: colors.brand, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  headerAddText: { color: colors.background, fontSize: 12, fontWeight: '900' },
  connectionCard: { minHeight: 76, borderRadius: 8, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 11 },
  connectionCardOk: { borderColor: '#0B6B55', backgroundColor: colors.emeraldDark },
  connectionCardWarn: { borderColor: colors.brandBorder, backgroundColor: colors.brandDark },
  connectionIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  connectionIconOk: { backgroundColor: '#052C24' },
  connectionIconWarn: { backgroundColor: colors.background },
  connectionTitle: { fontSize: 13, fontWeight: '900' },
  connectionTitleOk: { color: colors.emerald },
  connectionTitleWarn: { color: colors.brand },
  connectionDetail: { color: colors.text, fontSize: 11, lineHeight: 15, marginTop: 3 },
  monthControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthButton: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  todayButton: { height: 34, borderRadius: 7, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, justifyContent: 'center' },
  todayText: { color: colors.text, fontSize: 12, fontWeight: '800' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.background },
  weekday: { width: `${100 / 7}%`, height: 32, color: colors.muted, fontSize: 10, textAlign: 'center', textAlignVertical: 'center', borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 0.82, padding: 6, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  dayCellMuted: { backgroundColor: colors.raised },
  dayCellNumber: { color: '#C7D2E5', fontSize: 10, marginBottom: 5 },
  dayCellNumberActive: { alignSelf: 'flex-start', minWidth: 19, height: 19, borderRadius: 10, overflow: 'hidden', backgroundColor: colors.brand, color: colors.background, textAlign: 'center', textAlignVertical: 'center', fontWeight: '900' },
  dayCellTextMuted: { color: colors.faint },
  eventPill: { minHeight: 18, borderRadius: 4, backgroundColor: '#12354A', color: '#7ED6FF', fontSize: 9, paddingHorizontal: 4, marginTop: 2 },
  dayTitle: { color: colors.text, textTransform: 'capitalize', fontSize: 15, fontWeight: '900', marginTop: 4 },
  event: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
  timeBox: { width: 58 },
  time: { color: colors.brand, fontSize: 13, fontWeight: '900' },
  duration: { color: colors.faint, fontSize: 9, marginTop: 3 },
  title: { color: colors.text, fontSize: 13, fontWeight: '800' },
  client: { color: colors.muted, fontSize: 11, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 70 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '800', marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 11, marginTop: 5 },
  modalSafe: { flex: 1, backgroundColor: colors.background },
  modalHeader: { minHeight: 68, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  modalTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  modalSub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  closeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  modalContent: { padding: 16, gap: 12, paddingBottom: 20 },
  summaryCard: { minHeight: 72, borderRadius: 8, borderWidth: 1, borderColor: colors.brandBorder, backgroundColor: colors.brandDark, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  summaryTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  summaryText: { color: colors.muted, fontSize: 11, marginTop: 4 },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '900', marginTop: 4 },
  fieldGrid: { flexDirection: 'row', gap: 10 },
  fieldHalf: { flex: 1 },
  fieldBlock: { gap: 6 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  inputWrap: { minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  selectValue: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '800' },
  searchBox: { minHeight: 46, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, color: colors.text, fontSize: 13, paddingVertical: 0 },
  leadList: { gap: 8 },
  leadOption: { minHeight: 58, padding: 11, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadOptionActive: { borderColor: colors.brandBorder, backgroundColor: colors.brandDark },
  leadOptionName: { color: colors.text, fontSize: 13, fontWeight: '800' },
  leadOptionPhone: { color: colors.muted, fontSize: 11, marginTop: 3 },
  noResults: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingVertical: 18 },
  modalFooter: { padding: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  addButton: { minHeight: 44, borderRadius: 8, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  addButtonDisabled: { opacity: 0.55 },
  addButtonText: { color: colors.background, fontSize: 13, fontWeight: '900' },
  sheetOverlay: { flex: 1, backgroundColor: '#00000088' },
  sheet: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sheetClose: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  sheetMonthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sheetMonth: { color: colors.text, fontSize: 14, fontWeight: '900', textTransform: 'capitalize' },
  sheetCalendar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sheetWeekday: { width: `${100 / 7 - 1}%`, color: colors.muted, textAlign: 'center', fontSize: 11, fontWeight: '800' },
  sheetDay: { width: `${100 / 7 - 1}%`, aspectRatio: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.raised },
  sheetDayActive: { backgroundColor: colors.brand },
  sheetDayText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  sheetDayMuted: { color: colors.faint },
  sheetDayTextActive: { color: colors.background },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 4 },
  optionPill: { minWidth: 74, minHeight: 42, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.raised, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  optionPillActive: { borderColor: colors.brandBorder, backgroundColor: colors.brandDark },
  optionText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  optionTextActive: { color: colors.brand },
});
