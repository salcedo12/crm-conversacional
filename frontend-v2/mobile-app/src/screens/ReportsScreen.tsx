import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  compileMobileCommercialReport,
  MERAKI_OFFICIAL_ADVISORS,
  type CommercialExecutiveReportData,
  type CommercialPeriodShortcut,
  type AdvisorReportRow,
} from '../services/commercialReports';
import { isAdminRole, type RootStackParams } from '../types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { SelectModal, type SelectOption } from '../components/SelectModal';
import { AdvisorLeadsDrilldownModal, type DrilldownFilterType } from '../components/AdvisorLeadsDrilldownModal';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';

type Props = NativeStackScreenProps<RootStackParams, 'Reports'>;

type MainViewTab = 'commercial_executive' | 'sales' | '317';

const CALENDAR_MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CALENDAR_WEEKDAYS_ES = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];

function isSameDay(d1: Date | null, d2: Date | null): boolean {
  if (!d1 || !d2) return false;
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function ReportsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { palette, isDark } = useTheme();
  const auth = useAuth();
  const { companyId, profile, user, role, platformAdmin } = auth;
  const isAdmin = Boolean(
    (auth as { isAdmin?: boolean }).isAdmin ?? (isAdminRole(role) || platformAdmin)
  );

  const currentUserId = user?.uid || '';
  const currentUserName = profile?.displayName || user?.displayName || user?.email || 'Asesor Comercial';

  // Pestaña principal de visualización
  const [mainTab, setMainTab] = useState<MainViewTab>('commercial_executive');

  // Estado del Informe Semanal Oficial
  const [periodShortcut, setPeriodShortcut] = useState<CommercialPeriodShortcut>('current_week');
  const [reportData, setReportData] = useState<CommercialExecutiveReportData | null>(null);
  const [loadingReport, setLoadingReport] = useState(true);
  const [refreshingReport, setRefreshingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // Filtro de asesor para administradores
  const [adminAdvisorFilter, setAdminAdvisorFilter] = useState<string>('all');

  // Estado del Desplegable del Calendario Interactivo
  const [showCalendarDropdown, setShowCalendarDropdown] = useState(false);
  const [calendarViewDate, setCalendarViewDate] = useState<Date>(() => new Date());
  const [selectedRangeStart, setSelectedRangeStart] = useState<Date | null>(() => {
    // Viernes de esta semana por defecto (ciclo comercial viernes a viernes)
    const now = new Date();
    const day = now.getDay();
    const diff = day === 5 ? 7 : (day > 5 ? day - 5 : day + 2);
    const fri = new Date(now);
    fri.setDate(now.getDate() - diff);
    fri.setHours(0, 0, 0, 0);
    return fri;
  });
  const [selectedRangeEnd, setSelectedRangeEnd] = useState<Date | null>(() => new Date());

  // Estado del Modal interactivo de prospectos
  const [drilldownState, setDrilldownState] = useState<{
    isOpen: boolean;
    advisorId: string;
    scope: 'period' | 'month';
    filter: DrilldownFilterType;
  }>({
    isOpen: false,
    advisorId: 'all',
    scope: 'period',
    filter: 'all',
  });

  // Estado del Modal de Ficha Técnica
  const [fichaModalLeadId, setFichaModalLeadId] = useState<string | null>(null);

  // Cargar Informe Semanal
  const loadCommercialReport = useCallback(
    async (
      shortcut: CommercialPeriodShortcut,
      isPullToRefresh = false,
      customStart?: Date,
      customEnd?: Date,
      targetAdvisor?: string
    ) => {
      if (!companyId) return;
      if (isPullToRefresh) setRefreshingReport(true);
      else setLoadingReport(true);
      setReportError(null);

      try {
        const effectiveAdvisor = targetAdvisor !== undefined ? targetAdvisor : adminAdvisorFilter;
        const data = await compileMobileCommercialReport(companyId, {
          shortcut,
          customStartDate: customStart,
          customEndDate: customEnd,
          isUserAdmin: isAdmin,
          currentUserId,
          currentUserName,
          targetAdvisorFilter: effectiveAdvisor,
        });
        setReportData(data);
      } catch (err: any) {
        console.error('[ReportsScreen] Error compiling report:', err);
        setReportError('No se pudo generar el informe comercial. Por favor verifica tu conexión.');
      } finally {
        setLoadingReport(false);
        setRefreshingReport(false);
      }
    },
    [companyId, isAdmin, currentUserId, currentUserName, adminAdvisorFilter]
  );

  useEffect(() => {
    loadCommercialReport(periodShortcut);
  }, [loadCommercialReport, periodShortcut]);

  const handleOpenDrilldown = (options?: {
    advisorId?: string;
    scope?: 'period' | 'month';
    filter?: DrilldownFilterType;
  }) => {
    const isIndiv = !isAdmin || Boolean(reportData?.isIndividualReport);
    const effectiveAdvisorId = isIndiv
      ? reportData?.advisorRows?.[0]?.advisorId || reportData?.targetAdvisorId || currentUserId || currentUserName || 'all'
      : options?.advisorId || 'all';

    setDrilldownState({
      isOpen: true,
      advisorId: effectiveAdvisorId,
      scope: options?.scope || 'period',
      filter: options?.filter || 'all',
    });
  };

  const handleOpenChat = (leadId: string) => {
    navigation.navigate('Chat', { leadId });
  };

  const handleOpenFicha = (leadId: string) => {
    setFichaModalLeadId(leadId);
  };

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Main');
  };

  // Opciones de Asesor para Administradores (Dinámico desde el reporte o fallback oficial)
  const advisorFilterOptions = useMemo<SelectOption[]>(() => {
    const list: SelectOption[] = [
      { value: 'all', label: '👥 Todo el Equipo (Consolidado Gerencial)' },
    ];
    if (reportData?.allAdvisorsList && reportData.allAdvisorsList.length > 0) {
      reportData.allAdvisorsList.forEach((adv) => {
        list.push({ value: adv.name, label: `👤 ${adv.name}` });
      });
    } else if (reportData?.advisorRows && reportData.advisorRows.length > 0) {
      reportData.advisorRows.forEach((row) => {
        list.push({ value: row.advisorName, label: `👤 ${row.advisorName}` });
      });
    } else {
      MERAKI_OFFICIAL_ADVISORS.forEach((name) => {
        list.push({ value: name, label: `👤 ${name}` });
      });
    }
    return list;
  }, [reportData?.allAdvisorsList, reportData?.advisorRows]);

  // Manejo de clicks en el calendario interactivo
  const handleCalendarDayPress = (dayDate: Date) => {
    if (!selectedRangeStart || (selectedRangeStart && selectedRangeEnd)) {
      setSelectedRangeStart(dayDate);
      setSelectedRangeEnd(null);
    } else {
      if (dayDate < selectedRangeStart) {
        setSelectedRangeStart(dayDate);
        setSelectedRangeEnd(null);
      } else {
        setSelectedRangeEnd(dayDate);
      }
    }
  };

  const handlePrevMonth = () => {
    setCalendarViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCalendarViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
  };

  const handleTodayCalendar = () => {
    const today = new Date();
    setCalendarViewDate(today);
    setSelectedRangeStart(today);
    setSelectedRangeEnd(today);
  };

  const handleGenerateCustomReport = () => {
    if (!selectedRangeStart) {
      Alert.alert('Seleccionar fecha', 'Por favor selecciona al menos un día en el calendario.');
      return;
    }
    const start = new Date(selectedRangeStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(selectedRangeEnd || selectedRangeStart);
    end.setHours(23, 59, 59, 999);

    setPeriodShortcut('custom');
    loadCommercialReport('custom', false, start, end, adminAdvisorFilter);
  };

  // Días para renderizar la cuadrícula del mes
  const calendarDays = useMemo(() => {
    const year = calendarViewDate.getFullYear();
    const month = calendarViewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // En JS getDay() da 0=Domingo, 1=Lunes, ... 6=Sábado.
    // Convertimos a Lunes=0, Domingo=6:
    const startDayIndex = (firstDay.getDay() + 6) % 7;

    const list: (Date | null)[] = [];
    for (let i = 0; i < startDayIndex; i++) {
      list.push(null);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      list.push(new Date(year, month, d));
    }
    return list;
  }, [calendarViewDate]);

  // Totales de la tabla para Administradores (1:1 con Web)
  const totalCaptSemana = useMemo(() => {
    return reportData?.advisorRows.reduce((acc, r) => acc + r.captSemana, 0) || 0;
  }, [reportData]);

  const totalCaptMes = useMemo(() => {
    return reportData?.advisorRows.reduce((acc, r) => acc + r.captMes, 0) || 0;
  }, [reportData]);

  const totalVentasSemana = useMemo(() => {
    return reportData?.advisorRows.reduce((acc, r) => acc + r.ventasSemana, 0) || 0;
  }, [reportData]);

  const totalVentasMes = useMemo(() => {
    return reportData?.advisorRows.reduce((acc, r) => acc + r.ventasMes, 0) || 0;
  }, [reportData]);

  const totalClientesConSeguimiento = useMemo(() => {
    return (
      reportData?.kpis.clientesGestionadosPeriodo ||
      reportData?.advisorRows.reduce((acc, r) => acc + r.clientesConSeguimiento, 0) ||
      0
    );
  }, [reportData]);

  const totalLeadsConSeguimiento = useMemo(() => {
    return reportData?.advisorRows.reduce((acc, r) => acc + r.leadsSemConSeguimiento, 0) || 0;
  }, [reportData]);

  const totalClientesAnteriores = useMemo(() => {
    return Math.max(0, totalClientesConSeguimiento - totalLeadsConSeguimiento);
  }, [totalClientesConSeguimiento, totalLeadsConSeguimiento]);

  const avgCobertura = useMemo(() => {
    if (!totalCaptSemana) return 0;
    return Math.round((totalLeadsConSeguimiento / totalCaptSemana) * 100);
  }, [totalCaptSemana, totalLeadsConSeguimiento]);

  const totalAvanceMes = useMemo(() => {
    const target = (reportData?.advisorRows.length || 11) * 100;
    if (!target) return 0;
    return Math.min(100, Math.round((totalCaptMes / target) * 100));
  }, [reportData, totalCaptMes]);

  return (
    <View style={[styles.root, { backgroundColor: isDark ? '#09090b' : '#f8fafc' }]}>
      {/* HEADER PRINCIPAL */}
      <ScreenHeader
        title={isAdmin ? 'Generador de Informes Gerenciales' : 'Mi Informe Comercial'}
        subtitle={
          isAdmin
            ? 'Consolidado semanal de captaciones y auditoría comercial'
            : `Gestión y avances semanales de ${currentUserName}`
        }
        onBack={handleBack}
        action={
          <Pressable
            onPress={() => loadCommercialReport(periodShortcut, true)}
            style={[styles.reloadBtn, { backgroundColor: isDark ? '#27272a' : '#f4f4f5' }]}
            hitSlop={8}
          >
            <Icon name="RefreshCw" size={15} color={palette.textPrimary} />
          </Pressable>
        }
      />

      {/* SELECTOR DE VISTAS (INFORME SEMANAL VS VENTAS VS 317) */}
      <View style={[styles.tabSelectorBar, { backgroundColor: isDark ? '#111114' : '#ffffff', borderBottomColor: isDark ? '#27272a' : '#e4e4e7' }]}>
        <Pressable
          onPress={() => setMainTab('commercial_executive')}
          style={[
            styles.tabSelectorBtn,
            mainTab === 'commercial_executive' && [
              styles.tabSelectorBtnActive,
              { borderBottomColor: isDark ? '#f59e0b' : '#d97706', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#fef3c7' },
            ],
          ]}
        >
          <Icon name="FileText" size={13} color={mainTab === 'commercial_executive' ? '#f59e0b' : palette.textSubtle} />
          <Text
            style={[
              styles.tabSelectorText,
              { color: mainTab === 'commercial_executive' ? (isDark ? '#f59e0b' : '#b45309') : palette.textSubtle },
              mainTab === 'commercial_executive' && { fontWeight: '800' },
            ]}
          >
            {isAdmin ? 'Informe Semanal IA ✨' : 'Mi Informe Semanal ✨'}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMainTab('sales')}
          style={[
            styles.tabSelectorBtn,
            mainTab === 'sales' && [
              styles.tabSelectorBtnActive,
              { borderBottomColor: isDark ? '#f59e0b' : '#d97706', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#fef3c7' },
            ],
          ]}
        >
          <Icon name="DollarSign" size={13} color={mainTab === 'sales' ? '#f59e0b' : palette.textSubtle} />
          <Text
            style={[
              styles.tabSelectorText,
              { color: mainTab === 'sales' ? (isDark ? '#f59e0b' : '#b45309') : palette.textSubtle },
              mainTab === 'sales' && { fontWeight: '800' },
            ]}
          >
            Ventas
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setMainTab('317')}
          style={[
            styles.tabSelectorBtn,
            mainTab === '317' && [
              styles.tabSelectorBtnActive,
              { borderBottomColor: isDark ? '#f59e0b' : '#d97706', backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#fef3c7' },
            ],
          ]}
        >
          <Icon name="Clock" size={13} color={mainTab === '317' ? '#f59e0b' : palette.textSubtle} />
          <Text
            style={[
              styles.tabSelectorText,
              { color: mainTab === '317' ? (isDark ? '#f59e0b' : '#b45309') : palette.textSubtle },
              mainTab === '317' && { fontWeight: '800' },
            ]}
          >
            Informe 317
          </Text>
        </Pressable>
      </View>

      {/* CONTENIDO PRINCIPAL: INFORME SEMANAL DE GESTIÓN COMERCIAL */}
      {mainTab === 'commercial_executive' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshingReport}
              onRefresh={() => loadCommercialReport(periodShortcut, true)}
              tintColor="#f59e0b"
            />
          }
        >
          {/* BARRA DE ATAJOS DE FECHA Y BOTÓN DE CALENDARIO */}
          <View style={styles.shortcutsSection}>
            <Text style={[styles.shortcutsLabel, { color: palette.textSubtle }]}>ATAJOS DE PERÍODO:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcutsRow}>
              <Pressable
                onPress={() => {
                  setPeriodShortcut('current_week');
                  setShowCalendarDropdown(false);
                }}
                style={[
                  styles.shortcutPill,
                  periodShortcut === 'current_week'
                    ? styles.shortcutPillActive
                    : { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? '#27272a' : '#cbd5e1' },
                ]}
              >
                <Text
                  style={[
                    styles.shortcutPillText,
                    { color: periodShortcut === 'current_week' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  ⚡ Esta Semana en Curso (Viernes a Hoy)
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setPeriodShortcut('previous_week');
                  setShowCalendarDropdown(false);
                }}
                style={[
                  styles.shortcutPill,
                  periodShortcut === 'previous_week'
                    ? styles.shortcutPillActive
                    : { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? '#27272a' : '#cbd5e1' },
                ]}
              >
                <Text
                  style={[
                    styles.shortcutPillText,
                    { color: periodShortcut === 'previous_week' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  Semana Anterior Cerrada
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setPeriodShortcut('month');
                  setShowCalendarDropdown(false);
                }}
                style={[
                  styles.shortcutPill,
                  periodShortcut === 'month'
                    ? styles.shortcutPillActive
                    : { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? '#27272a' : '#cbd5e1' },
                ]}
              >
                <Text
                  style={[
                    styles.shortcutPillText,
                    { color: periodShortcut === 'month' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  Mes Completo
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setPeriodShortcut('today');
                  setShowCalendarDropdown(false);
                }}
                style={[
                  styles.shortcutPill,
                  periodShortcut === 'today'
                    ? styles.shortcutPillActive
                    : { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? '#27272a' : '#cbd5e1' },
                ]}
              >
                <Text
                  style={[
                    styles.shortcutPillText,
                    { color: periodShortcut === 'today' ? '#09090b' : palette.textPrimary },
                  ]}
                >
                  Hoy
                </Text>
              </Pressable>

              {/* Botón Abrir / Ocultar Calendario */}
              <Pressable
                onPress={() => setShowCalendarDropdown((prev) => !prev)}
                style={[
                  styles.shortcutPill,
                  showCalendarDropdown || periodShortcut === 'custom'
                    ? [styles.shortcutPillActive, { backgroundColor: '#d97706', borderColor: '#b45309' }]
                    : { backgroundColor: isDark ? '#27272a' : '#f1f5f9', borderColor: '#f59e0b' },
                ]}
              >
                <Text
                  style={[
                    styles.shortcutPillText,
                    { color: showCalendarDropdown || periodShortcut === 'custom' ? '#ffffff' : '#b45309' },
                  ]}
                >
                  {showCalendarDropdown ? '📅 Ocultar Calendario ▲' : '📅 Abrir Calendario ▼'}
                </Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* DESPLEGABLE DE CALENDARIO INTERACTIVO (IDÉNTICO A LA VERSIÓN WEB) */}
          {showCalendarDropdown && (
            <View
              style={[
                styles.calendarBox,
                { backgroundColor: isDark ? '#18181b' : '#ffffff', borderColor: isDark ? '#3f3f46' : '#cbd5e1' },
              ]}
            >
              {/* Header Navegación Mes */}
              <View style={styles.calHeaderRow}>
                <Pressable onPress={handlePrevMonth} style={styles.calNavBtn}>
                  <Icon name="ChevronLeft" size={18} color={palette.textPrimary} />
                </Pressable>

                <Text style={[styles.calMonthTitle, { color: palette.textPrimary }]}>
                  {CALENDAR_MONTHS_ES[calendarViewDate.getMonth()]} {calendarViewDate.getFullYear()}
                </Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Pressable onPress={handleTodayCalendar} style={styles.calTodayBtn}>
                    <Text style={styles.calTodayBtnText}>Hoy</Text>
                  </Pressable>
                  <Pressable onPress={handleNextMonth} style={styles.calNavBtn}>
                    <Icon name="ChevronRight" size={18} color={palette.textPrimary} />
                  </Pressable>
                </View>
              </View>

              {/* Días de la Semana */}
              <View style={styles.weekdaysRow}>
                {CALENDAR_WEEKDAYS_ES.map((wd) => (
                  <Text key={wd} style={[styles.weekdayCell, { color: palette.textSubtle }]}>
                    {wd}
                  </Text>
                ))}
              </View>

              {/* Matriz de Días */}
              <View style={styles.calendarGrid}>
                {calendarDays.map((d, index) => {
                  if (!d) {
                    return <View key={`empty-${index}`} style={styles.dayCellEmpty} />;
                  }

                  const isStart = isSameDay(d, selectedRangeStart);
                  const isEnd = isSameDay(d, selectedRangeEnd);
                  const inRange =
                    selectedRangeStart &&
                    selectedRangeEnd &&
                    d > selectedRangeStart &&
                    d < selectedRangeEnd;
                  const isToday = isSameDay(d, new Date());

                  return (
                    <Pressable
                      key={d.toISOString()}
                      onPress={() => handleCalendarDayPress(d)}
                      style={[
                        styles.dayCell,
                        (isStart || isEnd) && styles.dayCellSelected,
                        inRange && styles.dayCellInRange,
                      ]}
                    >
                      <Text
                        style={[
                          styles.dayCellText,
                          { color: palette.textPrimary },
                          (isStart || isEnd) && styles.dayCellSelectedText,
                          isToday && !isStart && !isEnd && { color: '#f59e0b', fontWeight: '800' },
                        ]}
                      >
                        {d.getDate()}
                      </Text>
                      {isToday && <View style={[styles.todayDot, (isStart || isEnd) && { backgroundColor: '#09090b' }]} />}
                    </Pressable>
                  );
                })}
              </View>

              {/* Selector de Asesor para Administradores */}
              {isAdmin && (
                <View style={styles.calAdminAdvisorBox}>
                  <Text style={[styles.calAdminLabel, { color: palette.textSubtle }]}>VISTA ASESOR:</Text>
                  <SelectModal
                    value={adminAdvisorFilter}
                    options={advisorFilterOptions}
                    onChange={(val) => {
                      setAdminAdvisorFilter(val);
                      if (periodShortcut === 'custom' && selectedRangeStart) {
                        const s = new Date(selectedRangeStart);
                        s.setHours(0, 0, 0, 0);
                        const e = new Date(selectedRangeEnd || selectedRangeStart);
                        e.setHours(23, 59, 59, 999);
                        loadCommercialReport('custom', false, s, e, val);
                      } else {
                        loadCommercialReport(periodShortcut, false, undefined, undefined, val);
                      }
                    }}
                    title="Seleccionar Vista de Asesor"
                    icon="Users"
                  />
                </View>
              )}

              {/* Botón Generar Informe */}
              <Pressable
                onPress={handleGenerateCustomReport}
                style={styles.calGenerateBtn}
              >
                <Icon name="Zap" size={14} color="#09090b" />
                <Text style={styles.calGenerateBtnText}>⚡ Generar Informe de Este Período</Text>
              </Pressable>
            </View>
          )}

          {/* RANGO SELECCIONADO CARD */}
          <View style={[styles.rangeBadgeCard, { backgroundColor: isDark ? '#18181b' : '#f1f5f9', borderColor: isDark ? '#27272a' : '#e2e8f0' }]}>
            <Icon name="Calendar" size={13} color="#f59e0b" />
            <Text style={[styles.rangeBadgeText, { color: isDark ? '#fef08a' : '#854d0e' }]}>
              Rango Seleccionado: <Text style={{ fontWeight: '700' }}>{reportData?.periodLabel || 'Cargando período...'}</Text>
            </Text>
          </View>

          {/* ERROR ALERT */}
          {reportError && (
            <View style={[styles.errorBox, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}>
              <Icon name="AlertCircle" size={16} color={palette.roseText} />
              <Text style={[styles.errorText, { color: palette.roseText }]}>{reportError}</Text>
            </View>
          )}

          {loadingReport && !refreshingReport ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#f59e0b" />
              <Text style={[styles.loadingText, { color: palette.textSubtle }]}>
                Compilando métricas y bitácoras del CRM...
              </Text>
            </View>
          ) : reportData ? (
            /* ══════════════ DOCUMENTO OFICIAL BLANCO / ESTILO WEB ══════════════ */
            <View style={[styles.documentSheet, { backgroundColor: '#ffffff', borderColor: '#e4e4e7' }]}>
              {/* Header Documento con Marca */}
              <View style={styles.docHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docTitle}>{reportData.title}</Text>
                  <Text style={styles.docPeriodText}>
                    Semana / Período: <Text style={{ fontWeight: '700' }}>{reportData.periodLabel}</Text>
                  </Text>
                  <View style={styles.docMetaRow}>
                    <Text style={styles.docMetaItem}>
                      Para: <Text style={{ fontWeight: '700' }}>{reportData.forRecipient}</Text>
                    </Text>
                    <Text style={styles.docMetaBullet}>•</Text>
                    <Text style={styles.docMetaItem}>
                      Elaborado por: <Text style={{ fontWeight: '700' }}>{reportData.preparedBy}</Text>
                    </Text>
                    <Text style={styles.docMetaBullet}>•</Text>
                    <Text style={styles.docMetaItem}>
                      Fecha: <Text style={{ fontWeight: '700' }}>{reportData.date}</Text>
                    </Text>
                  </View>
                </View>

                {/* Logo Meraki */}
                <View style={styles.brandBadge}>
                  <View style={styles.brandIconCircle}>
                    <Text style={{ fontSize: 13, fontWeight: '900', color: '#b45309' }}>M</Text>
                  </View>
                  <Text style={styles.brandName}>MERAKI</Text>
                  <Text style={styles.brandSubtitle}>GRUPO CONSTRUCTOR</Text>
                  <Text style={styles.brandTagline}>Creamos con pasión</Text>
                </View>
              </View>

              <View style={styles.docDivider} />

              {/* 1. RESUMEN DE LA SEMANA */}
              <View style={styles.docSection}>
                <Text style={styles.sectionHeading}>1. RESUMEN DE LA SEMANA</Text>

                {/* Grid 4 KPIs Negras (Idénticas a Web) */}
                <View style={styles.docKpiGrid}>
                  <Pressable
                    onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'all' })}
                    style={styles.docKpiCard}
                  >
                    <Text style={[styles.docKpiNum, { color: '#f59e0b' }]}>
                      {reportData.kpis.captacionesPeriodo}
                    </Text>
                    <Text style={styles.docKpiLabel}>Captaciones de la semana</Text>
                  </Pressable>

                  <View style={styles.docKpiCard}>
                    <Text style={[styles.docKpiNum, { color: '#f59e0b' }]}>
                      {reportData.kpis.ventasPeriodo}
                    </Text>
                    <Text style={styles.docKpiLabel}>
                      Ventas semana ({reportData.kpis.ventasMes} en el mes)
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'clientes_seguimiento_total' })}
                    style={styles.docKpiCard}
                  >
                    <Text style={[styles.docKpiNum, { color: '#10b981' }]}>
                      {reportData.kpis.clientesGestionadosPeriodo}
                    </Text>
                    <Text style={styles.docKpiLabel}>Clientes con seguimiento real</Text>
                  </Pressable>

                  <Pressable
                    onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'con_seguimiento' })}
                    style={styles.docKpiCard}
                  >
                    <Text style={[styles.docKpiNum, { color: '#f59e0b' }]}>
                      {reportData.kpis.coberturaLeadsPeriodoPct}%
                    </Text>
                    <Text style={styles.docKpiLabel}>Leads semana con seguimiento</Text>
                  </Pressable>
                </View>

                {/* Caja de Análisis Textual con Viñetas Naranjas */}
                <View style={styles.analysisBox}>
                  <View style={styles.bulletItem}>
                    <View style={styles.bulletSquare} />
                    <Text style={styles.bulletText}>
                      <Text style={{ fontWeight: '800', color: '#18181b' }}>Referencia: </Text>
                      {reportData.summaryBullets.referencia}
                    </Text>
                  </View>

                  <View style={styles.bulletItem}>
                    <View style={styles.bulletSquare} />
                    <Text style={styles.bulletText}>
                      <Text style={{ fontWeight: '800', color: '#18181b' }}>Captación: </Text>
                      {reportData.summaryBullets.captacion}
                    </Text>
                  </View>

                  <View style={styles.bulletItem}>
                    <View style={styles.bulletSquare} />
                    <Text style={styles.bulletText}>
                      <Text style={{ fontWeight: '800', color: '#18181b' }}>Ventas: </Text>
                      {reportData.summaryBullets.ventas}
                    </Text>
                  </View>

                  <View style={styles.bulletItem}>
                    <View style={styles.bulletSquare} />
                    <Text style={styles.bulletText}>
                      <Text style={{ fontWeight: '800', color: '#18181b' }}>Seguimiento: </Text>
                      {reportData.summaryBullets.seguimiento}
                    </Text>
                  </View>
                </View>
              </View>

              {/* 2. AVANCE DE GESTIÓN (INTERACTIVO) */}
              <View style={styles.docSection}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeading}>
                    {reportData.isIndividualReport
                      ? `2. AVANCE DE GESTIÓN — ${currentUserName.toUpperCase()}`
                      : '2. AVANCE POR ASESOR'}
                  </Text>
                  <View style={styles.clickBadge}>
                    <Icon name="MousePointerClick" size={11} color="#92400e" />
                    <Text style={styles.clickBadgeText}>CLIC EN CIFRAS PARA VER PROSPECTOS</Text>
                  </View>
                </View>

                <Text style={styles.tableInstructionText}>
                  Tabla interactiva: Haz clic en cualquier número de captaciones o seguimiento para abrir la auditoría con el listado completo de clientes.
                </Text>

                {/* ═══ RESUMEN RÁPIDO Y ALERTA PARA ASESOR PERSONAL (100% CONFIDENCIAL) ═══ */}
                {reportData.isIndividualReport && (
                  <View style={styles.advisorPersonalContainer}>
                    {/* Alerta Destacada si Faltan Seguimientos */}
                    {reportData.kpis.leadsPeriodoSinSeguimiento > 0 && (
                      <Pressable
                        onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'sin_seguimiento' })}
                        style={styles.missingAlertCard}
                      >
                        <Icon name="AlertCircle" size={20} color="#dc2626" />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.missingAlertTitle}>
                            ⚠️ Tienes {reportData.kpis.leadsPeriodoSinSeguimiento} prospectos sin seguimiento en la semana
                          </Text>
                          <Text style={styles.missingAlertDesc}>
                            Toca aquí para ver quiénes son y registrarlos en la Ficha Técnica.
                          </Text>
                        </View>
                        <Icon name="ChevronRight" size={16} color="#dc2626" />
                      </Pressable>
                    )}

                    {/* 4 Métricas Clave Interactivas del Asesor */}
                    <View style={styles.advisorKpisGrid}>
                      <Pressable
                        onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'all' })}
                        style={[styles.advisorKpiBox, { borderColor: '#f59e0b' }]}
                      >
                        <Text style={[styles.advisorKpiNumber, { color: '#f59e0b' }]}>
                          {reportData.kpis.captacionesPeriodo}
                        </Text>
                        <Text style={styles.advisorKpiLabel}>Captaciones Semana</Text>
                        <Text style={styles.advisorKpiSub}>Toca para auditar</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleOpenDrilldown({ scope: 'month', filter: 'all' })}
                        style={[styles.advisorKpiBox, { borderColor: '#10b981' }]}
                      >
                        <Text style={[styles.advisorKpiNumber, { color: '#10b981' }]}>
                          {reportData.kpis.captacionesMes}
                        </Text>
                        <Text style={styles.advisorKpiLabel}>Acumulado {reportData.monthLabel.split(' ')[0]}</Text>
                        <Text style={styles.advisorKpiSub}>Meta: 25 / sem · 100 / mes</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'con_seguimiento' })}
                        style={[styles.advisorKpiBox, { borderColor: '#3b82f6' }]}
                      >
                        <Text style={[styles.advisorKpiNumber, { color: '#3b82f6' }]}>
                          {reportData.kpis.leadsPeriodoConSeguimiento}
                        </Text>
                        <Text style={styles.advisorKpiLabel}>Con Seguimiento</Text>
                        <Text style={styles.advisorKpiSub}>En bitácora</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'sin_seguimiento' })}
                        style={[
                          styles.advisorKpiBox,
                          { borderColor: reportData.kpis.leadsPeriodoSinSeguimiento > 0 ? '#ef4444' : '#10b981' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.advisorKpiNumber,
                            { color: reportData.kpis.leadsPeriodoSinSeguimiento > 0 ? '#ef4444' : '#10b981' },
                          ]}
                        >
                          {reportData.kpis.leadsPeriodoSinSeguimiento}
                        </Text>
                        <Text style={styles.advisorKpiLabel}>Faltan Seguimiento</Text>
                        <Text
                          style={[
                            styles.advisorKpiSub,
                            { color: reportData.kpis.leadsPeriodoSinSeguimiento > 0 ? '#ef4444' : '#10b981' },
                          ]}
                        >
                          {reportData.kpis.leadsPeriodoSinSeguimiento > 0 ? '¡Requiere gestión!' : '¡Al día!'}
                        </Text>
                      </Pressable>
                    </View>

                    {/* Barra de Progreso de Cobertura */}
                    <View style={styles.coverageProgressCard}>
                      <View style={styles.coverageHeaderRow}>
                        <Text style={styles.coverageTitle}>% Cobertura de Leads de la Semana</Text>
                        <Text
                          style={[
                            styles.coveragePercent,
                            {
                              color:
                                reportData.kpis.coberturaLeadsPeriodoPct >= 70
                                  ? '#059669'
                                  : reportData.kpis.coberturaLeadsPeriodoPct >= 40
                                  ? '#d97706'
                                  : '#dc2626',
                            },
                          ]}
                        >
                          {reportData.kpis.coberturaLeadsPeriodoPct}%
                        </Text>
                      </View>
                      <View style={styles.progressBarTrack}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.min(100, reportData.kpis.coberturaLeadsPeriodoPct)}%`,
                              backgroundColor:
                                reportData.kpis.coberturaLeadsPeriodoPct >= 70
                                  ? '#10b981'
                                  : reportData.kpis.coberturaLeadsPeriodoPct >= 40
                                  ? '#f59e0b'
                                  : '#ef4444',
                            },
                          ]}
                        />
                      </View>
                    </View>
                  </View>
                )}

                {/* ═══ TABLA INTERACTIVA OFICIAL (1:1 CON WEB, COLUMNA ASESOR FIJA AL DESLIZAR) ═══ */}
                <View style={styles.stickyTableWrapper}>
                  <View style={styles.stickyTableSwipeHintRow}>
                    <Text style={styles.stickyTableSwipeHintText}>
                      {reportData.isIndividualReport
                        ? '👤 Tu fila oficial de auditoría comercial (solo tú puedes ver tu información)'
                        : '📌 Columna "Asesor" fija a la izquierda · Desliza las cifras horizontalmente ↔'}
                    </Text>
                  </View>

                  <View style={styles.stickyTableSplitContainer}>
                    {/* COLUMNA IZQUIERDA FIJA: NOMBRE DEL ASESOR */}
                    <View style={styles.stickyLeftColumn}>
                      {/* Header Asesor */}
                      <View style={[styles.tableHeaderRow, styles.stickyHeaderCell]}>
                        <Text style={[styles.thCell, { textAlign: 'left' }]}>Asesor</Text>
                      </View>

                      {/* Filas de Asesor (1 fila si es asesor individual, todas si es Admin) */}
                      {reportData.advisorRows.map((adv, idx) => {
                        const isEven = idx % 2 === 0;
                        return (
                          <Pressable
                            key={`left-${adv.advisorId}`}
                            onPress={() =>
                              handleOpenDrilldown({ advisorId: adv.advisorId, scope: 'period', filter: 'all' })
                            }
                            style={[
                              styles.tableRow,
                              styles.stickyDataCell,
                              { backgroundColor: isEven ? '#fafafa' : '#ffffff' },
                            ]}
                          >
                            <Text style={styles.advisorNameText} numberOfLines={2}>
                              {adv.advisorName}
                            </Text>
                          </Pressable>
                        );
                      })}

                      {/* Fila TOTAL (Solo para Administradores en vista de equipo) */}
                      {!reportData.isIndividualReport && (
                        <Pressable
                          onPress={() => handleOpenDrilldown({ advisorId: 'all', scope: 'period', filter: 'all' })}
                          style={[styles.tableTotalRow, styles.stickyTotalCell]}
                        >
                          <Text style={styles.totalRowTitle}>TOTAL ({reportData.advisorRows.length})</Text>
                        </Pressable>
                      )}
                    </View>

                    {/* COLUMNAS DERECHAS DESLIZABLES: LAS 9 MÉTRICAS OFICIALES DE LA WEB */}
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={true}
                      style={styles.scrollableRightArea}
                      contentContainerStyle={styles.scrollableRightContent}
                    >
                      <View>
                        {/* Encabezado de las 9 Columnas Numéricas (Idéntico a Web) */}
                        <View style={[styles.tableHeaderRow, styles.scrollableHeaderRow]}>
                          <Text style={[styles.thCell, { width: 78 }]}>
                            {reportData.periodType === 'month'
                              ? 'Capt. mes'
                              : reportData.periodType === 'today'
                              ? 'Capt. hoy'
                              : 'Capt. semana'}
                          </Text>
                          <Text style={[styles.thCell, { width: 88 }]}>
                            Capt. acum. {reportData.monthLabel.split(' ')[0]}
                          </Text>
                          <Text style={[styles.thCell, { width: 74 }]}>Avance mes</Text>
                          <Text style={[styles.thCell, { width: 68 }]}>Ventas sem.</Text>
                          <Text style={[styles.thCell, { width: 68 }]}>Ventas mes</Text>
                          <Text style={[styles.thCell, { width: 92 }]}>Clientes con seguim.</Text>
                          <Text style={[styles.thCell, { width: 92 }]}>Leads sem. con seguim.</Text>
                          <Text style={[styles.thCell, { width: 86 }]}>Clientes anteriores</Text>
                          <Text style={[styles.thCell, { width: 76 }]}>% Cobertura</Text>
                        </View>

                        {/* Filas de Cifras por Asesor */}
                        {reportData.advisorRows.map((adv, idx) => {
                          const isEven = idx % 2 === 0;
                          const isSemOk = adv.captSemana >= 25;
                          const isSemMid = adv.captSemana >= 10 && adv.captSemana < 25;
                          const isMesOk = adv.captMes >= 25;
                          const isMesMid = adv.captMes >= 15 && adv.captMes < 25;
                          const isCobOk = adv.coberturaPct >= 70;
                          const isCobMid = adv.coberturaPct >= 40 && adv.coberturaPct < 70;

                          return (
                            <View
                              key={`right-${adv.advisorId}`}
                              style={[
                                styles.tableRow,
                                styles.scrollableDataRow,
                                { backgroundColor: isEven ? '#fafafa' : '#ffffff' },
                              ]}
                            >
                              {/* 1. Capt. semana */}
                              <View style={[styles.tdCell, { width: 78 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({ advisorId: adv.advisorId, scope: 'period', filter: 'all' })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    isSemOk
                                      ? styles.badgeEmerald
                                      : isSemMid
                                      ? styles.badgeAmber
                                      : adv.captSemana > 0
                                      ? styles.badgeRose
                                      : styles.badgeMuted,
                                  ]}
                                >
                                  <Text
                                    style={
                                      isSemOk
                                        ? styles.badgeEmeraldText
                                        : isSemMid
                                        ? styles.badgeAmberText
                                        : adv.captSemana > 0
                                        ? styles.badgeRoseText
                                        : styles.badgeMutedText
                                    }
                                  >
                                    {adv.captSemana}
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 2. Capt. acum. Mes */}
                              <View style={[styles.tdCell, { width: 88 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({ advisorId: adv.advisorId, scope: 'month', filter: 'all' })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    isMesOk
                                      ? styles.badgeEmerald
                                      : isMesMid
                                      ? styles.badgeAmber
                                      : styles.badgeDark,
                                  ]}
                                >
                                  <Text
                                    style={
                                      isMesOk
                                        ? styles.badgeEmeraldText
                                        : isMesMid
                                        ? styles.badgeAmberText
                                        : styles.badgeDarkText
                                    }
                                  >
                                    {adv.captMes}
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 3. Avance mes */}
                              <View style={[styles.tdCell, { width: 74 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({ advisorId: adv.advisorId, scope: 'month', filter: 'all' })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    adv.avanceMesPct >= 100
                                      ? styles.badgeEmerald
                                      : adv.avanceMesPct >= 50
                                      ? styles.badgeAmber
                                      : styles.badgeMuted,
                                  ]}
                                >
                                  <Text
                                    style={
                                      adv.avanceMesPct >= 100
                                        ? styles.badgeEmeraldText
                                        : adv.avanceMesPct >= 50
                                        ? styles.badgeAmberText
                                        : styles.badgeMutedText
                                    }
                                  >
                                    {adv.avanceMesPct}%
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 4. Ventas sem. */}
                              <View style={[styles.tdCell, { width: 68 }]}>
                                <Text
                                  style={
                                    adv.ventasSemana > 0
                                      ? [styles.badgeEmeraldText, { fontSize: 12 }]
                                      : styles.tableTextMuted
                                  }
                                >
                                  {adv.ventasSemana}
                                </Text>
                              </View>

                              {/* 5. Ventas mes */}
                              <View style={[styles.tdCell, { width: 68 }]}>
                                <Text
                                  style={
                                    adv.ventasMes > 0
                                      ? [styles.badgeEmeraldText, { fontSize: 12 }]
                                      : styles.tableTextMuted
                                  }
                                >
                                  {adv.ventasMes}
                                </Text>
                              </View>

                              {/* 6. Clientes con seguim. */}
                              <View style={[styles.tdCell, { width: 92 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({
                                      advisorId: adv.advisorId,
                                      scope: 'period',
                                      filter: 'clientes_seguimiento_total',
                                    })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    adv.clientesConSeguimiento > 0 ? styles.badgeEmerald : styles.badgeDark,
                                  ]}
                                >
                                  <Text
                                    style={
                                      adv.clientesConSeguimiento > 0
                                        ? styles.badgeEmeraldText
                                        : styles.badgeDarkText
                                    }
                                  >
                                    {adv.clientesConSeguimiento}
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 7. Leads sem. con seguim. */}
                              <View style={[styles.tdCell, { width: 92 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({
                                      advisorId: adv.advisorId,
                                      scope: 'period',
                                      filter: 'con_seguimiento',
                                    })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    adv.leadsSemConSeguimiento > 0 ? styles.badgeEmerald : styles.badgeDark,
                                  ]}
                                >
                                  <Text
                                    style={
                                      adv.leadsSemConSeguimiento > 0
                                        ? styles.badgeEmeraldText
                                        : styles.badgeDarkText
                                    }
                                  >
                                    {adv.leadsSemConSeguimiento}
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 8. Clientes anteriores */}
                              <View style={[styles.tdCell, { width: 86 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({
                                      advisorId: adv.advisorId,
                                      scope: 'period',
                                      filter: 'clientes_anteriores',
                                    })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    adv.clientesAnteriores > 0 ? styles.badgeAmber : styles.badgeMuted,
                                  ]}
                                >
                                  <Text
                                    style={
                                      adv.clientesAnteriores > 0
                                        ? styles.badgeAmberText
                                        : styles.badgeMutedText
                                    }
                                  >
                                    {adv.clientesAnteriores}
                                  </Text>
                                </Pressable>
                              </View>

                              {/* 9. % Cobertura */}
                              <View style={[styles.tdCell, { width: 76 }]}>
                                <Pressable
                                  onPress={() =>
                                    handleOpenDrilldown({ advisorId: adv.advisorId, scope: 'period', filter: 'all' })
                                  }
                                  style={[
                                    styles.tableBadge,
                                    isCobOk
                                      ? styles.badgeEmerald
                                      : isCobMid
                                      ? styles.badgeAmber
                                      : styles.badgeRose,
                                  ]}
                                >
                                  <Text
                                    style={
                                      isCobOk
                                        ? styles.badgeEmeraldText
                                        : isCobMid
                                        ? styles.badgeAmberText
                                        : styles.badgeRoseText
                                    }
                                  >
                                    {adv.coberturaPct}%
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })}

                        {/* Fila TOTAL DEL EQUIPO (Solo Administradores) */}
                        {!reportData.isIndividualReport && (
                          <View style={[styles.tableTotalRow, styles.scrollableTotalRow]}>
                            {/* 1. Total Capt. semana */}
                            <View style={[styles.tdCell, { width: 78 }]}>
                              <Pressable
                                onPress={() => handleOpenDrilldown({ advisorId: 'all', scope: 'period', filter: 'all' })}
                                style={[styles.tableBadge, totalCaptSemana > 0 ? styles.badgeAmber : styles.badgeDark]}
                              >
                                <Text style={totalCaptSemana > 0 ? styles.badgeAmberText : styles.badgeDarkText}>
                                  {totalCaptSemana}
                                </Text>
                              </Pressable>
                            </View>

                            {/* 2. Total Capt. acum. Mes */}
                            <View style={[styles.tdCell, { width: 88 }]}>
                              <Pressable
                                onPress={() => handleOpenDrilldown({ advisorId: 'all', scope: 'month', filter: 'all' })}
                                style={[styles.tableBadge, styles.badgeEmerald]}
                              >
                                <Text style={styles.badgeEmeraldText}>{totalCaptMes}</Text>
                              </Pressable>
                            </View>

                            {/* 3. Total Avance mes */}
                            <View style={[styles.tdCell, { width: 74 }]}>
                              <Pressable
                                onPress={() => handleOpenDrilldown({ advisorId: 'all', scope: 'month', filter: 'all' })}
                                style={[styles.tableBadge, styles.badgeEmerald]}
                              >
                                <Text style={styles.badgeEmeraldText}>{totalAvanceMes}%</Text>
                              </Pressable>
                            </View>

                            {/* 4. Total Ventas sem. */}
                            <View style={[styles.tdCell, { width: 68 }]}>
                              <Text style={styles.totalRowText}>{totalVentasSemana}</Text>
                            </View>

                            {/* 5. Total Ventas mes */}
                            <View style={[styles.tdCell, { width: 68 }]}>
                              <Text style={styles.totalRowText}>{totalVentasMes}</Text>
                            </View>

                            {/* 6. Total Clientes con seguim. */}
                            <View style={[styles.tdCell, { width: 92 }]}>
                              <Pressable
                                onPress={() =>
                                  handleOpenDrilldown({
                                    advisorId: 'all',
                                    scope: 'period',
                                    filter: 'clientes_seguimiento_total',
                                  })
                                }
                                style={[styles.tableBadge, styles.badgeEmerald]}
                              >
                                <Text style={styles.badgeEmeraldText}>{totalClientesConSeguimiento}</Text>
                              </Pressable>
                            </View>

                            {/* 7. Total Leads sem. con seguim. */}
                            <View style={[styles.tdCell, { width: 92 }]}>
                              <Pressable
                                onPress={() =>
                                  handleOpenDrilldown({ advisorId: 'all', scope: 'period', filter: 'con_seguimiento' })
                                }
                                style={[styles.tableBadge, styles.badgeEmerald]}
                              >
                                <Text style={styles.badgeEmeraldText}>{totalLeadsConSeguimiento}</Text>
                              </Pressable>
                            </View>

                            {/* 8. Total Clientes anteriores */}
                            <View style={[styles.tdCell, { width: 86 }]}>
                              <Pressable
                                onPress={() =>
                                  handleOpenDrilldown({
                                    advisorId: 'all',
                                    scope: 'period',
                                    filter: 'clientes_anteriores',
                                  })
                                }
                                style={[styles.tableBadge, styles.badgeAmber]}
                              >
                                <Text style={styles.badgeAmberText}>{totalClientesAnteriores}</Text>
                              </Pressable>
                            </View>

                            {/* 9. Total % Cobertura */}
                            <View style={[styles.tdCell, { width: 76 }]}>
                              <Pressable
                                onPress={() => handleOpenDrilldown({ advisorId: 'all', scope: 'period', filter: 'all' })}
                                style={[
                                  styles.tableBadge,
                                  avgCobertura >= 70
                                    ? styles.badgeEmerald
                                    : avgCobertura >= 40
                                    ? styles.badgeAmber
                                    : styles.badgeRose,
                                ]}
                              >
                                <Text
                                  style={
                                    avgCobertura >= 70
                                      ? styles.badgeEmeraldText
                                      : avgCobertura >= 40
                                      ? styles.badgeAmberText
                                      : styles.badgeRoseText
                                  }
                                >
                                  {avgCobertura}%
                                </Text>
                              </Pressable>
                            </View>
                          </View>
                        )}
                      </View>
                    </ScrollView>
                  </View>
                </View>
              </View>
            </View>
          ) : null}
        </ScrollView>
      ) : mainTab === 'sales' ? (
        /* Pestaña Ventas / Comisiones (Integrada) */
        <View style={styles.legacyPlaceholder}>
          <Icon name="DollarSign" size={36} color="#f59e0b" />
          <Text style={[styles.legacyPlaceholderTitle, { color: palette.textPrimary }]}>
            Módulo de Ventas & Comisiones
          </Text>
          <Text style={[styles.legacyPlaceholderSubtitle, { color: palette.textSubtle }]}>
            Visualiza las ventas cerradas y legalizadas del equipo o de tu cartera personal.
          </Text>
          <Button
            onPress={() => {
              Alert.alert('Ventas', 'No hay contratos pendientes por legalizar en este período.');
            }}
            variant="secondary"
          >
            Consultar contratos
          </Button>
        </View>
      ) : (
        /* Pestaña Informe 317 (Integrada) */
        <View style={styles.legacyPlaceholder}>
          <Icon name="Clock" size={36} color="#f59e0b" />
          <Text style={[styles.legacyPlaceholderTitle, { color: palette.textPrimary }]}>
            Auditoría de Inactividad 317
          </Text>
          <Text style={[styles.legacyPlaceholderSubtitle, { color: palette.textSubtle }]}>
            Prospectos que superan 7 días sin contacto de seguimiento comercial.
          </Text>
          <Button
            onPress={() => handleOpenDrilldown({ scope: 'period', filter: 'sin_seguimiento' })}
          >
            Ver prospectos sin seguimiento ({reportData?.kpis.leadsPeriodoSinSeguimiento || 0})
          </Button>
        </View>
      )}

      {/* MODAL 1: AUDITORÍA INTERACTIVA DE CAPTACIONES */}
      <AdvisorLeadsDrilldownModal
        isOpen={drilldownState.isOpen}
        onClose={() => setDrilldownState((prev) => ({ ...prev, isOpen: false }))}
        reportData={reportData}
        initialAdvisorId={drilldownState.advisorId}
        initialScope={drilldownState.scope}
        initialFilter={drilldownState.filter}
        onOpenChat={handleOpenChat}
        onOpenFicha={handleOpenFicha}
      />

      {/* MODAL 2: FICHA TÉCNICA Y SEGUIMIENTO */}
      {fichaModalLeadId && (
        <FichaTecnicaModal
          isOpen={!!fichaModalLeadId}
          onClose={() => setFichaModalLeadId(null)}
          onSuccess={() => {
            setFichaModalLeadId(null);
            loadCommercialReport(periodShortcut, true);
          }}
          companyId={companyId || ''}
          lead={{ id: fichaModalLeadId } as any}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  reloadBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabSelectorBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  tabSelectorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabSelectorBtnActive: {
    borderBottomWidth: 2,
  },
  tabSelectorText: {
    fontSize: 12,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
    gap: 12,
  },
  shortcutsSection: {
    gap: 6,
  },
  shortcutsLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  shortcutsRow: {
    gap: 6,
  },
  shortcutPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  shortcutPillActive: {
    backgroundColor: '#f59e0b',
    borderColor: '#f59e0b',
  },
  shortcutPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  rangeBadgeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  rangeBadgeText: {
    fontSize: 11.5,
    flex: 1,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  errorText: {
    fontSize: 12,
    flex: 1,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 12,
  },

  /* ═══ CALENDARIO INTERACTIVO ESTILO WEB ═══ */
  calendarBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  calHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  calNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(161, 161, 170, 0.15)',
  },
  calMonthTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  calTodayBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  calTodayBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#d97706',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(161, 161, 170, 0.2)',
  },
  weekdayCell: {
    width: '14.28%',
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCellEmpty: {
    width: '14.28%',
    height: 36,
  },
  dayCell: {
    width: '14.28%',
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    marginVertical: 1,
  },
  dayCellText: {
    fontSize: 12,
    fontWeight: '600',
  },
  dayCellSelected: {
    backgroundColor: '#f59e0b',
  },
  dayCellSelectedText: {
    color: '#09090b',
    fontWeight: '900',
  },
  dayCellInRange: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  todayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#f59e0b',
    marginTop: 1,
  },
  calAdminAdvisorBox: {
    gap: 4,
    marginTop: 4,
  },
  calAdminLabel: {
    fontSize: 10,
    fontWeight: '800',
  },
  calGenerateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#f59e0b',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
  },
  calGenerateBtnText: {
    color: '#09090b',
    fontSize: 12,
    fontWeight: '800',
  },

  /* ═══ DOCUMENTO OFICIAL BLANCO ═══ */
  documentSheet: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  docHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  docTitle: {
    fontSize: 15,
    fontWeight: '900',
    color: '#09090b',
    lineHeight: 20,
    marginBottom: 4,
  },
  docPeriodText: {
    fontSize: 11,
    color: '#3f3f46',
    marginBottom: 6,
  },
  docMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  docMetaItem: {
    fontSize: 10,
    color: '#52525b',
  },
  docMetaBullet: {
    fontSize: 10,
    color: '#a1a1aa',
  },
  brandBadge: {
    alignItems: 'center',
    width: 80,
  },
  brandIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  brandName: {
    fontSize: 10,
    fontWeight: '900',
    color: '#b45309',
    letterSpacing: 0.8,
  },
  brandSubtitle: {
    fontSize: 7,
    fontWeight: '700',
    color: '#78350f',
    letterSpacing: 0.4,
  },
  brandTagline: {
    fontSize: 7,
    fontStyle: 'italic',
    color: '#d97706',
  },
  docDivider: {
    height: 1,
    backgroundColor: '#e4e4e7',
  },
  docSection: {
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 6,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '900',
    color: '#09090b',
    letterSpacing: 0.3,
  },
  clickBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  clickBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#92400e',
  },
  tableInstructionText: {
    fontSize: 11,
    color: '#71717a',
    lineHeight: 15,
  },
  docKpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  docKpiCard: {
    width: '48%',
    backgroundColor: '#09090b',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docKpiNum: {
    fontSize: 26,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  docKpiLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#ffffff',
    textAlign: 'center',
  },
  analysisBox: {
    backgroundColor: '#fafafa',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    padding: 12,
    gap: 8,
  },
  bulletItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  bulletSquare: {
    width: 6,
    height: 6,
    backgroundColor: '#f59e0b',
    marginTop: 5,
  },
  bulletText: {
    flex: 1,
    fontSize: 11.5,
    color: '#3f3f46',
    lineHeight: 16,
  },

  /* ═══ VISTA ASESOR PERSONAL ═══ */
  advisorPersonalContainer: {
    gap: 12,
  },
  missingAlertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    padding: 12,
    borderRadius: 12,
  },
  missingAlertTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    color: '#991b1b',
  },
  missingAlertDesc: {
    fontSize: 11,
    color: '#7f1d1d',
    marginTop: 2,
    lineHeight: 15,
  },
  advisorKpisGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  advisorKpiBox: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  advisorKpiNumber: {
    fontSize: 24,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  advisorKpiLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#18181b',
    textAlign: 'center',
  },
  advisorKpiSub: {
    fontSize: 9.5,
    color: '#71717a',
    marginTop: 2,
  },
  coverageProgressCard: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#e4e4e7',
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  coverageHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  coverageTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#3f3f46',
  },
  coveragePercent: {
    fontSize: 13,
    fontWeight: '900',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#e4e4e7',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },

  /* ═══ TABLA INTERACTIVA OFICIAL CON COLUMNA ASESOR FIJA (1:1 CON WEB) ═══ */
  stickyTableWrapper: {
    marginTop: 4,
    gap: 6,
  },
  stickyTableSwipeHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  stickyTableSwipeHintText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#92400e',
  },
  stickyTableSplitContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  stickyLeftColumn: {
    width: 138,
    borderRightWidth: 1.5,
    borderRightColor: '#d4d4d8',
    backgroundColor: '#ffffff',
    zIndex: 2,
    elevation: 2,
  },
  stickyHeaderCell: {
    height: 48,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  stickyDataCell: {
    height: 46,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  stickyTotalCell: {
    height: 48,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  scrollableRightArea: {
    flex: 1,
  },
  scrollableRightContent: {
    flexGrow: 1,
  },
  scrollableHeaderRow: {
    height: 48,
    paddingHorizontal: 4,
  },
  scrollableDataRow: {
    height: 46,
    paddingHorizontal: 4,
  },
  scrollableTotalRow: {
    height: 48,
    paddingHorizontal: 4,
  },
  tableScroll: {
    marginTop: 4,
  },
  tableContainer: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e4e4e7',
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#18181b',
    alignItems: 'center',
  },
  thCell: {
    fontSize: 9.5,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    paddingHorizontal: 3,
    textTransform: 'uppercase',
    lineHeight: 12,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e4e4e7',
  },
  tdCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  advisorNameText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#09090b',
    lineHeight: 14,
  },
  tableBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeAmber: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  badgeAmberText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#b45309',
  },
  badgeEmerald: {
    backgroundColor: '#d1fae5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  badgeEmeraldText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#065f46',
  },
  badgeRose: {
    backgroundColor: '#ffe4e6',
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  badgeRoseText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#be123c',
  },
  badgeDark: {
    backgroundColor: '#27272a',
  },
  badgeDarkText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#ffffff',
  },
  badgeMuted: {
    backgroundColor: '#f4f4f5',
  },
  badgeMutedText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#71717a',
  },
  tableTextMuted: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#71717a',
    textAlign: 'center',
  },
  tableTotalRow: {
    flexDirection: 'row',
    backgroundColor: '#09090b',
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  totalRowTitle: {
    fontSize: 11,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  totalRowText: {
    fontSize: 11.5,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
  },

  /* Placeholders auxiliares */
  legacyPlaceholder: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  legacyPlaceholderTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  legacyPlaceholderSubtitle: {
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 280,
  },
});
