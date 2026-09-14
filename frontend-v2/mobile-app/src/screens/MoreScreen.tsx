import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { requestAndRegisterPush } from '../services/notifications';
import { colors } from '../theme/colors';
import { initials } from '../utils/format';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { RootStackParams } from '../types';

export function MoreScreen() {
  const { profile, companyId, signOut } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParams>>();
  const testNotifications = async () => {
    if (!companyId) return;
    try {
      await requestAndRegisterPush(companyId);
      Alert.alert('Notificaciones activas', 'Este dispositivo quedo registrado para recibir mensajes.');
    } catch {
      Alert.alert('No se pudieron activar', 'Revisa los permisos de notificaciones del dispositivo.');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader title="Más" subtitle="Cuenta y herramientas" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{initials(profile?.displayName)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{profile?.displayName}</Text>
            <Text style={styles.email}>{profile?.email}</Text>
            <Text style={styles.role}>{profile?.role === 'admin' ? 'ADMINISTRADOR' : profile?.role === 'manager' ? 'MANAGER' : profile?.role === 'viewer' ? 'ESPECTADOR' : 'ASESOR'}</Text>
          </View>
        </View>
        <Text style={styles.section}>DISPOSITIVO Y HERRAMIENTAS</Text>
        <View style={styles.panel}>
          <Menu icon="camera-outline" title="Evidencia fotográfica" subtitle="Registro de fotos y visitas a SmartHome" onPress={() => navigation.navigate('PhotoEvidence')} />
          <Menu icon="logo-whatsapp" title="WhatsApp Asesor" subtitle="Escanea para vincular tu número personal" onPress={() => navigation.navigate('AdvisorWhatsapp')} />
          {profile?.role !== 'viewer' ? <Menu icon="hardware-chip-outline" title="Asistente de IA" subtitle="Configura la personalidad y reglas" onPress={() => navigation.navigate('ConfigAi')} /> : null}
          <Menu icon="notifications-outline" title="Notificaciones" subtitle="Revisar y renovar el registro push" onPress={testNotifications} />
          <Menu icon="settings-outline" title="Ajustes del sistema" subtitle="Permisos, sonido y bateria" onPress={() => Linking.openSettings()} last />
        </View>
        <Text style={styles.section}>SOPORTE</Text>
        <View style={styles.panel}>
          <Menu icon="help-circle-outline" title="Ayuda" subtitle="Contacta al administrador de tu empresa" />
          <Menu icon="shield-checkmark-outline" title="Privacidad" subtitle="Datos protegidos por tu cuenta" last />
        </View>
        <Pressable onPress={() => Alert.alert('Cerrar sesion', '¿Deseas salir de este dispositivo?', [{ text: 'Cancelar' }, { text: 'Salir', style: 'destructive', onPress: signOut }])} style={styles.logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.red} />
          <Text style={styles.logoutText}>Cerrar sesion</Text>
        </Pressable>
        <Text style={styles.version}>Meraki CRM para asesores · v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Menu({ icon, title, subtitle, onPress, last }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; onPress?: () => void; last?: boolean }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.menu, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: colors.raised }]}><View style={styles.menuIcon}><Ionicons name={icon} size={20} color={colors.brand} /></View><View style={{ flex: 1 }}><Text style={styles.menuTitle}>{title}</Text><Text style={styles.menuSubtitle}>{subtitle}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.faint} /></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 30 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface },
  avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandDark, borderWidth: 1, borderColor: colors.brandBorder },
  avatarText: { color: colors.brand, fontWeight: '800', fontSize: 15 },
  name: { color: colors.text, fontSize: 15, fontWeight: '800' },
  email: { color: colors.muted, fontSize: 11, marginTop: 3 },
  role: { alignSelf: 'flex-start', color: colors.brand, backgroundColor: colors.brandDark, fontSize: 8, fontWeight: '800', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4, marginTop: 7 },
  section: { color: colors.faint, fontSize: 9, fontWeight: '800', marginTop: 23, marginBottom: 8 },
  panel: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surface },
  menu: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  menuIcon: { width: 38, height: 38, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.brandDark },
  menuTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  menuSubtitle: { color: colors.muted, fontSize: 10, marginTop: 3 },
  logout: { height: 52, marginTop: 24, flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#51272A', backgroundColor: '#201214', borderRadius: 8 },
  logoutText: { color: colors.red, fontSize: 13, fontWeight: '700' },
  version: { color: colors.faint, textAlign: 'center', fontSize: 9, marginTop: 18 },
});
