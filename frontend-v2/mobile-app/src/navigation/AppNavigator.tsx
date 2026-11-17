import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import firestore from '@react-native-firebase/firestore';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type LucideIconName } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { SelectModal } from '../components/SelectModal';
import { CallOverlay } from '../components/CallOverlay';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import { listPlatformCompanies, type PlatformCompany } from '../services/enterprise';
import { listLeadTransferRequests } from '../services/contacts';
import { checkAndApplyUpdate } from '../services/updateService';
import { navigationRef } from './navigationRef';
import type { MainTabsParams, RootStackParams } from '../types';

import { LoginScreen } from '../screens/LoginScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { CommercialManagementScreen } from '../screens/CommercialManagementScreen';
import { PipelineScreen } from '../screens/PipelineScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { LeadsScreen } from '../screens/LeadsScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { CallsScreen } from '../screens/CallsScreen';
import { DatabaseScreen } from '../screens/DatabaseScreen';
import { MarketingScreen } from '../screens/MarketingScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { TemplatesScreen } from '../screens/TemplatesScreen';
import { BroadcastsScreen } from '../screens/BroadcastsScreen';
import { ConfigScreen } from '../screens/ConfigScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { AdvisorWhatsappScreen } from '../screens/AdvisorWhatsappScreen';
import { ConfigAiScreen } from '../screens/ConfigAiScreen';

const Root = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<MainTabsParams>();

// Bloqueo de SLA desactivado temporalmente hasta capacitación de asesores
const ENABLE_LIVE_SLA_BLOCK_BANNER = false;

interface PrimaryTabItem {
  name: keyof MainTabsParams;
  label: string;
  icon: LucideIconName;
}

const PRIMARY_TABS: PrimaryTabItem[] = [
  { name: 'Bandeja', label: 'Bandeja', icon: 'MessageSquare' },
  { name: 'GestionComercial', label: 'Gestión Comercial', icon: 'ClipboardCheck' },
  { name: 'Tablero', label: 'Tablero / Embudo', icon: 'Layers' },
  { name: 'Resumen', label: 'Resumen', icon: 'LayoutDashboard' },
];

interface MoreMenuItem {
  route: keyof RootStackParams;
  label: string;
  icon: LucideIconName;
  adminOnly?: boolean;
}

const MORE_MENU_ITEMS: MoreMenuItem[] = [
  { route: 'Leads', label: 'Leads', icon: 'Users' },
  { route: 'Calendario', label: 'Calendario', icon: 'Calendar' },
  { route: 'Database', label: 'Base de Datos', icon: 'Database', adminOnly: true },
  { route: 'Calls', label: 'Llamadas IA', icon: 'Phone' },
  { route: 'Marketing', label: 'Marketing', icon: 'TrendingUp', adminOnly: true },
  { route: 'Reports', label: 'Informes', icon: 'FileText' },
  { route: 'Templates', label: 'Plantillas', icon: 'LayoutTemplate', adminOnly: true },
  { route: 'Broadcasts', label: 'Masivos', icon: 'Megaphone', adminOnly: true },
  { route: 'Config', label: 'Config', icon: 'Settings' },
];

