import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../providers/AuthProvider';
import { colors } from '../theme/colors';
import type { MainTabsParams, RootStackParams } from '../types';
import { LoginScreen } from '../screens/LoginScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { InboxScreen } from '../screens/InboxScreen';
import { LeadsScreen } from '../screens/LeadsScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { MoreScreen } from '../screens/MoreScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { AdvisorWhatsappScreen } from '../screens/AdvisorWhatsappScreen';
import { ConfigAiScreen } from '../screens/ConfigAiScreen';
import { PhotoEvidenceScreen } from '../screens/PhotoEvidenceScreen';

const Root = createNativeStackNavigator<RootStackParams>();
const Tabs = createBottomTabNavigator<MainTabsParams>();

const icons: Record<keyof MainTabsParams, keyof typeof Ionicons.glyphMap> = {
  Resumen: 'grid-outline',
  Bandeja: 'chatbox-outline',
  Leads: 'people-outline',
  Calendario: 'calendar-outline',
  Mas: 'menu',
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 18);
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({
      headerShown: false,
      tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
      tabBarActiveTintColor: colors.brand,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: [styles.tabBar, { height: 58 + bottomPad, paddingBottom: bottomPad }],
      tabBarLabelStyle: styles.tabLabel,
      tabBarHideOnKeyboard: true,
    })}>
      <Tabs.Screen name="Resumen" component={DashboardScreen} />
      <Tabs.Screen name="Bandeja" component={InboxScreen} />
      <Tabs.Screen name="Leads" component={LeadsScreen} />
      <Tabs.Screen name="Calendario" component={CalendarScreen} />
      <Tabs.Screen name="Mas" component={MoreScreen} options={{ title: 'Mas' }} />
    </Tabs.Navigator>
  );
}

export function AppNavigator() {
  const { user, profile, loading } = useAuth();
  if (loading) return <View style={styles.loading}><ActivityIndicator color={colors.emerald} size="large" /></View>;
  if (!user || !profile) return <LoginScreen />;

  return (
    <Root.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
      <Root.Screen name="Main" component={MainTabs} />
      <Root.Screen name="Chat" component={ChatScreen} options={{ animation: 'slide_from_right' }} />
      <Root.Screen name="AdvisorWhatsapp" component={AdvisorWhatsappScreen} options={{ animation: 'slide_from_bottom', presentation: 'formSheet' }} />
      <Root.Screen name="ConfigAi" component={ConfigAiScreen} options={{ animation: 'slide_from_bottom', presentation: 'formSheet' }} />
      <Root.Screen name="PhotoEvidence" component={PhotoEvidenceScreen} options={{ animation: 'slide_from_right' }} />
    </Root.Navigator>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  tabBar: { paddingTop: 8, backgroundColor: '#08090A', borderTopColor: colors.border },
  tabLabel: { fontSize: 10, fontWeight: '700' },
});
