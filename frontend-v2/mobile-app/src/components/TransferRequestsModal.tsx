import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import {
  listLeadTransferRequests,
  resolveLeadTransferRequest,
  type LeadTransferRequestItem,
} from '../services/contacts';
import { Icon } from './Icon';
import { FichaTecnicaModal } from './FichaTecnicaModal';

interface TransferRequestsModalProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  onResolved?: () => void;
}

function formatBogotaDateTime(millis: number | null): string {
  if (!millis) return 'Sin registro';
  try {
    return new Date(millis).toLocaleString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(millis).toLocaleString();
  }
}

export function TransferRequestsModal({
  isOpen,
  onClose,
  companyId,
  onResolved,
}: TransferRequestsModalProps) {
  const insets = useSafeAreaInsets();
  const { palette } = useTheme();
  const [requests, setRequests] = useState<LeadTransferRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedFichaReq, setSelectedFichaReq] = useState<{
    leadId: string;
    leadName: string;
    leadPhone: string;
    leadProject: string;
    currentAdvisorName: string;
    initialTab: 'form' | 'history';
  } | null>(null);

  const loadRequests = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const items = await listLeadTransferRequests(companyId, 'all');
      setRequests(items);
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar las solicitudes de traslado.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (isOpen && companyId) void loadRequests();
  }, [isOpen, companyId, loadRequests]);

  if (!isOpen) return null;

  const pendingList = requests.filter((r) => r.status === 'pending');
  const historyList = requests.filter((r) => r.status !== 'pending');
  const displayed = tab === 'pending' ? pendingList : historyList;

  const handleDecision = async (req: LeadTransferRequestItem, decision: 'approve' | 'reject') => {
    if (resolvingId) return;
    setResolvingId(req.id);
    setError(null);
    try {
      await resolveLeadTransferRequest({
        companyId,
        requestId: req.id,
        decision,
        adminNote: adminNotes[req.id]?.trim() || undefined,
      });
      await loadRequests();
      onResolved?.();
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la decisión.');
    } finally {
      setResolvingId(null);
    }
  };

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: palette.bgCanvas }]}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              backgroundColor: palette.bgCard,
              borderBottomColor: palette.border,
              paddingTop: Math.max(insets.top + 8, 14),
            },
          ]}
        >
          <View style={[styles.iconBox, { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder }]}>
            <Icon name="RefreshCw" size={17} color={palette.brandText} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.rowCenter}>
              <Text style={[styles.title, { color: palette.textPrimary }]}>Solicitudes de Traslado</Text>
              {pendingList.length > 0 && (
                <View style={[styles.countBadge, { backgroundColor: palette.brand }]}>
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#ffffff' }}>
                    {pendingList.length} pendiente{pendingList.length === 1 ? '' : 's'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 2 }}>
              Audita el último seguimiento real antes de aprobar o rechazar.
            </Text>
          </View>
          <Pressable
            onPress={loadRequests}
            style={[styles.iconBtn, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
          >
            <Icon name="RefreshCw" size={15} color={palette.textSecondary} />
          </Pressable>
          <Pressable
            onPress={onClose}
            style={[styles.iconBtn, { backgroundColor: palette.bgElevated, borderColor: palette.border }]}
          >
            <Icon name="X" size={16} color={palette.textSecondary} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={[styles.tabsBar, { backgroundColor: palette.bgCardSoft, borderBottomColor: palette.border }]}>
          <Pressable
            onPress={() => setTab('pending')}
            style={[
              styles.tabPill,
              tab === 'pending' && { backgroundColor: palette.brandSoft, borderColor: palette.brandBorder },
            ]}
          >
            <Icon name="Clock" size={13} color={tab === 'pending' ? palette.brandText : palette.textMuted} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: tab === 'pending' ? palette.brandText : palette.textMuted }}>
              Pendientes ({pendingList.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('history')}
            style={[
              styles.tabPill,
              tab === 'history' && { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong },
            ]}
          >
            <Icon name="FileText" size={13} color={tab === 'history' ? palette.textPrimary : palette.textMuted} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: tab === 'history' ? palette.textPrimary : palette.textMuted }}>
              Historial ({historyList.length})
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 24 }]}>
          {error ? (
            <View style={[styles.errorCard, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}>
              <Text style={{ fontSize: 12, color: palette.roseText }}>⚠️ {error}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="small" color={palette.brand} />
              <Text style={{ fontSize: 12, color: palette.textMuted, marginTop: 8 }}>
                Consultando solicitudes y auditando último seguimiento...
              </Text>
            </View>
          ) : displayed.length === 0 ? (
            <View style={[styles.emptyCard, { borderColor: palette.borderStrong }]}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: palette.textSecondary }}>
                {tab === 'pending'
                  ? 'No hay solicitudes de traslado pendientes'
                  : 'Aún no hay historial de traslados resueltos'}
              </Text>
              <Text style={{ fontSize: 12, color: palette.textSubtle, textAlign: 'center', marginTop: 6 }}>
                {tab === 'pending'
                  ? 'Cuando un asesor solicite el traslado de un número asignado a otro compañero, aparecerá aquí.'
                  : 'Aquí verás las solicitudes aprobadas o rechazadas anteriormente.'}
              </Text>
            </View>
          ) : (
            displayed.map((req) => {
              const isBusy = resolvingId === req.id;
              const hasFollowUp = req.lastFollowUpMillis !== null;
              const days = req.daysSinceFollowUp;

              return (
                <View key={req.id} style={[styles.reqCard, { backgroundColor: palette.bgCard, borderColor: palette.border }]}>
                  <View style={[styles.reqTop, { borderBottomColor: palette.border }]}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.rowCenter}>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: palette.textPrimary }}>
                          {req.leadName || 'Prospecto'}
                        </Text>
                        <View style={[styles.phoneTag, { backgroundColor: palette.bgElevated }]}>
                          <Text style={{ fontSize: 11, color: palette.textSecondary, fontWeight: '600' }}>{req.leadPhone}</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: palette.textSubtle, marginTop: 3 }}>
                        Solicitado el {formatBogotaDateTime(req.createdAtMillis)}
                        {req.leadProject ? ` · 🏢 ${req.leadProject}` : ''}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        req.status === 'pending'
                          ? { backgroundColor: palette.amberBg, borderColor: palette.amberBorder }
                          : req.status === 'approved'
                          ? { backgroundColor: palette.emeraldBg, borderColor: palette.emeraldBorder }
                          : { backgroundColor: palette.roseBg, borderColor: palette.roseBorder },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color:
                            req.status === 'pending'
                              ? palette.amberText
                              : req.status === 'approved'
                              ? palette.emeraldText
                              : palette.roseText,
                        }}
                      >
                        {req.status === 'pending' ? '⏳ Pendiente' : req.status === 'approved' ? '✅ Aprobado' : '❌ Rechazado'}
                      </Text>
                    </View>
                  </View>

                  {/* Asesor Actual */}
                  <View style={[styles.subCard, { backgroundColor: palette.bgElevated, borderColor: palette.borderStrong }]}>
                    <View style={styles.rowBetween}>
                      <Text style={{ fontSize: 10, fontWeight: '800', color: palette.textSubtle }}>
                        ASESOR ACTUAL ASIGNADO
                      </Text>
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '700',
                          color: hasFollowUp ? palette.emeraldText : palette.roseText,
                        }}
                      >
                        {hasFollowUp
                          ? days === 0
                            ? 'Seguimiento Hoy'
                            : `Hace ${days} día${days === 1 ? '' : 's'}`
                          : '⚠️ Sin gestión'}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: palette.textPrimary, marginTop: 2 }}>
                      {req.currentAdvisorName}
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 4 }}>
                      Último seguimiento:{' '}
                      <Text style={{ fontWeight: '700', color: hasFollowUp ? palette.emeraldText : palette.amberText }}>
                        {hasFollowUp ? formatBogotaDateTime(req.lastFollowUpMillis) : 'Nunca ha registrado seguimiento'}
                      </Text>
                    </Text>
                    {req.lastFollowUpSummary ? (
                      <Text style={{ fontSize: 11, color: palette.textSecondary, fontStyle: 'italic', marginTop: 4 }}>
                        "{req.lastFollowUpSummary}"
                      </Text>
                    ) : null}

                    {/* Botones de Bitácora y Ficha Técnica */}
                    <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: palette.border }}>
                      <Pressable
                        onPress={() =>
                          setSelectedFichaReq({
                            leadId: req.leadId,
                            leadName: req.leadName,
                            leadPhone: req.leadPhone,
                            leadProject: req.leadProject || '',
                            currentAdvisorName: req.currentAdvisorName,
                            initialTab: 'history',
                          })
                        }
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          paddingVertical: 4,
                          paddingHorizontal: 8,
                          borderRadius: 8,
                          backgroundColor: palette.amberBg,
                          borderWidth: 1,
                          borderColor: palette.amberBorder,
                        }}
                      >
                        <Icon name="History" size={12} color={palette.amberText} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.amberText }}>
                          Ver Bitácora
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() =>
                          setSelectedFichaReq({
                            leadId: req.leadId,
                            leadName: req.leadName,
                            leadPhone: req.leadPhone,
                            leadProject: req.leadProject || '',
                            currentAdvisorName: req.currentAdvisorName,
                            initialTab: 'form',
                          })
                        }
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                          paddingVertical: 4,
                          paddingHorizontal: 8,
                          borderRadius: 8,
                          backgroundColor: palette.emeraldBg,
                          borderWidth: 1,
                          borderColor: palette.emeraldBorder,
                        }}
                      >
                        <Icon name="FileText" size={12} color={palette.emeraldText} />
                        <Text style={{ fontSize: 11, fontWeight: '700', color: palette.emeraldText }}>
                          Ficha Técnica
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  {/* Solicitante */}
                  <View style={[styles.subCard, { backgroundColor: palette.skyBg, borderColor: palette.skyBorder }]}>
                    <Text style={{ fontSize: 10, fontWeight: '800', color: palette.skyText }}>
                      ASESOR SOLICITANTE
                    </Text>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: palette.textPrimary, marginTop: 2 }}>
                      {req.requesterName}
                    </Text>
                    <Text style={{ fontSize: 11, color: palette.textSecondary, marginTop: 4 }}>
                      Motivo: {req.reason || 'Solicita traslado del prospecto'}
                    </Text>
                  </View>

                  {req.status === 'pending' ? (
                    <View style={{ gap: 8, marginTop: 4 }}>
                      <TextInput
                        value={adminNotes[req.id] || ''}
                        onChangeText={(t) => setAdminNotes((prev) => ({ ...prev, [req.id]: t }))}
                        placeholder="Nota opcional del Administrador (quedará en bitácora)..."
                        placeholderTextColor={palette.placeholder}
                        style={[
                          styles.noteInput,
                          { backgroundColor: palette.bgInput, borderColor: palette.borderInput, color: palette.textPrimary },
                        ]}
                      />
                      <View style={styles.rowCenter}>
                        <Pressable
                          disabled={isBusy}
                          onPress={() => handleDecision(req, 'reject')}
                          style={[styles.rejectBtn, { backgroundColor: palette.roseBg, borderColor: palette.roseBorder }]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: palette.roseText }}>✕ Rechazar</Text>
                        </Pressable>
                        <Pressable
                          disabled={isBusy}
                          onPress={() => handleDecision(req, 'approve')}
                          style={[styles.approveBtn, { backgroundColor: palette.emerald }]}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '800', color: '#ffffff' }}>
                            {isBusy ? 'Procesando...' : '✓ Aprobar Traslado'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : req.adminNote ? (
                    <Text style={{ fontSize: 11, color: palette.textMuted, marginTop: 4 }}>
                      <Text style={{ fontWeight: '700' }}>Nota Admin ({req.resolvedByName}):</Text> {req.adminNote}
                    </Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </View>

      {/* Modal Ficha Técnica y Bitácora */}
      {selectedFichaReq && companyId && (
        <FichaTecnicaModal
          isOpen={!!selectedFichaReq}
          onClose={() => setSelectedFichaReq(null)}
          companyId={companyId}
          lead={{
            id: selectedFichaReq.leadId,
            name: selectedFichaReq.leadName,
            phone: selectedFichaReq.leadPhone,
            project: selectedFichaReq.leadProject,
            advisorName: selectedFichaReq.currentAdvisorName,
          }}
          initialTab={selectedFichaReq.initialTab}
          onSuccess={() => {
            void loadRequests();
            onResolved?.();
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 15, fontWeight: '800' },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabsBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  body: { padding: 16, gap: 12 },
  errorCard: { padding: 12, borderRadius: 12, borderWidth: 1 },
  centerBox: { paddingVertical: 48, alignItems: 'center' },
  emptyCard: {
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
  },
  reqCard: { padding: 14, borderRadius: 16, borderWidth: 1, gap: 10 },
  reqTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  phoneTag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  subCard: { padding: 11, borderRadius: 12, borderWidth: 1 },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    fontSize: 12,
  },
  rejectBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
  },
  approveBtn: {
    flex: 1.4,
    paddingVertical: 10,
    borderRadius: 11,
    alignItems: 'center',
  },
});