function MerakiBottomTabBar({
  state,
  navigation,
  moreOpen,
  onToggleMore,
  pendingTransfersCount,
  isAdmin,
}: BottomTabBarProps & {
  moreOpen: boolean;
  onToggleMore: () => void;
  pendingTransfersCount: number;
  isAdmin: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const bottomPad = Math.max(insets.bottom, 6);

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: palette.bgNav,
          borderTopColor: palette.borderNav,
          paddingBottom: bottomPad,
        },
      ]}
    >
      {PRIMARY_TABS.map((tab, index) => {
        const isFocused = !moreOpen && state.index === index;
        const tint = isFocused ? (palette.isDark ? palette.brandLight : palette.brandDark) : palette.textSubtle;
        const showBadge = isAdmin && pendingTransfersCount > 0 && tab.name === 'GestionComercial';

        const onPress = () => {
          if (moreOpen) onToggleMore();
          const route = state.routes[index];
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        return (
          <Pressable key={tab.name} onPress={onPress} style={styles.tabBtn} accessibilityRole="tab">
            <View style={styles.iconWrap}>
              <Icon name={tab.icon} size={21} color={tint} />
              {showBadge && (
                <View style={styles.transferBadge}>
                  <Text style={styles.transferBadgeText}>{pendingTransfersCount}</Text>
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={[
                styles.tabLabel,
                {
                  color: tint,
                  fontWeight: isFocused ? '600' : '500',
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}

      {/* 5to botón: Hoja "Más" (idéntico a DashboardLayout.tsx móvil) */}
      <Pressable onPress={onToggleMore} style={styles.tabBtn} accessibilityRole="button">
        <Icon
          name="Menu"
          size={21}
          color={moreOpen ? (palette.isDark ? palette.brandLight : palette.brandDark) : palette.textSubtle}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.tabLabel,
            {
              color: moreOpen ? (palette.isDark ? palette.brandLight : palette.brandDark) : palette.textSubtle,
              fontWeight: moreOpen ? '600' : '500',
            },
          ]}
        >
          Más
        </Text>
      </Pressable>
    </View>
  );
}

function MainShell() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const { palette } = useTheme();
  const { companyId, profile, platformAdmin, isAdmin, setActiveCompanyId, signOut } = useAuth();

  const gridItemWidth = Math.floor((windowWidth - 24) / 3);

  const [moreOpen, setMoreOpen] = useState(false);
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [companiesError, setCompaniesError] = useState(false);
  const [showUnblockFichaModal, setShowUnblockFichaModal] = useState(false);
  const [pendingTransfersCount, setPendingTransfersCount] = useState(0);

  const isTester = profile?.email?.toLowerCase().includes('google.tester') ?? false;
  const availableCompanies = useMemo(
    () => companies.filter((c) => isTester || c.id !== 'empresa_demo'),
    [companies, isTester]
  );
  const activeCompany = useMemo(
    () => availableCompanies.find((c) => c.id === companyId),
    [availableCompanies, companyId]
  );

  useEffect(() => {
    if (!platformAdmin) return;
    let cancelled = false;
    listPlatformCompanies()
      .then((rows) => {
        if (cancelled) return;
        setCompanies(rows);
        setCompaniesError(false);
      })
      .catch(() => {
        if (!cancelled) setCompaniesError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [platformAdmin]);

  useEffect(() => {
    if (!companyId || !isAdmin) {
      setPendingTransfersCount(0);
      return;
    }
    let active = true;
    listLeadTransferRequests(companyId, 'pending')
      .then((list) => {
        if (active) setPendingTransfersCount(list.length);
      })
      .catch(() => {});

    const unsub = firestore()
      .collection('companies')
      .doc(companyId)
      .collection('leadTransferRequests')
      .where('status', '==', 'pending')
      .onSnapshot(
        (snap) => {
          if (active) setPendingTransfersCount(snap.size);
        },
        () => {}
      );

    return () => {
      active = false;
      unsub();
    };
  }, [companyId, isAdmin]);

  const visibleMoreItems = useMemo(
    () => MORE_MENU_ITEMS.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin]
  );

  const moreGridRows = useMemo(() => {
    const rows: (typeof visibleMoreItems)[] = [];
    for (let i = 0; i < visibleMoreItems.length; i += 3) {
      rows.push(visibleMoreItems.slice(i, i + 3));
    }
    return rows;
  }, [visibleMoreItems]);

  const companyOptions = useMemo(() => {
    const opts = availableCompanies.map((c) => ({
      value: c.id,
      label: c.name,
      subtitle: `${c.environment === 'demo' ? 'Demo' : 'Producción'} · ${c.channelRoutes.length} canales${
        c.smartHomeEnabled ? ' · SmartHome' : ''
      }`,
    }));
    if (
      companyId &&
      !opts.some((o) => o.value === companyId) &&
      (companyId !== 'empresa_demo' || isTester)
    ) {
      opts.unshift({ value: companyId, label: companyId, subtitle: '' });
    }
    return opts;
  }, [availableCompanies, companyId, isTester]);

  const handleOpenMoreRoute = (route: keyof RootStackParams) => {
    setMoreOpen(false);
    navigation.navigate(route);
  };

  return (
    <View style={[styles.shell, { backgroundColor: palette.bgCanvas }]}>
      {/* Banner disciplinario SLA (paridad exacta con DashboardLayout.tsx) */}
      {ENABLE_LIVE_SLA_BLOCK_BANNER && profile?.isBlockedForLeads && (
        <View
          style={[
            styles.slaBanner,
            {
              paddingTop: Math.max(insets.top, 8),
              backgroundColor: palette.isDark ? '#4c0519' : '#fff1f2',
              borderBottomColor: palette.roseBorder,
            },
          ]}
        >
          <View style={styles.slaBannerRow}>
            <Icon name="AlertTriangle" size={16} color={palette.rose} />
            <Text style={[styles.slaBannerText, { color: palette.roseText }]}>
              <Text style={{ fontWeight: '700' }}>
                {profile.receiveLeads === false
                  ? '⚠️ Alerta de Mora de Seguimiento (SLA): '
                  : '⚠️ Recepción de leads nuevos PAUSADA: '}
              </Text>
              {profile.blockedReason?.startsWith('SLA_TOMA_MANUAL')
                ? `Apagaste la IA hace más de 24h sin registrar Ficha Técnica${
                    profile.unresolvedLeadName ? ` para ${profile.unresolvedLeadName}` : ''
                  }. `
                : profile.blockedReason?.startsWith('SLA_POST_CITA')
                ? 'Tienes una cita finalizada pendiente de reporte en Ficha Técnica. '
                : 'Incumplimiento de SLA de contacto previo a cita. '}
              Diligencia la Ficha Técnica ahora para reactivarte automáticamente.
            </Text>
          </View>
          {(profile.unresolvedLeadId || profile.unresolvedAppointmentId) && (
            <Pressable
              onPress={() => setShowUnblockFichaModal(true)}
              style={[styles.slaUnblockBtn, { backgroundColor: palette.emerald }]}
            >
              <Text style={styles.slaUnblockBtnText}>
                📝 Llenar Ficha Técnica Ahora ({profile.unresolvedLeadName || 'Autodesbloquear'})
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {showUnblockFichaModal && companyId && (
        <FichaTecnicaModal
          isOpen={showUnblockFichaModal}
          onClose={() => setShowUnblockFichaModal(false)}
          companyId={companyId}
          lead={
            profile?.unresolvedLeadId
              ? {
                  id: profile.unresolvedLeadId,
                  name: profile.unresolvedLeadName || 'Prospecto Pendiente',
                  advisorName: profile.displayName,
                }
              : undefined
          }
          appointment={
            profile?.unresolvedAppointmentId
              ? {
                  id: profile.unresolvedAppointmentId,
                  leadId: profile.unresolvedLeadId || undefined,
                  leadName: profile.unresolvedLeadName || 'Cita Pendiente',
                  advisorName: profile.displayName,
                }
              : undefined
          }
        />
      )}

      <Tabs.Navigator
        tabBar={(props) => (
          <MerakiBottomTabBar
            {...props}
            moreOpen={moreOpen}
            onToggleMore={() => setMoreOpen((v) => !v)}
            pendingTransfersCount={pendingTransfersCount}
            isAdmin={isAdmin}
          />
        )}
        screenOptions={{
          headerShown: false,
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen name="Bandeja" component={InboxScreen} />
        <Tabs.Screen name="GestionComercial" component={CommercialManagementScreen} />
        <Tabs.Screen name="Tablero" component={PipelineScreen} />
        <Tabs.Screen name="Resumen" component={DashboardScreen} />
      </Tabs.Navigator>

      {/* Hoja "Más" (Bottom Sheet móvil idéntica a DashboardLayout.tsx) */}
      <Modal
        visible={moreOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMoreOpen(false)}
      >
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setMoreOpen(false)} />
          <View
            style={[
              styles.sheetCard,
              {
                backgroundColor: palette.isDark ? palette.bgSurface : palette.bgNav,
                borderTopColor: palette.borderNav,
                paddingBottom: Math.max(insets.bottom + 8, 16),
              },
            ]}
          >
            {/* Drag Handle */}
            <View style={styles.handleRow}>
              <View style={[styles.handleBar, { backgroundColor: palette.borderStrong }]} />
            </View>

            <ScrollView
              style={{ width: '100%' }}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ width: '100%', paddingBottom: 16 }}
            >
              {/* Perfil de usuario */}
              <View style={styles.userSection}>
                <Text style={[styles.userName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {profile?.displayName ?? profile?.email ?? '—'}
                </Text>
                <Text style={[styles.userRole, { color: palette.textSubtle }]} numberOfLines={1}>
                  {profile?.role ?? ''}
                </Text>

                {/* Selector de Empresa Activa (platformAdmin) */}
                {platformAdmin && companyOptions.length > 0 && (
                  <View style={styles.companyBox}>
                    <Text style={[styles.sectionEyebrow, { color: palette.textSubtle }]}>
                      EMPRESA ACTIVA
                    </Text>
                    <SelectModal
                      value={companyId ?? ''}
                      options={companyOptions}
                      onChange={(val) => {
                        void setActiveCompanyId(val);
                      }}
                      title="Seleccionar empresa activa"
                      icon="Building2"
                      compact
                    />
                    <View style={styles.companyMetaRow}>
                      {activeCompany && (
                        <Text style={[styles.companyMetaText, { color: palette.textSubtle }]}>
                          <Text
                            style={{
                              color:
                                activeCompany.environment === 'demo'
                                  ? palette.amberText
                                  : palette.emeraldText,
                              fontWeight: '600',
                            }}
                          >
                            {activeCompany.environment === 'demo' ? 'Demo' : 'Producción'}
                          </Text>
                          {` · ${activeCompany.channelRoutes.length} canales`}
                          {activeCompany.smartHomeEnabled ? ' · SmartHome' : ''}
                        </Text>
                      )}
                      {companiesError && (
                        <Text style={{ color: palette.roseText, fontSize: 10 }}>
                          No cargó empresas
                        </Text>
                      )}
                    </View>
                  </View>
                )}
              </View>

              {/* Selector de Modo Oscuro vs Modo Claro en Móvil */}
              <View
                style={[
                  styles.themeSection,
                  { borderBottomColor: palette.border },
                ]}
              >
                <Text style={[styles.sectionEyebrow, { color: palette.textSubtle }]}>
                  TEMA VISUAL MERAKI
                </Text>
                <ThemeToggle />
              </View>

              {/* Cuadrícula de 3 columnas con filas explícitas para paridad visual perfecta */}
              <View style={styles.moreGrid} collapsable={false}>
                {moreGridRows.map((row, rIdx) => (
                  <View key={`row-${rIdx}`} style={styles.moreGridRow} collapsable={false}>
                    {row.map((item) => {
                      const hasTransferAlert =
                        isAdmin && pendingTransfersCount > 0 && item.route === 'Leads';
                      return (
                        <Pressable
                          key={item.route}
                          onPress={() => handleOpenMoreRoute(item.route)}
                          style={({ pressed }) => [
                            styles.moreGridItem,
                            {
                              backgroundColor: pressed
                                ? palette.brandBg
                                : 'transparent',
                            },
                          ]}
                        >
                          <View style={styles.iconWrap}>
                            <Icon
                              name={item.icon}
                              size={23}
                              color={palette.isDark ? palette.textSecondary : palette.textPrimary}
                            />
                            {hasTransferAlert && (
                              <View style={styles.transferBadge}>
                                <Text style={styles.transferBadgeText}>{pendingTransfersCount}</Text>
                              </View>
                            )}
                          </View>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.moreGridLabel,
                              { color: palette.isDark ? palette.textSecondary : palette.textPrimary },
                            ]}
                          >
                            {item.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                    {row.length < 3 &&
                      Array.from({ length: 3 - row.length }).map((_, padIdx) => (
                        <View
                          key={`pad-${padIdx}`}
                          style={styles.moreGridItemPlaceholder}
                        />
                      ))}
                  </View>
                ))}
              </View>

              {/* Botón Buscar Actualizaciones OTA */}
              <View style={[styles.logoutSection, { borderTopColor: palette.border, paddingBottom: 6 }]}>
                <Pressable
                  onPress={() => {
                    void checkAndApplyUpdate(false);
                  }}
                  style={({ pressed }) => [
                    styles.logoutBtn,
                    {
                      backgroundColor: pressed ? palette.brandBg : 'transparent',
                      borderWidth: 1,
                      borderColor: palette.border,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      flexDirection: 'row',
                      alignItems: 'center',
                    },
                  ]}
                >
                  <Icon name="RefreshCw" size={16} color={palette.brand} />
                  <Text style={[styles.logoutText, { color: palette.textPrimary, fontWeight: '600', marginLeft: 8 }]}>
                    Buscar actualizaciones
                  </Text>
                  <Text style={{ fontSize: 11, color: palette.textSubtle, marginLeft: 'auto' }}>
                    v1.0.52
                  </Text>
                </Pressable>
              </View>

              {/* Botón Cerrar Sesión */}
              <View style={[styles.logoutSection, { borderTopColor: 'transparent', paddingTop: 0 }]}>
                <Pressable
                  onPress={() => {
                    setMoreOpen(false);
                    void signOut();
                  }}
                  style={({ pressed }) => [
                    styles.logoutBtn,
                    { backgroundColor: pressed ? palette.roseBg : 'transparent' },
                  ]}
                >
                  <Icon name="LogOut" size={16} color={palette.roseText} />
                  <Text style={[styles.logoutText, { color: palette.roseText }]}>
                    Cerrar sesión
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export function AppNavigator() {
  const { user, profile, loading } = useAuth();
  const { palette } = useTheme();

  if (loading) {
    return (
      <View style={[styles.loading, { backgroundColor: palette.bgCanvas }]}>
        <ActivityIndicator color={palette.brand} size="large" />
      </View>
    );
  }

  if (!user || !profile) {
    return <LoginScreen />;
  }

  return (
    <View style={[styles.shell, { backgroundColor: palette.bgCanvas }]}>
      <Root.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bgCanvas },
          animation: 'slide_from_right',
        }}
      >
        <Root.Screen name="Main" component={MainShell} options={{ animation: 'none' }} />
        <Root.Screen name="Chat" component={ChatScreen} />
        <Root.Screen name="Leads" component={LeadsScreen} />
        <Root.Screen name="Calendario" component={CalendarScreen} />
        <Root.Screen name="Calls" component={CallsScreen} />
        <Root.Screen name="Database" component={DatabaseScreen} />
        <Root.Screen name="Marketing" component={MarketingScreen} />
        <Root.Screen name="Reports" component={ReportsScreen} />
        <Root.Screen name="Templates" component={TemplatesScreen} />
        <Root.Screen name="Broadcasts" component={BroadcastsScreen} />
        <Root.Screen name="Config" component={ConfigScreen} />
        <Root.Screen
          name="AdvisorWhatsapp"
          component={AdvisorWhatsappScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="ConfigAi"
          component={ConfigAiScreen}
          options={{ animation: 'slide_from_bottom' }}
        />
      </Root.Navigator>

      {/* Banner flotante global de llamadas entrantes WhatsApp */}
      <CallOverlay />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    paddingTop: 7,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 10,
    textAlign: 'center',
  },
  transferBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    backgroundColor: '#f43f5e',
    borderRadius: 999,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
  slaBanner: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    gap: 8,
  },
  slaBannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  slaBannerText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
  },
  slaUnblockBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  slaUnblockBtnText: {
    color: '#09090b',
    fontSize: 11,
    fontWeight: '700',
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheetCard: {
    width: '100%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    maxHeight: '86%',
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: 999,
  },
  userSection: {
    paddingHorizontal: 20,
    paddingTop: 6,
    paddingBottom: 10,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
  },
  userRole: {
    fontSize: 11,
    marginTop: 1,
  },
  companyBox: {
    marginTop: 10,
    gap: 4,
  },
  companyMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  companyMetaText: {
    fontSize: 10,
  },
  themeSection: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginBottom: 8,
    borderBottomWidth: 1,
    gap: 6,
  },
  sectionEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  moreGrid: {
    width: '100%',
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
  },
  moreGridRow: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  moreGridItem: {
    width: '33.33%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  moreGridItemPlaceholder: {
    width: '33.33%',
    paddingHorizontal: 4,
  },
  moreGridLabel: {
    fontSize: 11.5,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 4,
  },
  logoutSection: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
