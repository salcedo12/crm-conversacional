import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, Clock, AlertTriangle, CheckCircle2, UserCheck,
  RefreshCw, Save, Loader2, Lock, Unlock
} from 'lucide-react';
import {
  fetchSlaConfig,
  updateSlaConfig,
  fetchBlockedAdvisors,
  unblockAdvisor,
  type SlaConfig,
  type BlockedAdvisor
} from '../services/slaConfig.service';

interface SlaConfigPanelProps {
  companyId: string;
}

export function SlaConfigPanel({ companyId }: SlaConfigPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const [config, setConfig] = useState<SlaConfig>({
    slaEnabled: false,
    preCitaMinutes: 30,
    preCitaLookbackHours: 2,
    preCitaReassignEnabled: false,
    preCitaBlockAdvisor: false,
    postCitaMinutes: 60,
    postCitaBlockAdvisor: false,
    postCitaRequireEvidence: false,
    manualTakeoverHours: 24,
    manualTakeoverBlockAdvisor: false,
  });

  const [blockedAdvisors, setBlockedAdvisors] = useState<BlockedAdvisor[]>([]);
  const [loadingBlocked, setLoadingBlocked] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const [cfg, blocked] = await Promise.all([
        fetchSlaConfig(companyId),
        fetchBlockedAdvisors(companyId)
      ]);
      setConfig(cfg);
      setBlockedAdvisors(blocked);
    } catch (err) {
      console.error('[SlaConfigPanel] Error cargando configuración:', err);
      setErrorMsg('No se pudo cargar la configuración de SLA.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const updated = await updateSlaConfig(companyId, config);
      setConfig(updated);
      setSuccessMsg('Parámetros de SLA actualizados y aplicados en tiempo real.');
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err) {
      console.error('[SlaConfigPanel] Error guardando SLA:', err);
      setErrorMsg('Error al guardar la configuración de SLA.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (advisor: BlockedAdvisor) => {
    const confirm = window.confirm(
      `¿Deseas desbloquear a ${advisor.displayName || advisor.email} para que vuelva a recibir prospectos en la rueda de distribución?`
    );
    if (!confirm) return;

    setUnblockingId(advisor.id);
    try {
      await unblockAdvisor(companyId, advisor.id, 'Desbloqueo administrativo desde Configuración de SLA');
      // Recargar lista de bloqueados
      const updated = await fetchBlockedAdvisors(companyId);
      setBlockedAdvisors(updated);
    } catch (err) {
      console.error('[SlaConfigPanel] Error desbloqueando asesor:', err);
      alert('Error al desbloquear el asesor.');
    } finally {
      setUnblockingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <Loader2 className="w-7 h-7 animate-spin text-violet-500 mb-2" />
        <p className="text-xs">Cargando protocolo y reglas de SLA...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-8 pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-violet-400" />
          <h2 className="text-base font-semibold text-zinc-100">
            Protocolo Disciplinario Comercial (Reglas de SLA)
          </h2>
        </div>
        <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
          Configura los tiempos de gracia, reasignación automática y pausas de leads para garantizar que ninguna cita quede desatendida y que todas las Fichas Técnicas se registren oportunamente.
        </p>
      </div>

      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-xs text-emerald-300 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-xs text-red-300 animate-in fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Master Switch */}
        <div className="flex items-center justify-between p-4 rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div>
            <p className="text-sm font-medium text-zinc-100">Auditoría Automática de SLAs Activa</p>
            <p className="text-xs text-zinc-500">
              Habilita la supervisión continua del sistema (ejecutada cada 5 minutos por el servidor).
            </p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={config.slaEnabled}
              onChange={(e) => setConfig({ ...config, slaEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-600"></div>
          </label>
        </div>

        {/* Dos Columnas: Pre-Cita vs Post-Cita */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Regla 1: Pre-Cita */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 space-y-4">
            <div className="flex items-center gap-2 text-sky-400">
              <Clock className="w-4 h-4" />
              <h3 className="text-sm font-semibold text-zinc-100">1. SLA Pre-Cita (Contacto Previo)</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Verifica que el asesor confirme la llamada o videollamada con el cliente antes de la hora pactada.
            </p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Tiempo de auditoría antes de la cita (minutos):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={180}
                    value={config.preCitaMinutes}
                    onChange={(e) => setConfig({ ...config, preCitaMinutes: parseInt(e.target.value) || 30 })}
                    className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 font-mono"
                  />
                  <span className="text-xs text-zinc-500">minutos antes (ej. 30 min)</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Ventana de verificación previa (horas):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    value={config.preCitaLookbackHours}
                    onChange={(e) => setConfig({ ...config, preCitaLookbackHours: parseInt(e.target.value) || 2 })}
                    className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 font-mono"
                  />
                  <span className="text-xs text-zinc-500">horas previas para validar mensaje del asesor</span>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-800/60 space-y-2">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.preCitaReassignEnabled}
                    onChange={(e) => setConfig({ ...config, preCitaReassignEnabled: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-800 text-violet-600 focus:ring-0"
                  />
                  <span>Reasignar cita a otro asesor activo por Round-Robin si no hay contacto</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.preCitaBlockAdvisor}
                    onChange={(e) => setConfig({ ...config, preCitaBlockAdvisor: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-800 text-violet-600 focus:ring-0"
                  />
                  <span>Pausar recepción de leads al asesor moroso</span>
                </label>
              </div>
            </div>
          </div>

          {/* Regla 2: Post-Cita */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 space-y-4">
            <div className="flex items-center gap-2 text-amber-400">
              <ShieldAlert className="w-4 h-4" />
              <h3 className="text-sm font-semibold text-zinc-100">2. SLA Post-Cita (Reporte Obligatorio)</h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Exige que el asesor consigne en la Ficha Técnica el resultado de la reunión, evidencias y la fecha de próximo contacto.
            </p>

            <div className="space-y-3 pt-2">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Plazo máximo para reportar Ficha (minutos):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={config.postCitaMinutes}
                    onChange={(e) => setConfig({ ...config, postCitaMinutes: parseInt(e.target.value) || 60 })}
                    className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 font-mono"
                  />
                  <span className="text-xs text-zinc-500">minutos tras finalizar la cita (ej. 60 min)</span>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-800/60 space-y-2">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.postCitaBlockAdvisor}
                    onChange={(e) => setConfig({ ...config, postCitaBlockAdvisor: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-800 text-violet-600 focus:ring-0"
                  />
                  <span>Pausar recepción de nuevos leads al asesor al minuto 61 de mora</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.postCitaRequireEvidence}
                    onChange={(e) => setConfig({ ...config, postCitaRequireEvidence: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-800 text-violet-600 focus:ring-0"
                  />
                  <span>Exigir captura de llamada/Meet si el cliente no asistió (No-Show)</span>
                </label>
              </div>
            </div>
          </div>

          {/* Regla 3: Toma de Control Manual (Al apagar la IA - 24h) */}
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-900/40 space-y-4 md:col-span-2">
            <div className="flex items-center gap-2 text-emerald-400">
              <Clock className="w-4 h-4" />
              <h3 className="text-sm font-semibold text-zinc-100">
                3. SLA Toma de Control Manual (Al apagar la IA — 24 Horas)
              </h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Cuando un asesor apaga la IA de un prospecto para atenderlo personalmente, tiene un plazo máximo (por defecto <strong>24 horas</strong>) para agendar una cita o registrar en la <strong>Ficha Técnica</strong> la conclusión del contacto. Si vence el plazo, el sistema lo alerta y le pausa la entrada de leads nuevos hasta que diligencie la Ficha Técnica.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Plazo máximo tras apagar la IA (horas):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={config.manualTakeoverHours ?? 24}
                    onChange={(e) => setConfig({ ...config, manualTakeoverHours: parseInt(e.target.value) || 24 })}
                    className="w-24 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-100 outline-none focus:border-violet-500 font-mono"
                  />
                  <span className="text-xs text-zinc-500">horas para agendar o llenar Ficha Técnica (ej. 24h)</span>
                </div>
              </div>

              <div className="flex items-center pt-4">
                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(config.manualTakeoverBlockAdvisor)}
                    onChange={(e) => setConfig({ ...config, manualTakeoverBlockAdvisor: e.target.checked })}
                    className="rounded border-zinc-700 bg-zinc-800 text-violet-600 focus:ring-0"
                  />
                  <span>Pausar recepción de leads nuevos y alertar en mora si supera las {config.manualTakeoverHours ?? 24}h sin Ficha Técnica</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Botón Guardar */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs transition-colors shadow-lg shadow-violet-600/20 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Guardar Configuración de SLA</span>
          </button>
        </div>
      </form>

      {/* Sección: Asesores Bloqueados / Pausados en Vivo */}
      <div className="pt-6 border-t border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-zinc-100">
              Asesores con Recepción Pausada por SLA ({blockedAdvisors.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={async () => {
              setLoadingBlocked(true);
              const b = await fetchBlockedAdvisors(companyId).catch(() => []);
              setBlockedAdvisors(b);
              setLoadingBlocked(false);
            }}
            disabled={loadingBlocked}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingBlocked ? 'animate-spin' : ''}`} />
            <span>Refrescar</span>
          </button>
        </div>

        {blockedAdvisors.length === 0 ? (
          <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-emerald-300 text-xs flex items-center gap-3">
            <UserCheck className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <p className="font-medium">Todos los asesores están al día</p>
              <p className="text-zinc-500 mt-0.5">Ningún asesor tiene la asignación pausada por incumplimiento de citas.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 font-medium">
                  <th className="px-4 py-3">Asesor</th>
                  <th className="px-4 py-3">Motivo de Bloqueo</th>
                  <th className="px-4 py-3">Fecha de Bloqueo</th>
                  <th className="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {blockedAdvisors.map((adv) => (
                  <tr key={adv.id} className="hover:bg-zinc-800/30">
                    <td className="px-4 py-3 font-medium text-zinc-200">
                      <div className="flex items-center gap-2">
                        <span>{adv.displayName || adv.email}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                          adv.receiveLeads !== false
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                            : 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                        }`}>
                          {adv.receiveLeads !== false ? '🟢 Recibe Pauta' : '🔵 Solo Seguimiento'}
                        </span>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">{adv.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-300 border border-amber-500/20">
                        {adv.blockedReason || 'SLA_POST_CITA_1H'}
                      </span>
                      {adv.unresolvedLeadName && (
                        <div className="text-[10px] text-zinc-400 mt-1">
                          Prospecto pendiente: <strong className="text-zinc-200">{adv.unresolvedLeadName}</strong>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">
                      {adv.blockedAt ? new Date(adv.blockedAt).toLocaleString('es-CO') : 'Reciente'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleUnblock(adv)}
                        disabled={unblockingId === adv.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {unblockingId === adv.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5" />
                        )}
                        <span>Desbloquear</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
