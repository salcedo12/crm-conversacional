import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  disconnectAdvisorWhatsapp,
  formatPairingCode,
  listAdvisorWhatsappConnections,
  pairingPhoneDigits,
  requestAdvisorWhatsappPairingCode,
  requestAdvisorWhatsappQr,
  type AdvisorWhatsappConnection,
  type AdvisorWhatsappQrResult,
  type AdvisorWhatsappStatus,
} from '../services/advisorWhatsapp';
import type { RootStackParams } from '../types';
import { formatPhone } from '../utils/formatPhone';

type Props = NativeStackScreenProps<RootStackParams, 'AdvisorWhatsapp'>;

export function AdvisorWhatsappScreen({ navigation }: Props) {
  const { profile, companyId } = useAuth();
  const { palette } = useTheme();
  const [connection, setConnection] = useState<AdvisorWhatsappConnection | null>(null);
  const [qrResult, setQrResult] = useState<AdvisorWhatsappQrResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [codePhone, setCodePhone] = useState('');
  const [showCodeForm, setShowCodeForm] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async (silent = false) => {
    if (!companyId || !profile) return;
    if (!silent) setLoading(true);
    try {
      const connections = await listAdvisorWhatsappConnections(companyId, profile.id);
      const next = connections[0] || null;
      setConnection(next);
      // Ya conectado: quitar el código/QR que quedó en pantalla.
      if (next?.status === 'connected') setQrResult((prev) => (prev && prev.status !== 'connected' ? null : prev));
    } catch (err) {
      console.warn('[AdvisorWhatsappScreen] load error', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(true), 30000);
    return () => clearInterval(interval);
  }, [companyId, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Con un código a la vista, revisar seguido para mostrar "Conectado" apenas
  // se escriba en WhatsApp.
  const waitingCode = !!qrResult?.pairingCode;
  useEffect(() => {
    if (!waitingCode) return;
    const interval = setInterval(() => void load(true), 5000);
    return () => clearInterval(interval);
  }, [waitingCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCodeForm = () => {
    setShowCodeForm((open) => !open);
    if (!codePhone && connection?.phone) setCodePhone(connection.phone.replace(/\D/g, ''));
  };

  const requestCode = async () => {
    if (!companyId || !profile || busy) return;
    const phone = pairingPhoneDigits(codePhone);
    if (phone.length < 10 || phone.length > 15) {
      Alert.alert('Número inválido', 'Escribe tu número con indicativo, por ejemplo 57 300 123 4567.');
      return;
    }
    setBusy(true);
    setQrResult(null);
    try {
      const result = await requestAdvisorWhatsappPairingCode(companyId, profile.id, phone);
      setQrResult(result);
      setShowCodeForm(false);
      await load(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'No se pudo generar el código.');
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!qrResult?.pairingCode) return;
    await Clipboard.setStringAsync(formatPairingCode(qrResult.pairingCode));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
  const statusColor =
    status === 'connected'
      ? {
          border: palette.emeraldBorder,
          bg: palette.emeraldBg,
          text: palette.emeraldText,
          icon: 'checkmark-circle' as const,
        }
      : status === 'qr_pending' || status === 'stale'
      ? {
          border: palette.amberBorder,
          bg: palette.amberBg,
          text: palette.amberText,
          icon: 'time' as const,
        }
      : status === 'error' || status === 'configuration_required'
      ? {
          border: palette.roseBorder,
          bg: palette.roseBg,
          text: palette.roseText,
          icon: 'warning' as const,
        }
      : {
          border: palette.borderStrong,
          bg: palette.bgElevated,
          text: palette.textMuted,
          icon: 'cloud-offline' as const,
        };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bgCanvas }]}>
      <ScreenHeader
        title="WhatsApp de Asesor"
        subtitle="Vincula tu número personal al CRM"
        onBack={() => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Main'))}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.card,
            { backgroundColor: palette.bgSurface, borderColor: palette.border },
          ]}
        >
          <View style={styles.cardHeader}>
            <View style={[styles.iconBox, { backgroundColor: palette.brandBg }]}>
              <Ionicons name="logo-whatsapp" size={24} color={palette.brandText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: palette.textPrimary }]}>
                {profile?.displayName}
              </Text>
              <Text style={[styles.phone, { color: palette.textMuted }]}>
                {connection?.phone ? formatPhone(connection.phone) : 'Sin número conectado'}
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                { borderColor: statusColor.border, backgroundColor: statusColor.bg },
              ]}
            >
              <Ionicons name={statusColor.icon} size={12} color={statusColor.text} />
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {getStatusLabel(status)}
              </Text>
            </View>
          </View>

          {status === 'connected' ? (
            <View
              style={[
                styles.alertBox,
                { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder },
              ]}
            >
              <Ionicons name="checkmark-circle" size={16} color={palette.emeraldText} />
              <Text style={[styles.alertText, { color: palette.emeraldText }]}>
                Activo para reflejar seguimientos manuales en el CRM.
              </Text>
            </View>
          ) : (
            <View
              style={[
                styles.alertBox,
                { backgroundColor: palette.amberBg, borderColor: palette.amberBorder },
              ]}
            >
              <Ionicons name="warning" size={16} color={palette.amberText} />
              <Text style={[styles.alertText, { color: palette.amberText }]}>
                {getIssueText(status)}
              </Text>
            </View>
          )}

          <View style={styles.actions}>
            <Pressable
              disabled={busy || loading}
              onPress={requestQr}
              style={[
                styles.primaryBtn,
                { backgroundColor: palette.brand },
                (busy || loading) && { opacity: 0.6 },
              ]}
            >
              {busy && !qrResult ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="qr-code" size={16} color="#ffffff" />
                  <Text style={styles.primaryBtnText}>Generar QR</Text>
                </>
              )}
            </Pressable>
            <Pressable
              disabled={busy || loading || !connection}
              onPress={disconnect}
              style={[
                styles.dangerBtn,
                { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                (busy || loading || !connection) && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="trash-outline" size={16} color={palette.roseText} />
              <Text style={[styles.dangerBtnText, { color: palette.roseText }]}>
                Desconectar
              </Text>
            </Pressable>
          </View>

          {status !== 'connected' ? (
            <Pressable
              disabled={busy || loading}
              onPress={openCodeForm}
              style={[
                styles.secondaryBtn,
                { borderColor: palette.borderStrong, backgroundColor: palette.bgElevated },
                (busy || loading) && { opacity: 0.6 },
              ]}
            >
              <Ionicons name="keypad-outline" size={16} color={palette.textPrimary} />
              <Text style={[styles.secondaryBtnText, { color: palette.textPrimary }]}>
                Vincular con código (sin QR)
              </Text>
            </Pressable>
          ) : null}

          {showCodeForm && status !== 'connected' ? (
            <View style={[styles.codeForm, { borderColor: palette.border, backgroundColor: palette.bgElevated }]}>
              <Text style={[styles.codeLabel, { color: palette.textPrimary }]}>Tu número de WhatsApp</Text>
              <TextInput
                value={codePhone}
                onChangeText={setCodePhone}
                placeholder="57 300 123 4567"
                placeholderTextColor={palette.textMuted}
                keyboardType="phone-pad"
                style={[
                  styles.codeInput,
                  { color: palette.textPrimary, borderColor: palette.borderStrong, backgroundColor: palette.bgSurface },
                ]}
              />
              <Text style={[styles.codeHint, { color: palette.textMuted }]}>
                Con indicativo de país (57 para Colombia).
              </Text>
              <Pressable
                disabled={busy}
                onPress={requestCode}
                style={[styles.primaryBtn, { backgroundColor: palette.brand, flex: 0 }, busy && { opacity: 0.6 }]}
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.primaryBtnText}>Generar código</Text>
                )}
              </Pressable>
            </View>
          ) : null}

          {qrResult?.pairingCode ? (
            <View
              style={[
                styles.qrContainer,
                { backgroundColor: palette.brandBg, borderColor: palette.brandBorder },
              ]}
            >
              <Text style={[styles.qrTitle, { color: palette.textPrimary }]}>Tu código de vinculación</Text>
              <Text selectable style={[styles.codeText, { color: palette.textPrimary }]}>
                {formatPairingCode(qrResult.pairingCode)}
              </Text>
              <Pressable
                onPress={copyCode}
                style={[styles.secondaryBtn, { borderColor: palette.brandBorder, alignSelf: 'stretch' }]}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={palette.brandText} />
                <Text style={[styles.secondaryBtnText, { color: palette.brandText }]}>
                  {copied ? 'Copiado' : 'Copiar código'}
                </Text>
              </Pressable>
              <Text style={[styles.qrSub, { color: palette.brandText, textAlign: 'left', alignSelf: 'stretch' }]}>
                1. Abre WhatsApp → Dispositivos vinculados.{'\n'}
                2. Toca «Vincular un dispositivo».{'\n'}
                3. Toca «Vincular con el número de teléfono» y pega el código.{'\n'}
                Vence en unos minutos; si vence, genera otro.
              </Text>
            </View>
          ) : null}

          {qrResult?.qrCodeDataUrl ? (
            <View
              style={[
                styles.qrContainer,
                { backgroundColor: palette.brandBg, borderColor: palette.brandBorder },
              ]}
            >
              <View style={styles.qrBg}>
                <Image
                  source={{ uri: qrResult.qrCodeDataUrl }}
                  style={styles.qrImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.qrTitle, { color: palette.textPrimary }]}>
                Escanear desde WhatsApp
              </Text>
              <Text style={[styles.qrSub, { color: palette.brandText }]}>
                Abre Dispositivos vinculados en tu WhatsApp o compártelo para escanearlo.
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
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

function getIssueText(status: AdvisorWhatsappStatus) {
  if (status === 'configuration_required') return 'Falta configurar el puente del servidor.';
  if (status === 'qr_pending') return 'Hay un QR pendiente por escanear.';
  if (status === 'stale') return 'La sesión se venció. Conviene reconectar.';
  if (status === 'error') return 'La conexión reportó un error.';
  return 'Este WhatsApp está desconectado.';
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16 },
  card: { padding: 16, borderRadius: 12, borderWidth: 1, gap: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontSize: 15, fontWeight: '700' },
  phone: { fontSize: 13, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusText: { fontSize: 10, fontWeight: '700' },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  alertText: { flex: 1, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10 },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  dangerBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dangerBtnText: { fontSize: 13, fontWeight: '700' },
  secondaryBtn: {
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700' },
  codeForm: { padding: 12, borderRadius: 10, borderWidth: 1, gap: 8 },
  codeLabel: { fontSize: 13, fontWeight: '700' },
  codeInput: { height: 44, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  codeHint: { fontSize: 11 },
  codeText: { fontSize: 30, fontWeight: '800', letterSpacing: 4, marginVertical: 12, fontVariant: ['tabular-nums'] },
  qrContainer: {
    marginTop: 8,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
  qrBg: { padding: 12, borderRadius: 12, backgroundColor: '#FFFFFF', marginBottom: 12 },
  qrImage: { width: 200, height: 200 },
  qrTitle: { fontSize: 14, fontWeight: '700' },
  qrSub: { fontSize: 12, textAlign: 'center', marginTop: 4 },
});
