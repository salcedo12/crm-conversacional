import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import { Icon, type LucideIconName } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import type { MainTabsParams, RootStackParams } from '../types';

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

export function StandaloneBottomNavBar({
  activeTab = 'Bandeja',
}: {
  activeTab?: keyof MainTabsParams;
}) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { profile, isAdmin, signOut } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  const bottomPad = Math.max(insets.bottom, 6);

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

  const handlePressTab = (tabName: keyof MainTabsParams) => {
    setMoreOpen(false);
    navigation.navigate('Main', { screen: tabName });
  };

  const handleOpenMoreRoute = (route: keyof RootStackParams) => {
    setMoreOpen(false);
    navigation.navigate(route);
  };

  return (
    <>
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
        {PRIMARY_TABS.map((tab) => {
          const isFocused = !moreOpen && activeTab === tab.name;
          const tint = isFocused
            ? palette.isDark
              ? palette.brandLight
              : palette.brandDark
            : palette.textSubtle;

          return (
            <Pressable
              key={tab.name}
              onPress={() => handlePressTab(tab.name)}
              style={styles.tabBtn}
              accessibilityRole="tab"
            >
              <View style={styles.iconWrap}>
                <Icon name={tab.icon} size={21} color={tint} />
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

        <Pressable
          onPress={() => setMoreOpen((v) => !v)}
          style={styles.tabBtn}
          accessibilityRole="button"
        >
          <Icon
            name="Menu"
            size={21}
            color={
              moreOpen
                ? palette.isDark
                  ? palette.brandLight
                  : palette.brandDark
                : palette.textSubtle
            }
          />
          <Text
            numberOfLines={1}
            style={[
              styles.tabLabel,
              {
                color: moreOpen
                  ? palette.isDark
                    ? palette.brandLight
                    : palette.brandDark
                  : palette.textSubtle,
                fontWeight: moreOpen ? '600' : '500',
              },
            ]}
          >
            Más
          </Text>
        </Pressable>
      </View>

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
            <View style={styles.handleRow}>
              <View style={[styles.handleBar, { backgroundColor: palette.borderStrong }]} />
            </View>

            <ScrollView
              style={{ width: '100%' }}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ width: '100%', paddingBottom: 16 }}
            >
              <View style={styles.userSection}>
                <Text style={[styles.userName, { color: palette.textPrimary }]} numberOfLines={1}>
                  {profile?.displayName ?? profile?.email ?? '—'}
                </Text>
                <Text style={[styles.userRole, { color: palette.textSubtle }]} numberOfLines={1}>
                  {profile?.role ?? ''}
                </Text>
              </View>

              <View style={[styles.themeSection, { borderBottomColor: palette.border }]}>
                <Text style={[styles.sectionEyebrow, { color: palette.textSubtle }]}>
                  TEMA VISUAL MERAKI
                </Text>
                <ThemeToggle />
              </View>

              <View style={styles.moreGrid}>
                {moreGridRows.map((row, rIdx) => (
                  <View key={`row-${rIdx}`} style={styles.moreGridRow}>
                    {row.map((item) => (
                      <Pressable
                        key={item.route}
                        onPress={() => handleOpenMoreRoute(item.route)}
                        style={({ pressed }) => [
                          styles.moreGridItem,
                          {
                            backgroundColor: pressed ? palette.brandBg : 'transparent',
                          },
                        ]}
                      >
                        <View style={styles.iconWrap}>
                          <Icon
                            name={item.icon}
                            size={23}
                            color={palette.isDark ? palette.textSecondary : palette.textPrimary}
                          />
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
                    ))}
                    {row.length < 3 &&
                      Array.from({ length: 3 - row.length }).map((_, padIdx) => (
                        <View key={`pad-${padIdx}`} style={styles.moreGridItemPlaceholder} />
                      ))}
                  </View>
                ))}
              </View>

              <View style={[styles.logoutSection, { borderTopColor: palette.border }]}>
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
    </>
  );
}

const styles = StyleSheet.create({
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
