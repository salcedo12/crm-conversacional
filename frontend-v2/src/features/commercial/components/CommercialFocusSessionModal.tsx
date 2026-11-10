import { useState } from 'react';
import {
  Phone, MessageCircle, PhoneMissed, CheckCircle2, X,
  ArrowRight, Building2, Sparkles, History
} from 'lucide-react';
import { formatFriendlyDate } from '@/shared/utils/date';
import { registerQuickNoContesto } from '../services/commercial.service';
import { reportAppointmentFicha } from '@/features/calendar/services/calendar.service';
import type { CommercialLeadItem } from '../types/commercial.types';

interface CommercialFocusSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  leads: CommercialLeadItem[];
  companyId: string;
  authorName: string;
  onLeadUpdated: () => void;
}

const ACTION_RESULTS = [
  { id: 'interesado_avanza', label: 'Interesado · Avanza en el embudo', color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  { id: 'agendo_visita', label: 'Agendó Visita / Sala de Ventas', color: 'border-amber-500/40 bg-amber-500/10 text-amber-300' },
  { id: 'solicito_cotizacion', label: 'Solicitó Cotización / Plan de Pagos', color: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  { id: 'volver_a_llamar', label: 'Pide que lo llame más tarde', color: 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' },
  { id: 'no_interesado', label: 'No Interesado / Descarte', color: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
];

export function CommercialFocusSessionModal({
  isOpen,
  onClose,
  leads,
  companyId,
  authorName,
  onLeadUpdated,
}: CommercialFocusSessionModalProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sessionCompleted, setSessionCompleted] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  // Formulario rápido de resultado para el prospecto actual
  const [selectedResult, setSelectedResult] = useState<string>('interesado_avanza');
  const [notes, setNotes] = useState('');
  const [nextActionType, setNextActionType] = useState('Próxima Llamada de Seguimiento');
  const [nextDate, setNextDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [nextTime, setNextTime] = useState('10:00');

  if (!isOpen) return null;

  const currentLead = leads[currentIndex];

  const resetForm = () => {
    setSelectedResult('interesado_avanza');
    setNotes('');
    setNextActionType('Próxima Llamada de Seguimiento');
    const d = new Date();
    d.setDate(d.getDate() + 2);
    setNextDate(d.toISOString().slice(0, 10));
    setNextTime('10:00');
  };

  const advanceToNext = () => {
    if (currentIndex + 1 < leads.length) {
      setCurrentIndex((prev) => prev + 1);
      resetForm();
    } else {
      setSessionCompleted(true);
    }
  };

  const handleQuickNoContesto = async () => {
    if (!currentLead) return;
    setSaving(true);
    try {
      await registerQuickNoContesto(companyId, currentLead, authorName);
      setCompletedCount((prev) => prev + 1);
      onLeadUpdated();
      advanceToNext();
    } catch (err) {
      console.error('[FocusSession] Error al registrar no contestó:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndNext = async () => {
    if (!currentLead) return;
    setSaving(true);
    try {
      const resultObj = ACTION_RESULTS.find((r) => r.id === selectedResult);
      const isDesistimiento = selectedResult === 'no_interesado';

      await reportAppointmentFicha(companyId, {
        leadId: currentLead.id,
        actionType: 'llamada',
        result: resultObj?.label || 'Gestión realizada',
        attended: true,
        notes: notes.trim() || undefined,
        nextAction: isDesistimiento ? 'Desistimiento / Sin Próximo Contacto' : nextActionType,
        nextActionDate: isDesistimiento ? undefined : `${nextDate} ${nextTime}`,
      });

      setCompletedCount((prev) => prev + 1);
      onLeadUpdated();
      advanceToNext();
    } catch (err) {
      console.error('[FocusSession] Error guardando gestión:', err);
    } finally {
      setSaving(false);
    }
  };

  const progressPercent = leads.length > 0 ? Math.round(((currentIndex) / leads.length) * 100) : 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-6 overflow-y-auto">
      <div className="w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Barra superior de progreso y control */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30">
              <Sparkles size={16} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <span>Modo Enfoque Comercial · Maratón de Seguimientos</span>
              </h3>
              <p className="text-[11px] text-zinc-400">
                {!sessionCompleted ? `Prospecto ${currentIndex + 1} de ${leads.length}` : 'Sesión Finalizada'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!sessionCompleted && (
              <div className="hidden sm:flex items-center gap-2 w-36">
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono text-zinc-400 shrink-0">{progressPercent}%</span>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Pantalla de Felicitación al terminar */}
        {sessionCompleted || !currentLead ? (
          <div className="p-10 text-center flex flex-col items-center justify-center gap-4 my-auto">
            <div className="p-4 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 text-3xl">
              <CheckCircle2 size={48} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">¡Excelente jornada de seguimientos!</h2>
              <p className="text-xs text-zinc-400 mt-1 max-w-md">
                Has gestionado <strong className="text-emerald-300 font-semibold">{completedCount} prospectos</strong> en esta sesión de enfoque. Tus acuerdos y recordatorios ya están sincronizados en el embudo y el calendario.
              </p>
            </div>
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg transition-all"
            >
              Volver a Gestión Comercial
            </button>
          </div>
        ) : (
          /* Cuerpo de la Sesión: 2 Columnas */
          <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-zinc-800">
            {/* Columna Izquierda: Información del Prospecto e Historial */}
            <div className="lg:col-span-5 p-5 space-y-4 bg-zinc-900/30">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {currentLead.pipelineStageLabel || 'Prospecto'}
                  </span>
                  {currentLead.project && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                      <Building2 size={10} className="text-zinc-400" />
                      <span>{currentLead.project}</span>
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-bold text-zinc-100 truncate">{currentLead.name}</h2>
                <div className="flex items-center gap-2 text-xs text-zinc-400 mt-1 flex-wrap min-w-0">
                  <span className="shrink-0">📞 {currentLead.phone}</span>
                  {currentLead.fuenteUbicacion && (
                    <>
                      <span className="text-zinc-600 shrink-0">•</span>
                      <span className="text-zinc-500 truncate max-w-[200px]" title={currentLead.fuenteUbicacion}>
                        {currentLead.fuenteUbicacion}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Botones de llamada y WhatsApp de Gran Tamaño */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {currentLead.phone ? (
                  <a
                    href={`tel:${currentLead.phone.replace(/\D/g, '')}`}
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all text-center"
                  >
                    <Phone size={14} />
                    <span>Llamar Ahora</span>
                  </a>
                ) : (
                  <button disabled className="opacity-40 py-2.5 px-3 rounded-xl bg-zinc-800 text-zinc-500 text-xs text-center">
                    Sin teléfono
                  </button>
                )}

                {currentLead.phone ? (
                  <a
                    href={`https://wa.me/${currentLead.phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/30 text-xs font-semibold transition-all text-center"
                  >
                    <MessageCircle size={14} />
                    <span>WhatsApp</span>
                  </a>
                ) : null}
              </div>

              {/* Botón Rápido: No contestó */}
              <button
                type="button"
                onClick={handleQuickNoContesto}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all cursor-pointer"
              >
                <PhoneMissed size={14} />
                <span>No Contestó (Reprogramar en 3h)</span>
              </button>

              {/* Historial Breve de Bitácoras */}
              <div className="pt-2 border-t border-zinc-800 space-y-2">
                <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <History size={12} className="text-sky-400" />
                  <span>Historial Previo ({currentLead.bitacoras?.length || 0})</span>
                </span>

                {(!currentLead.bitacoras || currentLead.bitacoras.length === 0) ? (
                  <p className="text-xs text-zinc-500 italic">Sin gestiones previas registradas.</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {currentLead.bitacoras.slice(0, 4).map((b: any, idx: number) => (
                      <div key={idx} className="text-xs border-l-2 border-emerald-500/40 pl-2.5 py-0.5 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
                          <span className="font-semibold text-zinc-200">{formatFriendlyDate(b.fecha || b.lastDate)}</span>
                          <span>•</span>
                          <span className="text-emerald-400">{b.action}</span>
                        </div>
                        {b.description && (
                          <p className="text-zinc-300 text-[11px] bg-zinc-900/60 p-1.5 rounded border border-zinc-800/80">
                            {b.description}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Columna Derecha: Formulario de Registro Rápido */}
            <div className="lg:col-span-7 p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                    1. ¿Qué sucedió en la llamada / gestión?
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {ACTION_RESULTS.map((res) => (
                      <button
                        key={res.id}
                        type="button"
                        onClick={() => setSelectedResult(res.id)}
                        className={`p-2 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer ${
                          selectedResult === res.id
                            ? `${res.color} ring-2 ring-emerald-500/40 font-bold`
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        {res.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-300 mb-1">
                    2. Observaciones / Acuerdos conversados
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Escribe brevemente qué le interesó, presupuesto o dudas..."
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none resize-none"
                  />
                </div>

                {selectedResult !== 'no_interesado' && (
                  <div>
                    <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                      3. Programar Próximo Seguimiento
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <span className="block text-[10px] text-zinc-500 mb-1">Fecha</span>
                        <input
                          type="date"
                          value={nextDate}
                          onChange={(e) => setNextDate(e.target.value)}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div>
                        <span className="block text-[10px] text-zinc-500 mb-1">Hora</span>
                        <input
                          type="time"
                          value={nextTime}
                          onChange={(e) => setNextTime(e.target.value)}
                          className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Botones de Avance */}
              <div className="pt-4 border-t border-zinc-800 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={advanceToNext}
                  className="px-4 py-2 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Omitir / Siguiente sin guardar
                </button>

                <button
                  type="button"
                  onClick={handleSaveAndNext}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg transition-all cursor-pointer"
                >
                  {saving ? (
                    <span>Guardando...</span>
                  ) : (
                    <>
                      <span>Guardar Gestión y Siguiente</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
