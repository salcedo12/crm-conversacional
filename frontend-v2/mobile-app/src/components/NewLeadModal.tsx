import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../providers/AuthProvider';
import { useTheme } from '../providers/ThemeProvider';
import {
  buildInternationalPhone,
  checkPhoneAvailability,
  createContactFull,
  requestLeadTransfer,
  type PhoneAvailabilityResult,
} from '../services/contacts';
import {
  subscribeLeadSources,
  type Advisor,
  type LeadSourceItem,
} from '../services/enterprise';
import { CountryPhoneInput } from './CountryPhoneInput';
import { SelectModal } from './SelectModal';
import { Button } from './Button';
import { Icon } from './Icon';

export const MERAKI_PROJECT_OPTIONS = [
  { id: 'Cañón de Arizona', label: 'Cañón de Arizona (San Francisco / Las Vegas / Colorado / Texas / LA)' },
  { id: 'Río Claro', label: 'Río Claro (Río Lagunilla / Río Medina)' },
  { id: 'Laguna Mar', label: 'Laguna Mar (Melgar: Mar Canarias / Mar Santorini)' },
  { id: 'Sobre Montañas', label: 'Sobre Montañas de Alvarado (17 Aldeas)' },
  { id: 'Llano Grande', label: 'Llano Grande (Santa Helena / Guatapé / Poblado / San Antonio)' },
  { id: 'Proyectos de Ibagué', label: 'Proyectos de Ibagué' },
];

interface NewLeadModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  advisors?: Advisor[];
  onCreated: (leadId: string, existed: boolean) => void;
}

