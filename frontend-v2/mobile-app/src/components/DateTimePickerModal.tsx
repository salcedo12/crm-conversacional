import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';

// ─── HELPER FORMATTERS ────────────────────────────────────────────────────────

const MONTH_NAMES_ES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

const WEEKDAYS_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  const dateObj = new Date(y, m, d);
  if (isNaN(dateObj.getTime())) return dateStr;

  const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const dayName = dayNames[dateObj.getDay()];
  const monthName = MONTH_NAMES_ES[m] ? MONTH_NAMES_ES[m].slice(0, 3) : '';
  return `${dayName}, ${d} ${monthName} ${y}`;
}

export function formatDisplayTime(timeStr: string): string {
  if (!timeStr) return '';
  const parts = timeStr.trim().split(':');
  if (parts.length < 2) return timeStr;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return timeStr;

  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mPad = m < 10 ? `0${m}` : `${m}`;
  return `${h12}:${mPad} ${period}`;
}

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── DATE PICKER MODAL ────────────────────────────────────────────────────────

interface DatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  value: string; // YYYY-MM-DD
  onSelect: (dateStr: string) => void;
  title?: string;
}

export function DatePickerModal({
  visible,
  onClose,
  value,
  onSelect,
  title = 'Seleccionar Fecha',
}: DatePickerModalProps) {
  const { palette } = useTheme();

  // Current calendar view month & year
  const initialDate = useMemo(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split('-').map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  }, [value]);

  const [viewYear, setViewYear] = useState(() => initialDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => initialDate.getMonth());

  useEffect(() => {
    if (visible) {
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      } else {
        const now = new Date();
        setViewYear(now.getFullYear());
        setViewMonth(now.getMonth());
      }
    }
  }, [visible, value]);

  const todayYMD = useMemo(() => toYMD(new Date()), []);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  // Build calendar matrix (Monday-first)
  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    // JS getDay(): 0 = Sun, 1 = Mon, ..., 6 = Sat
    // Convert to Monday = 0: (day + 6) % 7
    const startOffset = (firstDay.getDay() + 6) % 7;

    const cells: Array<{ day: number | null; ymd: string }> = [];

    // Leading blanks
    for (let i = 0; i < startOffset; i++) {
      cells.push({ day: null, ymd: '' });
    }

    // Days in current month
    for (let d = 1; d <= daysInMonth; d++) {
      const mStr = String(viewMonth + 1).padStart(2, '0');
      const dStr = String(d).padStart(2, '0');
      cells.push({ day: d, ymd: `${viewYear}-${mStr}-${dStr}` });
    }

    return cells;
  }, [viewYear, viewMonth]);

  // Quick date shortcuts
  const shortcuts = useMemo(() => {
    const now = new Date();
    const addDays = (n: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + n);
      return toYMD(d);
    };

    // Next Monday
    const getNextMonday = () => {
      const d = new Date(now);
      const day = d.getDay();
      const diff = (8 - day) % 7 || 7;
      d.setDate(d.getDate() + diff);
      return toYMD(d);
    };

    return [
      { label: 'Hoy', ymd: toYMD(now) },
      { label: 'Mañana', ymd: addDays(1) },
      { label: '+2 Días', ymd: addDays(2) },
      { label: '+3 Días', ymd: addDays(3) },
      { label: 'Próx. Lunes', ymd: getNextMonday() },
      { label: '+1 Semana', ymd: addDays(7) },
    ];
  }, []);

  const handleSelect = (ymd: string) => {
    onSelect(ymd);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
            <View style={styles.modalHeaderLeft}>
              <Icon name="Calendar" size={17} color="#10b981" />
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>{title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Icon name="X" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          {/* Quick Shortcuts */}
          <View style={styles.shortcutsWrap}>
            <Text style={[styles.shortcutsLabel, { color: palette.textSubtle }]}>Acceso rápido:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutsRow}>
              {shortcuts.map((sc) => {
                const isSelected = value === sc.ymd;
                return (
                  <Pressable
                    key={sc.label}
                    onPress={() => handleSelect(sc.ymd)}
                    style={[
                      styles.shortcutChip,
                      {
                        backgroundColor: isSelected ? '#059669' : palette.bgElevated,
                        borderColor: isSelected ? '#10b981' : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.shortcutChipText,
                        { color: isSelected ? '#ffffff' : palette.textSecondary, fontWeight: isSelected ? '700' : '500' },
                      ]}
                    >
                      {sc.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Month / Year Navigator */}
          <View style={styles.calendarNavRow}>
            <Pressable onPress={handlePrevMonth} hitSlop={12} style={[styles.navArrowBtn, { backgroundColor: palette.bgElevated }]}>
              <Icon name="ChevronLeft" size={16} color={palette.textPrimary} />
            </Pressable>
            <Text style={[styles.monthYearTitle, { color: palette.textPrimary }]}>
              {MONTH_NAMES_ES[viewMonth]} {viewYear}
            </Text>
            <Pressable onPress={handleNextMonth} hitSlop={12} style={[styles.navArrowBtn, { backgroundColor: palette.bgElevated }]}>
              <Icon name="ChevronRight" size={16} color={palette.textPrimary} />
            </Pressable>
          </View>

          {/* Weekday Labels (Lun - Dom) */}
          <View style={styles.weekdaysRow}>
            {WEEKDAYS_SHORT_ES.map((wd) => (
              <Text key={wd} style={[styles.weekdayLabel, { color: palette.textSubtle }]}>
                {wd}
              </Text>
            ))}
          </View>

          {/* Days Grid */}
          <View style={styles.daysGrid}>
            {calendarDays.map((cell, idx) => {
              if (cell.day === null) {
                return <View key={`blank-${idx}`} style={styles.dayCellPlaceholder} />;
              }
              const isSelected = value === cell.ymd;
              const isToday = cell.ymd === todayYMD;

              return (
                <Pressable
                  key={cell.ymd}
                  onPress={() => handleSelect(cell.ymd)}
                  style={styles.dayCellTouch}
                >
                  <View
                    style={[
                      styles.dayCellCircle,
                      isSelected && { backgroundColor: '#059669' },
                      isToday && !isSelected && { borderWidth: 1.5, borderColor: '#10b981' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayCellText,
                        { color: isSelected ? '#ffffff' : palette.textPrimary },
                        isSelected && { fontWeight: '800' },
                        isToday && !isSelected && { color: '#10b981', fontWeight: '700' },
                      ]}
                    >
                      {cell.day}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Footer with Clear Date option */}
          <View style={[styles.modalFooter, { borderTopColor: palette.border }]}>
            {value ? (
              <Pressable onPress={() => handleSelect('')} style={styles.clearBtn}>
                <Icon name="X" size={14} color="#f43f5e" />
                <Text style={{ fontSize: 12, color: '#f43f5e', fontWeight: '600' }}>Limpiar fecha (Sin agendar)</Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} />
            )}
            <Pressable onPress={onClose} style={[styles.closeModalBtn, { backgroundColor: palette.bgElevated }]}>
              <Text style={[styles.closeModalBtnText, { color: palette.textPrimary }]}>Cerrar</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── TIME PICKER MODAL ────────────────────────────────────────────────────────

interface TimePickerModalProps {
  visible: boolean;
  onClose: () => void;
  value: string; // HH:MM
  onSelect: (timeStr: string) => void;
  title?: string;
}

const BUSINESS_HOURS_AM = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'];
const BUSINESS_HOURS_PM = ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00'];

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES_LIST = [0, 10, 15, 20, 30, 40, 45, 50];

export function TimePickerModal({
  visible,
  onClose,
  value,
  onSelect,
  title = 'Seleccionar Hora de Contacto',
}: TimePickerModalProps) {
  const { palette } = useTheme();

  // Internal state for hour (1-12), minute (0-59), period (AM/PM)
  const [selectedH12, setSelectedH12] = useState(10);
  const [selectedM, setSelectedM] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState<'AM' | 'PM'>('AM');

  useEffect(() => {
    if (visible) {
      if (value && /^\d{1,2}:\d{2}$/.test(value.trim())) {
        const [hStr, mStr] = value.trim().split(':');
        const h24 = parseInt(hStr, 10);
        const m = parseInt(mStr, 10);
        if (!isNaN(h24) && !isNaN(m)) {
          setSelectedPeriod(h24 >= 12 ? 'PM' : 'AM');
          setSelectedH12(h24 % 12 === 0 ? 12 : h24 % 12);
          setSelectedM(m);
          return;
        }
      }
      // Default to 10:00 AM
      setSelectedH12(10);
      setSelectedM(0);
      setSelectedPeriod('AM');
    }
  }, [visible, value]);

  const currentFormattedTime24 = useMemo(() => {
    let h24 = selectedH12;
    if (selectedPeriod === 'PM' && h24 < 12) h24 += 12;
    if (selectedPeriod === 'AM' && h24 === 12) h24 = 0;
    return `${String(h24).padStart(2, '0')}:${String(selectedM).padStart(2, '0')}`;
  }, [selectedH12, selectedM, selectedPeriod]);

  const handleQuickSelect = (time24: string) => {
    onSelect(time24);
    onClose();
  };

  const handleConfirmCustom = () => {
    onSelect(currentFormattedTime24);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={[styles.modalHeader, { borderBottomColor: palette.border }]}>
            <View style={styles.modalHeaderLeft}>
              <Icon name="Clock" size={17} color="#10b981" />
              <Text style={[styles.modalTitle, { color: palette.textPrimary }]}>{title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Icon name="X" size={18} color={palette.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            {/* Big Clock Preview */}
            <View style={[styles.timePreviewCard, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
              <View style={styles.timePreviewDigitsRow}>
                <Text style={[styles.timePreviewDigits, { color: palette.textPrimary }]}>
                  {String(selectedH12).padStart(2, '0')}:{String(selectedM).padStart(2, '0')}
                </Text>
                <View style={styles.periodToggleRow}>
                  <Pressable
                    onPress={() => setSelectedPeriod('AM')}
                    style={[
                      styles.periodPill,
                      selectedPeriod === 'AM' && { backgroundColor: '#059669' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.periodPillText,
                        { color: selectedPeriod === 'AM' ? '#ffffff' : palette.textMuted },
                      ]}
                    >
                      AM
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setSelectedPeriod('PM')}
                    style={[
                      styles.periodPill,
                      selectedPeriod === 'PM' && { backgroundColor: '#059669' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.periodPillText,
                        { color: selectedPeriod === 'PM' ? '#ffffff' : palette.textMuted },
                      ]}
                    >
                      PM
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {/* Quick Presets: Mañana */}
            <View style={styles.sectionWrap}>
              <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>☀️ Horas habituales mañana:</Text>
              <View style={styles.wrapChipRow}>
                {BUSINESS_HOURS_AM.map((t24) => {
                  const isCurrent = currentFormattedTime24 === t24;
                  return (
                    <Pressable
                      key={t24}
                      onPress={() => handleQuickSelect(t24)}
                      style={[
                        styles.timeChip,
                        {
                          backgroundColor: isCurrent ? '#059669' : palette.bgElevated,
                          borderColor: isCurrent ? '#10b981' : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeChipText,
                          { color: isCurrent ? '#ffffff' : palette.textPrimary, fontWeight: isCurrent ? '700' : '500' },
                        ]}
                      >
                        {formatDisplayTime(t24)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Quick Presets: Tarde */}
            <View style={styles.sectionWrap}>
              <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>🌤️ Horas habituales tarde:</Text>
              <View style={styles.wrapChipRow}>
                {BUSINESS_HOURS_PM.map((t24) => {
                  const isCurrent = currentFormattedTime24 === t24;
                  return (
                    <Pressable
                      key={t24}
                      onPress={() => handleQuickSelect(t24)}
                      style={[
                        styles.timeChip,
                        {
                          backgroundColor: isCurrent ? '#059669' : palette.bgElevated,
                          borderColor: isCurrent ? '#10b981' : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.timeChipText,
                          { color: isCurrent ? '#ffffff' : palette.textPrimary, fontWeight: isCurrent ? '700' : '500' },
                        ]}
                      >
                        {formatDisplayTime(t24)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Custom Hour Grid */}
            <View style={styles.sectionWrap}>
              <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>Hora exacta (1 - 12):</Text>
              <View style={styles.wrapChipRow}>
                {HOURS_12.map((h) => {
                  const isSelected = selectedH12 === h;
                  return (
                    <Pressable
                      key={`h-${h}`}
                      onPress={() => setSelectedH12(h)}
                      style={[
                        styles.hourNumberBtn,
                        {
                          backgroundColor: isSelected ? '#059669' : palette.bgElevated,
                          borderColor: isSelected ? '#10b981' : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.hourNumberText,
                          { color: isSelected ? '#ffffff' : palette.textPrimary, fontWeight: isSelected ? '800' : '500' },
                        ]}
                      >
                        {h}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Custom Minutes Grid */}
            <View style={styles.sectionWrap}>
              <Text style={[styles.sectionTitle, { color: palette.textSubtle }]}>Minutos:</Text>
              <View style={styles.wrapChipRow}>
                {MINUTES_LIST.map((m) => {
                  const isSelected = selectedM === m;
                  return (
                    <Pressable
                      key={`m-${m}`}
                      onPress={() => setSelectedM(m)}
                      style={[
                        styles.minNumberBtn,
                        {
                          backgroundColor: isSelected ? '#059669' : palette.bgElevated,
                          borderColor: isSelected ? '#10b981' : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.minNumberText,
                          { color: isSelected ? '#ffffff' : palette.textPrimary, fontWeight: isSelected ? '800' : '500' },
                        ]}
                      >
                        :{String(m).padStart(2, '0')}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </ScrollView>

          {/* Confirm Button */}
          <View style={[styles.modalFooter, { borderTopColor: palette.border }]}>
            <Pressable onPress={handleConfirmCustom} style={styles.confirmTimeBtn}>
              <Icon name="Check" size={16} color="#ffffff" />
              <Text style={styles.confirmTimeBtnText}>
                Confirmar Hora: {formatDisplayTime(currentFormattedTime24)}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 24,
    maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 4,
  },
  shortcutsWrap: {
    paddingTop: 10,
    paddingBottom: 8,
    gap: 6,
  },
  shortcutsLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  shortcutsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  shortcutChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  shortcutChipText: {
    fontSize: 11,
  },
  calendarNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  navArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthYearTitle: {
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 6,
  },
  weekdayLabel: {
    width: 40,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    paddingVertical: 4,
  },
  dayCellPlaceholder: {
    width: '14.28%',
    height: 40,
  },
  dayCellTouch: {
    width: '14.28%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellText: {
    fontSize: 13,
    fontWeight: '500',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    marginTop: 8,
    gap: 8,
  },
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  closeModalBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  closeModalBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  timePreviewCard: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timePreviewDigitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  timePreviewDigits: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  periodToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  periodPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  periodPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  sectionWrap: {
    paddingVertical: 6,
    gap: 6,
  },
  sectionTitle: {
    fontSize: 10.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  wrapChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timeChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  timeChipText: {
    fontSize: 11.5,
  },
  hourNumberBtn: {
    width: 44,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hourNumberText: {
    fontSize: 13,
  },
  minNumberBtn: {
    width: 52,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  minNumberText: {
    fontSize: 12.5,
  },
  confirmTimeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#059669',
    paddingVertical: 11,
    borderRadius: 10,
  },
  confirmTimeBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
