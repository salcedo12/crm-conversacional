import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import {
  disconnectAdvisorWhatsapp,
  listAdvisorWhatsappConnections,
  requestAdvisorWhatsappQr,
  type AdvisorWhatsappConnection,
  type AdvisorWhatsappQrResult,
  type AdvisorWhatsappStatus,
} from '../services/advisorWhatsapp';
import { colors } from '../theme/colors';
import type { RootStackParams } from '../types';
import { formatPhone } from '../utils/formatPhone';

type Props = NativeStackScreenProps<RootStackParams, 'AdvisorWhatsapp'>;

export function AdvisorWhatsappScreen({ navigation }: Props) {
  const { profile, companyId } = useAuth();
  const [connection, setConnection] = useState<AdvisorWhatsappConnection | null>(null);
  const [qrResult, setQrResult] = useState<AdvisorWhatsappQrResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async (silent = false) => {
    if (!companyId || !profile) return;
    if (!silent) setLoading(true);
    try {
      const connections = await listAdvisorWhatsappConnections(companyId, profile.id);
      setConnection(connections[0] || null);
    } catch (err) {
      console.warn('[AdvisorWhatsappScreen] load error', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [companyId, profile?.id]);

  const requestQr = async () => {
    if (!companyId || !profile || busy) return;
    setBusy(true);
    setQrResult(null);
    try {
      const result = await requestAdvisorWhatsappQr(companyId, profile.id);
      setQrResult(result);
      await load(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo generar el QR.');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!companyId || !profile || busy) return;
    Alert.alert('Desconectar', '¿Seguro que quieres desconectar tu WhatsApp?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desconectar',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await disconnectAdvisorWhatsapp(companyId, profile.id);
            setQrResult(null);
            await load(true);
          } catch {
            Alert.alert('Error', 'No se pudo desconectar.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const status = connection?.status || 'disconnected';
  const statusColor = getStatusColor(status);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenHeader title="WhatsApp de Asesor" subtitle="Vincula tu número personal" action={<Pressable onPress={() => navigation.goBack()}><Ionicons name="close" size={24} color={colors.text} /></Pressable>} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}><Ionicons name="logo-whatsapp" size={24} color={colors.brand} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{profile?.displayName}</Text>
              <Text style={styles.phone}>{connection?.phone ? formatPhone(connection.phone) : 'Sin número conectado'}</Text>
            </View>
            <View style={[styles.statusBadge, { borderColor: statusColor.border, backgroundColor: statusColor.bg }]}>
              <Ionicons name={statusColor.icon} size={12} color={statusColor.text} />
              <Text style={[styles.statusText, { color: statusColor.text }]}>{getStatusLabel(status)}</Text>
            </View>
          </View>

          {status === 'connected' ? (
            <View style={styles.alertSuccess}>
              <Ionicons name="checkmark-circle" size={16} color={colors.emerald} />
              <Text style={styles.alertSuccessText}>Activo para reflejar seguimientos manuales en el CRM.</Text>
            </View>
          ) : (
            <View style={styles.alertWarning}>
              <Ionicons name="warning" size={16} color={colors.amber} />
              <Text style={styles.alertWarningText}>{getIssueText(status)}</Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable disabled={busy || loading} onPress={requestQr} style={styles.primaryBtn}>
              {busy && !qrResult ? <ActivityIndicator size="small" color={colors.background} /> : <><Ionicons name="qr-code" size={16} color={colors.background} /><Text style={styles.primaryBtnText}>Generar QR</Text></>}
            </Pressable>
            <Pressable disabled={busy || loading || !connection} onPress={disconnect} style={styles.dangerBtn}>
              <Ionicons name="trash" size={16} color={colors.red} />
              <Text style={styles.dangerBtnText}>Desconectar</Text>
            </Pressable>
          </View>

          {qrResult?.qrCodeDataUrl ? (
            <View style={styles.qrContainer}>
              <View style={styles.qrBg}>
                <Image source={{ uri: qrResult.qrCodeDataUrl }} style={styles.qrImage} resizeMode="contain" />
              </View>
              <Text style={styles.qrTitle}>Escanear desde WhatsApp</Text>
              <Text style={styles.qrSub}>Toma otro celular o compártelo para escanear.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function getStatusLabel(status: AdvisorWhatsappStatus) {
  if (status === 'connected') return 'Conectado';
  if (status === 'qr_pending') return 'Esperando QR';
  if (status === 'stale') return 'Sesión vencida';
  if (status === 'error') return 'Con error';
  if (status === 'configuration_required') return 'Falta configurar';
  return 'Desconectado';
}

function getStatusColor(status: AdvisorWhatsappStatus) {
  if (status === 'connected') return { border: '#10B98140', bg: '#10B9811A', text: '#6EE7B7', icon: 'checkmark-circle' as const };
  if (status === 'qr_pending') return { border: '#F59E0B40', bg: '#F59E0B1A', text: '#FCD34D', icon: 'time' as const };
  if (status === 'stale') return { border: '#F9731640', bg: '#F973161A', text: '#FDBA74', icon: 'warning' as const };
  if (status === 'error' || status === 'configuration_required') return { border: '#EF444440', bg: '#EF44441A', text: '#FCA5A5', icon: 'warning' as const };
  return { border: '#3F3F46', bg: '#27272A', text: '#D4D4D8', icon: 'cloud-offline' as const };
}

function getIssueText(status: AdvisorWhatsappStatus) {
  if (status === 'configuration_required') return 'Falta configurar el puente del servidor.';
  if (status === 'qr_pending') return 'Hay un QR pendiente por escanear.';
  if (status === 'stale') return 'La sesión se venció. Conviene reconectar.';
  if (status === 'error') return 'La conexión reportó un error.';
  return 'Este WhatsApp está desconectado.';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.brandDark, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  phone: { color: colors.muted, fontSize: 13, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusText: { fontSize: 10, fontWeight: '800' },
  alertSuccess: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#10B9811A', borderWidth: 1, borderColor: '#10B98140' },
  alertSuccessText: { flex: 1, color: '#6EE7B7', fontSize: 12, lineHeight: 18 },
  alertWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#F59E0B1A', borderWidth: 1, borderColor: '#F59E0B40' },
  alertWarningText: { flex: 1, color: '#FCD34D', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryBtn: { flex: 1, height: 44, borderRadius: 8, backgroundColor: colors.brand, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryBtnText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  dangerBtn: { flex: 1, height: 44, borderRadius: 8, backgroundColor: colors.raised, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dangerBtnText: { color: colors.red, fontSize: 14, fontWeight: '800' },
  qrContainer: { marginTop: 8, padding: 16, borderRadius: 12, backgroundColor: '#8B5CF61A', borderWidth: 1, borderColor: '#8B5CF640', alignItems: 'center' },
  qrBg: { padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', marginBottom: 12 },
  qrImage: { width: 200, height: 200 },
  qrTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  qrSub: { color: '#C4B5FD', fontSize: 12, textAlign: 'center', marginTop: 4 },
});