export function NewLeadModal({
  isOpen,
  onClose,
  companyId,
  advisors = [],
  onCreated,
}: NewLeadModalProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const { user, profile, isAdmin } = useAuth();

  const [name, setName] = useState('');
  const [countryIso, setCountryIso] = useState('co');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [project, setProject] = useState(MERAKI_PROJECT_OPTIONS[0].id);
  const [assignedTo, setAssignedTo] = useState(user?.uid || '');
  const [notes, setNotes] = useState('');
  const [sources, setSources] = useState<LeadSourceItem[]>([]);
  const [selectedSource, setSelectedSource] = useState('Trabajo de campo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [checkingPhone, setCheckingPhone] = useState(false);
  const [phoneCheck, setPhoneCheck] = useState<PhoneAvailabilityResult | null>(null);
  const [transferReason, setTransferReason] = useState('');
  const [requestingTransfer, setRequestingTransfer] = useState(false);
  const [transferRequested, setTransferRequested] = useState(false);

  useEffect(() => {
    if (!companyId || !isOpen) return;
    return subscribeLeadSources(companyId, (items) => {
      const actives = items.filter((s) => s.active);
      setSources(actives);
      if (actives.length > 0) {
        setSelectedSource((prev) => {
          if (actives.some((s) => s.name === prev)) return prev;
          const def = actives.find((s) => s.name === 'Trabajo de campo') || actives[0];
          return def.name;
        });
      }
    });
  }, [companyId, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setAssignedTo(user?.uid || '');
      setError(null);
      setTransferRequested(false);
    }
  }, [isOpen, user?.uid]);

  const { fullPhone, isValidLength } = buildInternationalPhone(countryIso, phone);

  useEffect(() => {
    if (!isOpen || !companyId) return;
    setTransferRequested(false);
    if (!isValidLength || !fullPhone) {
      setPhoneCheck(null);
      setCheckingPhone(false);
      return;
    }

    let cancelled = false;
    setCheckingPhone(true);
    const timer = setTimeout(async () => {
      try {
        const res = await checkPhoneAvailability(companyId, fullPhone);
        if (cancelled) return;
        setPhoneCheck(res);
        if (res.hasPendingRequest) setTransferRequested(true);
        if ((res.status === 'reclaimable' || res.status === 'own') && res.leadName && res.leadName !== 'Sin Nombre') {
          setName((prev) => (prev.trim() ? prev : res.leadName!));
        }
      } catch {
        if (!cancelled) setPhoneCheck(null);
      } finally {
        if (!cancelled) setCheckingPhone(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fullPhone, isValidLength, companyId, isOpen]);

  if (!isOpen) return null;

  const isLockedForAdvisor = !isAdmin && phoneCheck?.status === 'locked_by_other';
  const canSubmit = isValidLength && name.trim().length > 0 && !saving && !checkingPhone && !isLockedForAdvisor;

  const handleRequestTransfer = async () => {
    if (!companyId || !phoneCheck?.leadId || requestingTransfer) return;
    setRequestingTransfer(true);
    setError(null);
    try {
      await requestLeadTransfer({
        companyId,
        leadId: phoneCheck.leadId,
        phone: fullPhone,
        reason: transferReason.trim() || notes.trim() || 'Solicitud de traslado desde registro de prospecto',
      });
      setTransferRequested(true);
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar la solicitud de traslado.');
    } finally {
      setRequestingTransfer(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    try {
      const res = await createContactFull({
        companyId,
        name: name.trim() || undefined,
        phone: fullPhone,
        email: email.trim() || undefined,
        project,
        tags: ['outbound_propio'],
        assignedTo: isAdmin && assignedTo ? assignedTo : user?.uid || undefined,
        notes: notes.trim() || undefined,
        fuenteUbicacion: selectedSource || 'Trabajo de campo',
      });
      setName('');
      setPhone('');
      setEmail('');
      setNotes('');
      onCreated(res.leadId, res.existed);
      onClose();
    } catch (err: any) {
      let msg = err?.message || 'No se pudo crear el prospecto.';
      if (typeof msg === 'string') {
        if (msg.includes('already-exists')) msg = msg.replace(/^.*already-exists[:\s]*/i, '');
        else if (msg.includes('invalid-argument')) msg = msg.replace(/^.*invalid-argument[:\s]*/i, '');
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const sourceSelectOptions =
    sources.length > 0
      ? sources.map((s) => ({ value: s.name, label: s.name }))
      : [
          { value: 'Trabajo de campo', label: 'Trabajo de campo' },
          { value: 'Referidos', label: 'Referidos' },
          { value: 'Redes Sociales', label: 'Redes Sociales' },
          { value: 'PAUTA WHATSAPP 317', label: 'PAUTA WHATSAPP 317' },
          { value: 'Marketing', label: 'Marketing' },
          { value: 'Página Web', label: 'Página Web' },
        ];

  const advisorOptions = advisors.map((adv) => ({
    value: adv.id,
    label: `${adv.displayName}${adv.id === user?.uid ? ' (Tú)' : ''}`,
  }));

  return (
    <Modal visible={isOpen} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: palette.backdrop }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: palette.bgCard,
              borderColor: palette.border,
              height: '92%',
              maxHeight: '92%',
            },
          ]}
        >
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.bgDrawerHeader }]}>
            <View style={[styles.iconBox, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
              <Icon name="UserPlus" size={18} color={palette.brandText} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.titleRow}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>Nuevo Prospecto</Text>
                <View style={[styles.outboundPill, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
                  <Text style={{ fontSize: 9, fontWeight: '800', color: palette.brandText }}>OUTBOUND PROPIO</Text>
                </View>
              </View>
              <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 1 }}>
                Registra captación propia nacional o internacional para tu meta mensual.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              style={[styles.closeBtn, { backgroundColor: palette.bgElevated }]}
            >
              <Icon name="X" size={16} color={palette.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={true}
          >
            {/* Teléfono */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>
                  📞 Teléfono Celular <Text style={{ color: palette.rose }}>*</Text>
                </Text>
                {checkingPhone ? (
                  <View style={styles.titleRow}>
                    <ActivityIndicator size="small" color={palette.brand} />
                    <Text style={{ fontSize: 10, color: palette.brandText }}>Validando...</Text>
                  </View>
                ) : fullPhone && isValidLength ? (
                  <Text style={{ fontSize: 10, color: palette.emeraldText, fontWeight: '700' }}>{fullPhone}</Text>
                ) : null}
              </View>
              <CountryPhoneInput
                countryIso={countryIso}
                onCountryChange={setCountryIso}
                phone={phone}
                onPhoneChange={setPhone}
                statusBorder={
                  phoneCheck?.status === 'available'
                    ? 'available'
                    : phoneCheck?.status === 'reclaimable'
                    ? 'reclaimable'
                    : phoneCheck?.status === 'locked_by_other'
                    ? 'locked_by_other'
                    : 'default'
                }
              />
            </View>

            {/* Tarjeta Validación en Tiempo Real */}
            {phoneCheck && phoneCheck.status !== 'invalid' && (
              <View
                style={[
                  styles.checkCard,
                  phoneCheck.status === 'available'
                    ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
                    : phoneCheck.status === 'own'
                    ? { backgroundColor: palette.skyBg, borderColor: palette.skyBorder }
                    : phoneCheck.status === 'reclaimable'
                    ? { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }
                    : { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                ]}
              >
                {phoneCheck.status === 'available' && (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.emeraldText }}>
                      ✓ Número disponible para registro ({fullPhone})
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}>
                      No existe en el CRM. Quedará asignado con exclusividad a tu cuenta.
                    </Text>
                  </View>
                )}
                {phoneCheck.status === 'own' && (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.skyText }}>
                      ✨ Ya está asignado a tu cuenta ({phoneCheck.leadName})
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}>
                      Al guardar se actualizará su proyecto de interés y se agregará la nueva nota a su bitácora.
                    </Text>
                  </View>
                )}
                {phoneCheck.status === 'reclaimable' && (
                  <View>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: palette.amberText }}>
                      🔄 Disponible para reclamar (&gt;30 días sin seguimiento activo)
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}>
                      Libre por caducidad de exclusividad. Puedes reclamarlo directamente a tu cartera.
                    </Text>
                  </View>
                )}
                {phoneCheck.status === 'locked_by_other' && (
                  <View style={{ gap: 8 }}>
                    {isAdmin ? (
                      <View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: palette.roseText }}>
                          🛡️ Asignado actualmente a {phoneCheck.advisorName || 'otro asesor'}
                        </Text>
                        <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}>
                          Cliente: {phoneCheck.leadName} ·{' '}
                          {typeof phoneCheck.daysSinceActivity === 'number'
                            ? `Último seguimiento hace ${phoneCheck.daysSinceActivity} día(s)`
                            : 'Sin seguimiento registrado'}
                          . Como Administrador puedes guardarlo para reasignarlo.
                        </Text>
                      </View>
                    ) : (
                      <View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: palette.roseText }}>
                          🛡️ Este número ya está asignado a otro asesor
                        </Text>
                        <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 2 }}>
                          Por políticas de exclusividad no puede registrarse nuevamente. Solicita el traslado al Administrador:
                        </Text>
                      </View>
                    )}

                    {!isAdmin && phoneCheck.leadId && (
                      <View style={{ gap: 6, marginTop: 4 }}>
                        {transferRequested ? (
                          <View style={[styles.transferOk, { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }]}>
                            <Text style={{ fontSize: 11, color: palette.emeraldText, fontWeight: '600' }}>
                              ✓ Solicitud enviada al Administrador. Te notificaremos apenas sea revisada.
                            </Text>
                          </View>
                        ) : (
                          <>
                            <TextInput
                              value={transferReason}
                              onChangeText={setTransferReason}
                              placeholder="Motivo (ej: El cliente me contactó en sala de ventas)..."
                              placeholderTextColor={palette.placeholder}
                              style={[
                                styles.input,
                                { backgroundColor: palette.bgInput, borderColor: palette.roseBorder, color: palette.textPrimary },
                              ]}
                            />
                            <Pressable
                              onPress={handleRequestTransfer}
                              disabled={requestingTransfer}
                              style={[styles.transferBtn, { backgroundColor: palette.brand }]}
                            >
                              <Icon name="Send" size={12} color="#ffffff" />
                              <Text style={{ color: '#ffffff', fontSize: 11, fontWeight: '800' }}>
                                {requestingTransfer ? 'Enviando solicitud...' : 'Solicitar Traslado al Administrador'}
                              </Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            {/* Correo */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>✉️ Correo Electrónico</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="opcional@correo.com"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            </View>

            {/* Nombre */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>
                👤 Nombre del Cliente <Text style={{ color: palette.rose }}>*</Text>
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Ej: Carlos Alberto Mendoza"
                placeholderTextColor={palette.placeholder}
                style={[styles.input, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            </View>

            {/* Fuente de Ubicación */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>🧭 Fuente de Ubicación / Origen *</Text>
                <Text style={{ fontSize: 10, color: palette.textSubtle }}>¿De dónde viene el dato?</Text>
              </View>
              <SelectModal
                value={selectedSource}
                options={sourceSelectOptions}
                onChange={setSelectedSource}
                title="Seleccionar Fuente de Ubicación"
                searchable
              />
            </View>

            {/* Proyecto */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>🏢 Proyecto de Interés</Text>
              <SelectModal
                value={project}
                options={MERAKI_PROJECT_OPTIONS.map((p) => ({ value: p.id, label: p.label }))}
                onChange={setProject}
                title="Proyecto de Interés"
              />
            </View>

            {/* Asesor Asignado */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>Asesor Asignado</Text>
              {isAdmin && advisorOptions.length > 0 ? (
                <SelectModal
                  value={assignedTo}
                  options={advisorOptions}
                  onChange={setAssignedTo}
                  title="Asignar Asesor"
                />
              ) : (
                <View style={[styles.readonlyBox, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}>
                  <Text style={{ fontSize: 12, color: palette.textPrimary, fontWeight: '600' }}>
                    {profile?.displayName || user?.displayName || 'Asesor Actual'}
                  </Text>
                  <Text style={{ fontSize: 10, color: palette.emeraldText, fontWeight: '700' }}>
                    ✓ Asignación Directa (Exclusiva)
                  </Text>
                </View>
              )}
            </View>

            {/* Notas iniciales */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: palette.textSecondary }]}>📝 Bitácora Inicial / ¿Cómo se captó?</Text>
              <TextInput
                multiline
                numberOfLines={2}
                value={notes}
                onChangeText={setNotes}
                placeholder="Ej: Captado en sala de ventas, referido de familiar, interesado en lote con vista..."
                placeholderTextColor={palette.placeholder}
                style={[styles.textArea, { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary }]}
              />
            </View>

            <View style={[styles.protocolBox, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
              <Text style={{ fontSize: 11, color: palette.textSecondary, lineHeight: 16 }}>
                <Text style={{ fontWeight: '700', color: palette.brandText }}>🛡️ Protocolo de Exclusividad:</Text> Este prospecto queda asignado de forma directa y no rota en el reparto público de pauta.
              </Text>
            </View>

            {error ? (
              <View style={[styles.checkCard, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: palette.roseText }}>⚠️ {error}</Text>
              </View>
            ) : null}
          </ScrollView>

          {/* Fixed Bottom Action Footer */}
          <View
            style={[
              styles.fixedFooter,
              {
                backgroundColor: palette.bgElevated,
                borderTopColor: palette.border,
                paddingBottom: Math.max(insets.bottom + 8, 14),
              },
            ]}
          >
            {!canSubmit && (phone.length > 0 || name.length > 0) && (
              <View style={styles.hintRow}>
                <Text style={[styles.hintText, { color: palette.amberText }]}>
                  {!isValidLength
                    ? '⚠️ Ingresa los dígitos completos del teléfono celular'
                    : !name.trim()
                    ? '⚠️ Ingresa el nombre del prospecto'
                    : isLockedForAdvisor
                    ? '🛡️ Número asignado a otro asesor (solicita traslado arriba)'
                    : ''}
                </Text>
              </View>
            )}
            <View style={styles.footerBtnsRow}>
              <Pressable
                onPress={onClose}
                disabled={saving}
                style={({ pressed }) => [
                  styles.cancelBtn,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.cancelBtnText, { color: palette.textSecondary }]}>
                  Cancelar
                </Text>
              </Pressable>

              <Pressable
                onPress={handleSubmit}
                disabled={!canSubmit || saving}
                style={({ pressed }) => [
                  styles.createLeadBtn,
                  {
                    backgroundColor: !canSubmit
                      ? 'rgba(183, 135, 28, 0.45)'
                      : pressed
                      ? '#947018'
                      : '#B7871C',
                    borderColor: !canSubmit
                      ? 'rgba(217, 181, 69, 0.35)'
                      : '#D9B545',
                    opacity: saving ? 0.7 : 1,
                  },
                ]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Icon name="UserPlus" size={15} color="#ffffff" />
                    <Text style={styles.createLeadBtnText}>
                      {phoneCheck?.status === 'reclaimable'
                        ? 'Reclamar y Asignarme Prospecto'
                        : phoneCheck?.status === 'own'
                        ? 'Actualizar Mi Prospecto'
                        : 'Crear Prospecto'}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  title: { fontSize: 14, fontWeight: '800' },
  outboundPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  scrollBody: { flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 24 },
  fieldGroup: { gap: 5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 12,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    minHeight: 64,
    fontSize: 12,
    textAlignVertical: 'top',
  },
  checkCard: { padding: 12, borderRadius: 12, borderWidth: 1 },
  transferOk: { padding: 10, borderRadius: 10, borderWidth: 1 },
  transferBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignSelf: 'flex-start',
  },
  readonlyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  protocolBox: { padding: 11, borderRadius: 12, borderWidth: 1 },
  fixedFooter: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    gap: 8,
  },
  hintRow: {
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  hintText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  footerBtnsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  createLeadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    shadowColor: '#B7871C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  createLeadBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
