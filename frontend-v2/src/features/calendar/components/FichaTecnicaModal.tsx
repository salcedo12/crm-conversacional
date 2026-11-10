import { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { Trash2, Calendar, Clock, CheckCircle2, ExternalLink, Download } from 'lucide-react';
import { reportAppointmentFicha } from '../services/calendar.service';
import { useLeadNotes, deleteLeadNote } from '@/features/leads/services/leadNotes.service';
import { formatFullDateTime } from '@/shared/utils/date';
import { Spinner } from '@/shared/components/Spinner';
import { PIPELINE_STAGES } from '@/features/pipeline/types/pipeline.types';
import { downloadIcsFile } from '../utils/icsGenerator';
import {
  subscribeFichaTecnicaConfig,
  DEFAULT_FICHA_CONFIG,
  type FichaTecnicaConfig,
} from '@/features/config/services/fichaTecnicaConfig.service';
import { MERAKI_PROJECTS } from '@/features/leads/components/NewLeadModal';
import { updateLead } from '@/features/leads/services/leads.service';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';

export type FollowUpActionType = 'envio_informacion' | 'llamada' | 'cita_reunion' | 'visita_terreno' | 'seguimiento_general' | 'no_interesado' | string;

interface FichaTecnicaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onProjectChange?: (newProject: string) => void;
  companyId: string;
  lead?: {
    id?: string;
    name?: string | null;
    phone?: string | null;
    project?: string | null;
    projectInterest?: string[];
    advisorName?: string | null;
    bitacoras?: any[];
    metadata?: Record<string, any>;
  };
  appointment?: {
    id?: string;
    leadId?: string;
    leadName?: string | null;
    leadPhone?: string | null;
    title?: string;
    advisorName?: string;
    project?: string;
  };
  initialTab?: 'form' | 'history';
}

const FORM_ACTION_OPTIONS: { id: FollowUpActionType; label: string; icon: string; desc: string }[] = [
  { id: 'envio_informacion', label: 'Envío de Información', icon: '📩', desc: 'Brochure, cotización o planos por WhatsApp/Email' },
  { id: 'llamada', label: 'Llamada Telefónica', icon: '📞', desc: 'Contacto telefónico directo con el cliente' },
  { id: 'cita_reunion', label: 'Cita / Videollamada', icon: '🎥', desc: 'Reunión virtual por Google Meet o WhatsApp' },
  { id: 'visita_terreno', label: 'Visita Terreno / Sala', icon: '🏡', desc: 'Visita presencial a sala de ventas o proyecto' },
  { id: 'seguimiento_general', label: 'Seguimiento General', icon: '💬', desc: 'Chat de WhatsApp o recontacto comercial' },
];

const ALL_ACTION_DISPLAY: { id: string; label: string; icon: string; desc: string }[] = [
  ...FORM_ACTION_OPTIONS,
  { id: 'cambio_asesor', label: 'Cambio de Asesor (Admin)', icon: '👤', desc: 'Reasignación administrativa de asesor' },
  { id: 'cambio_fuente', label: 'Cambio de Fuente (Admin)', icon: '🧭', desc: 'Actualización administrativa de fuente/medio' },
];

const QUICK_RESULTS: Record<FollowUpActionType, string[]> = {
  envio_informacion: [
    'Se envió Brochure y Ficha',
    'Se enviaron Planos y Disponibilidad',
    'Se envió Cotización Formal',
    'Se envió Video del Proyecto',
  ],
  llamada: [
    'Contestó y conversamos',
    'No contestó',
    'Ocupado / Llamar luego',
    'Buzón de mensajes / Equivocado',
  ],
  cita_reunion: [
    'Asistió a la videollamada',
    'No asistió (No-Show)',
    'Reprogramó reunión',
  ],
  visita_terreno: [
    'Asistió a sala de ventas / terreno',
    'No asistió (No-Show)',
    'Reprogramó visita',
  ],
  seguimiento_general: [
    'Cliente muy interesado (Caliente)',
    'Esperando prima o desembolso',
    'Revisando con familia / cónyuge',
    'Comparando con otros proyectos',
  ],
};


const ACTION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  envio_informacion: { bg: 'bg-sky-500/15', text: 'text-sky-300', border: 'border-sky-500/30' },
  llamada: { bg: 'bg-amber-500/15', text: 'text-amber-300', border: 'border-amber-500/30' },
  cita_reunion: { bg: 'bg-indigo-500/15', text: 'text-indigo-300', border: 'border-indigo-500/30' },
  visita_terreno: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  seguimiento_general: { bg: 'bg-violet-500/15', text: 'text-violet-300', border: 'border-violet-500/30' },
  cambio_asesor: { bg: 'bg-emerald-500/15', text: 'text-emerald-300', border: 'border-emerald-500/30' },
  cambio_fuente: { bg: 'bg-teal-500/15', text: 'text-teal-300', border: 'border-teal-500/30' },
};

function getPresetDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getNextMondayDate(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${dayStr}`;
}

const DATE_PRESETS = [
  { id: 'today', label: 'Hoy', getVal: () => getPresetDate(0) },
  { id: 'tomorrow', label: 'Mañana', getVal: () => getPresetDate(1) },
  { id: 'in_2_days', label: '+2 Días', getVal: () => getPresetDate(2) },
  { id: 'in_3_days', label: '+3 Días', getVal: () => getPresetDate(3) },
  { id: 'next_mon', label: 'Próx. Lunes', getVal: () => getNextMondayDate() },
];

const TIME_PRESETS = [
  { label: '09:00 AM', value: '09:00' },
  { label: '10:30 AM', value: '10:30' },
  { label: '02:00 PM', value: '14:00' },
  { label: '03:30 PM', value: '15:30' },
  { label: '05:00 PM', value: '17:00' },
];

function formatFriendlySchedule(dateStr: string, timeStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const dateObj = new Date(y, m - 1, d);
  const todayStr = getPresetDate(0);
  const tomorrowStr = getPresetDate(1);

  let prefix = '';
  if (dateStr === todayStr) prefix = 'Hoy, ';
  else if (dateStr === tomorrowStr) prefix = 'Mañana, ';
  else {
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    prefix = `${dayNames[dateObj.getDay()]}, `;
  }

  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const formattedDate = `${prefix}${d} de ${monthNames[m - 1]}`;

  let formattedTime = timeStr;
  if (timeStr && timeStr.includes(':')) {
    const [h, min] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    formattedTime = `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
  }

  return `${formattedDate} · ${formattedTime}`;
}

export function FichaTecnicaModal({
  isOpen,
  onClose,
  onSuccess,
  onProjectChange,
  companyId,
  lead,
  appointment,
  initialTab = 'form',
}: FichaTecnicaModalProps) {
  const targetLeadId = lead?.id || appointment?.leadId || '';
  const leadName = lead?.name || appointment?.leadName || 'Cliente Prospecto';
  const leadPhone = lead?.phone || appointment?.leadPhone || 'Sin teléfono';
  const leadProject = lead?.project || appointment?.project || 'Proyecto Meraki';
  const advisorName = lead?.advisorName || appointment?.advisorName || 'Asesor Asignado';
  const appointmentId = appointment?.id;
  const { role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);

  const initialProject =
    lead?.project ||
    lead?.projectInterest?.[0] ||
    (lead?.metadata as any)?.project ||
    (lead?.metadata as any)?.smarthomeProyectoOriginal ||
    appointment?.project ||
    '';
  const [selectedProject, setSelectedProject] = useState<string>(initialProject);
  const [updatingProject, setUpdatingProject] = useState<boolean>(false);
  const [projectSavedToast, setProjectSavedToast] = useState<boolean>(false);

  useEffect(() => {
    const p =
      lead?.project ||
      lead?.projectInterest?.[0] ||
      (lead?.metadata as any)?.project ||
      (lead?.metadata as any)?.smarthomeProyectoOriginal ||
      appointment?.project ||
      '';
    if (p) setSelectedProject(p);
  }, [
    lead?.project,
    lead?.projectInterest,
    (lead?.metadata as any)?.project,
    (lead?.metadata as any)?.smarthomeProyectoOriginal,
    appointment?.project,
  ]);

  // Si no se proporcionó proyecto en props y tenemos targetLeadId, consultarlo directamente en Firestore
  useEffect(() => {
    if (!companyId || !targetLeadId || selectedProject) return;
    let isCancelled = false;
    getDoc(doc(db, 'companies', companyId, 'leads', targetLeadId))
      .then((snap) => {
        if (!isCancelled && snap.exists()) {
          const d = snap.data();
          const p = (d?.projectInterest && d.projectInterest[0]) || d?.metadata?.project || d?.firstTouch?.project || '';
          if (p) setSelectedProject(p);
        }
      })
      .catch((err) => console.warn('[FichaTecnicaModal] Error consultando proyecto del lead:', err));
    return () => { isCancelled = true; };
  }, [companyId, targetLeadId, selectedProject]);

  const handleProjectChange = async (newProject: string) => {
    setSelectedProject(newProject);
    if (onProjectChange) {
      onProjectChange(newProject);
    }
    if (!companyId || !targetLeadId) return;

    setUpdatingProject(true);
    try {
      await updateLead({
        companyId,
        leadId: targetLeadId,
        projectInterest: newProject ? [newProject] : [],
        metadata: {
          ...(lead?.metadata || {}),
          project: newProject,
        },
      });
      setProjectSavedToast(true);
      setTimeout(() => setProjectSavedToast(false), 2500);
    } catch (err) {
      console.error('[FichaTecnicaModal] Error al actualizar proyecto de interés:', err);
    } finally {
      setUpdatingProject(false);
    }
  };

  const [activeTab, setActiveTab] = useState<'form' | 'history'>(initialTab);

  // Hook de notas del lead para ver historial
  const { notes: leadNotes, loading: loadingNotes } = useLeadNotes(companyId, targetLeadId);

  // Si viene de una cita de calendario, seleccionar 'cita_reunion' por defecto
  const [actionType, setActionType] = useState<FollowUpActionType>(
    appointmentId ? 'cita_reunion' : 'envio_informacion'
  );

  const [attended, setAttended] = useState<boolean>(true);
  const [result, setResult] = useState<string>(
    appointmentId ? 'Asistió a la videollamada' : QUICK_RESULTS['envio_informacion'][0]
  );
  const [nextAction, setNextAction] = useState<string>('Próxima Llamada de Seguimiento');
  const [pipelineStage, setPipelineStage] = useState<string>('');
  const [inviteReferralProgram, setInviteReferralProgram] = useState<boolean>(false);
  const [nextDate, setNextDate] = useState<string>('');
  const [nextTime, setNextTime] = useState<string>('10:00');
  const [notes, setNotes] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [fichaConfig, setFichaConfig] = useState<FichaTecnicaConfig>(DEFAULT_FICHA_CONFIG);

  useEffect(() => {
    if (!companyId) return;
    const unsubscribe = subscribeFichaTecnicaConfig(companyId, (cfg) => {
      setFichaConfig(cfg);
    });
    return () => unsubscribe();
  }, [companyId]);

  const formActions = fichaConfig.actions.filter((a) => a.active !== false);
  const nextStepOptions = fichaConfig.nextSteps.filter((s) => s.active !== false);

  const [syncSuccess, setSyncSuccess] = useState<{
    synced: boolean;
    directCalendarUrl?: string;
    title: string;
    dateStr: string;
    leadName: string;
    actionLabel: string;
  } | null>(null);

  if (!isOpen) return null;

  // Filtrar notas que son fichas o seguimiento oficiales del CRM
  const fichaNotes = leadNotes.filter(
    (n) => n.type === 'ficha_tecnica' || n.text?.includes('FICHA TÉCNICA') || n.kind === 'note'
  );
  const totalFollowUpsCount = fichaNotes.length;

  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const handleDeleteNote = async (noteId: string) => {
    if (!isAdmin || !companyId || !targetLeadId) return;
    if (!window.confirm('¿Deseas eliminar este registro de seguimiento del historial? (Acción exclusiva de Administrador)')) return;
    setDeletingNoteId(noteId);
    try {
      await deleteLeadNote(companyId, targetLeadId, noteId);
    } catch (err) {
      console.error('[FichaTecnicaModal] Error al eliminar nota:', err);
    } finally {
      setDeletingNoteId(null);
    }
  };

  const lastNote = fichaNotes[0];
  const lastFollowUpSummary = lastNote
    ? {
        title: lastNote.actionType
          ? ALL_ACTION_DISPLAY.find((a) => a.id === lastNote.actionType)?.label || lastNote.actionType
          : 'Seguimiento',
        result: lastNote.result || '',
        author: lastNote.authorName || 'Asesor',
        date: lastNote.createdAt ? formatFullDateTime(lastNote.createdAt) : '',
        next: lastNote.nextAction || '',
      }
    : null;

  const isNoInteresado =
    actionType === 'no_interesado' ||
    actionType.toLowerCase().includes('no_interesado') ||
    actionType.toLowerCase().includes('desistimiento') ||
    formActions.find((a) => a.id === actionType)?.label?.toLowerCase().includes('no interesado') ||
    formActions.find((a) => a.id === actionType)?.label?.toLowerCase().includes('descarte') ||
    false;

  const deduceNoInteresadoStage = (resText: string, defaultStage?: string) => {
    const norm = (resText || '').toLowerCase();
    if (norm.includes('presupuesto') || norm.includes('dinero') || norm.includes('costo') || norm.includes('caro')) {
      return 'no_interesado_dinero';
    } else if (norm.includes('ubicacion') || norm.includes('ubicación') || norm.includes('lejos') || norm.includes('zona')) {
      return 'no_interesado_ubicacion';
    } else if (defaultStage) {
      return defaultStage;
    }
    return 'no_interesado_otra';
  };

  const handleActionTypeChange = (newType: string) => {
    setActionType(newType as FollowUpActionType);
    const targetAction = formActions.find((a) => a.id === newType);
    const isNoInt =
      newType === 'no_interesado' ||
      newType.toLowerCase().includes('no_interesado') ||
      newType.toLowerCase().includes('desistimiento') ||
      targetAction?.label?.toLowerCase().includes('no interesado') ||
      targetAction?.label?.toLowerCase().includes('descarte') ||
      false;

    const availableResults =
      fichaConfig.results[newType] ||
      DEFAULT_FICHA_CONFIG.results[newType] ||
      QUICK_RESULTS[newType as FollowUpActionType] ||
      [];
    const firstResult = availableResults.length > 0 ? availableResults[0] : '';
    if (firstResult) {
      setResult(firstResult);
    }

    if (isNoInt) {
      setNextAction('Sin Próximo Contacto (No Interesado)');
      setNextDate('');
      const stage = deduceNoInteresadoStage(firstResult, targetAction?.defaultStageId);
      setPipelineStage(stage);
    } else {
      if (targetAction?.defaultStageId) {
        setPipelineStage(targetAction.defaultStageId);
      } else if (newType === 'cita_reunion') {
        setPipelineStage('cita');
      } else if (newType === 'visita_terreno') {
        setPipelineStage('visita_realizada');
      } else if (newType === 'envio_informacion') {
        setPipelineStage('envio_info');
      }

      if (nextAction.includes('No Interesado') || nextAction.includes('Sin Próximo Contacto')) {
        setNextAction('Próxima Llamada de Seguimiento');
      }
    }

    if (newType === 'cita_reunion' || newType === 'visita_terreno') {
      setAttended(true);
    }
  };

  const handleResultChange = (newResult: string) => {
    setResult(newResult);
    if (isNoInteresado) {
      const targetAction = formActions.find((a) => a.id === actionType);
      const stage = deduceNoInteresadoStage(newResult, targetAction?.defaultStageId);
      setPipelineStage(stage);
    }
  };

  const handleNextActionChange = (actionLabel: string, actionId: string) => {
    setNextAction(actionLabel);
    const foundStep = nextStepOptions.find((s) => s.id === actionId || s.label === actionLabel);

    if (foundStep?.defaultStageId) {
      setPipelineStage(foundStep.defaultStageId);
    } else {
      if (actionId === 'cierre_pago') setPipelineStage('negociacion');
      else if (actionId === 'enviar_cotizacion') setPipelineStage('cotizacion');
      else if (actionId === 'visita_terreno') setPipelineStage('visita_realizada');
      else if (actionId === 'desistimiento') {
        setPipelineStage('no_interesado_dinero');
      }
    }

    if (foundStep?.isReferralProgram || actionId === 'plan_referidos') {
      setInviteReferralProgram(true);
    }

    if (foundStep?.isDesistimiento || !foundStep?.requiresSchedule || actionId === 'desistimiento' || actionId === 'sin_proximo_contacto') {
      setNextDate('');
    }
  };

  const handleSave = async () => {
    const effectiveNextAction = isNoInteresado
      ? (nextAction && !nextAction.includes('Llamada') && !nextAction.includes('Visita') && !nextAction.includes('Cotización')
          ? nextAction
          : 'Sin Próximo Contacto (No Interesado)')
      : nextAction;

    if (!effectiveNextAction) {
      setError('Por favor selecciona la conclusión o próximo paso.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const formattedNextDate = (!isNoInteresado && nextDate) ? `${nextDate} ${nextTime}` : undefined;

      const STANDARD_ACTION_TYPES = ['cita_reunion', 'llamada', 'envio_informacion', 'visita_terreno', 'seguimiento_general'];
      const safeActionType = STANDARD_ACTION_TYPES.includes(actionType) ? actionType : 'seguimiento_general';
      const selectedActionObj = formActions.find((a) => a.id === actionType);
      const customPrefix = (!STANDARD_ACTION_TYPES.includes(actionType) && selectedActionObj)
        ? `[${selectedActionObj.label}] `
        : '';

      const finalResult = (actionType === 'cita_reunion' || actionType === 'visita_terreno')
        ? (attended ? 'Asistió' : 'No asistió (No-Show)')
        : `${customPrefix}${result}`;

      const apiRes = await reportAppointmentFicha(companyId, {
        leadId: targetLeadId || undefined,
        appointmentId: appointmentId || undefined,
        actionType: safeActionType as any,
        result: finalResult,
        attended: (actionType === 'cita_reunion' || actionType === 'visita_terreno') ? attended : true,
        nextAction: effectiveNextAction,
        nextActionDate: formattedNextDate,
        notes: notes.trim() || undefined,
        pipelineStage: pipelineStage || undefined,
        inviteReferralProgram: inviteReferralProgram || effectiveNextAction.includes('Plan de Referidos'),
        project: selectedProject || undefined,
      });

      if ((inviteReferralProgram || effectiveNextAction.includes('Plan de Referidos')) && leadPhone && leadPhone !== 'Sin teléfono') {
        const cleanDigits = leadPhone.replace(/\D/g, '');
        if (cleanDigits.length >= 8) {
          const firstName = (leadName || '').trim().split(' ')[0] || 'Hola';
          const projName = selectedProject || leadProject || 'nuestros proyectos campestres';
          // Usamos secuencias Unicode explícitas (\u{...}) para evitar corrupción de codificación UTF-8 en builds y empaquetados
          const refText = `¡Hola ${firstName}! \u{1F44B} Qué gusto haber conversado contigo sobre ${projName}.\n\nQuiero dejarte una invitación especial: ¿sabías que puedes generar ingresos adicionales con Grupo Constructor Meraki sin comprar lote y sin experiencia en ventas? \u{1F680}\n\nCon nuestro Plan de Referidos, ganas hasta $3.000.000 COP por cada amigo o familiar que recomiendes y adquiera su lote campestre con nosotros:\n\u{2705} Sin límite de referidos.\n\u{2705} Pago directo a tu cuenta tras cumplirse los requisitos de pago.\n\u{2705} Registro 100% online.\n\n\u{1F449} Mira cómo funciona y registra tus referidos en nuestra web oficial:\nhttps://grupoconstructormeraki.com.co/referidos\n\n¡Quedo atento por si tienes a alguien en mente hoy mismo! \u{1F91D}`;
          let targetPhone = cleanDigits;
          if (targetPhone.length === 10 && targetPhone.startsWith('3')) {
            targetPhone = `57${targetPhone}`;
          }
          // Usamos api.whatsapp.com en lugar del shortlink wa.me, ya que wa.me presenta un bug documentado en navegadores desktop donde corrompe caracteres multi-byte (emojis) convirtiéndolos en '?'
          window.open(`https://api.whatsapp.com/send?phone=${targetPhone}&text=${encodeURIComponent(refText)}`, '_blank', 'noopener,noreferrer');
        }
      }

      if (formattedNextDate) {
        setSyncSuccess({
          synced: !!apiRes?.googleSync?.synced,
          directCalendarUrl: apiRes?.googleSync?.directCalendarUrl,
          title: `${actionType === 'visita_terreno' ? '📍 Visita a Terreno' : '📅 Cita / Reunión'}: ${effectiveNextAction} - ${lead?.name || 'Prospecto'}`,
          dateStr: formattedNextDate,
          leadName: lead?.name || 'Prospecto',
          actionLabel: effectiveNextAction,
        });
        if (onSuccess) onSuccess();
      } else {
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err: any) {
      console.error('[FichaTecnicaModal] Error al guardar ficha:', err);
      let msg = err?.message || 'No se pudo guardar la ficha técnica.';
      if (typeof msg === 'string') {
        if (msg.includes('invalid-argument')) {
          msg = msg.replace(/^.*invalid-argument[:\s]*/i, '');
        } else if (msg === 'INTERNAL' || err?.code === 'functions/internal') {
          msg = 'No se pudo registrar la ficha en el servidor. Verifica que los campos obligatorios estén completos e inténtalo de nuevo.';
        }
      }
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (syncSuccess) {
    return (
      <div
        className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto"
        onClick={() => {
          setSyncSuccess(null);
          onClose();
        }}
      >
        <div
          className="w-full max-w-md rounded-3xl border border-emerald-500/40 bg-zinc-950 p-6 shadow-2xl text-zinc-100 flex flex-col items-center text-center space-y-4 animate-in fade-in zoom-in-95 duration-150"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <CheckCircle2 size={36} />
          </div>

          <div>
            <h3 className="text-lg font-bold text-zinc-100">
              ¡Gestión Registrada con Éxito!
            </h3>
            <p className="text-xs text-zinc-400 mt-1">
              Ficha técnica y bitácora guardadas para <strong className="text-zinc-200">{syncSuccess.leadName}</strong>.
            </p>
          </div>

          {/* Tarjeta de estado de sincronización */}
          <div className="w-full p-4 rounded-2xl bg-zinc-900 border border-zinc-800 text-left space-y-2">
            <div className="flex items-center gap-2">
              <Calendar size={16} className={syncSuccess.synced ? 'text-emerald-400' : 'text-amber-400'} />
              <span className="text-xs font-semibold text-zinc-200 truncate">
                {syncSuccess.title}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              📅 Programado para: <span className="text-zinc-200 font-medium">{syncSuccess.dateStr}</span>
            </p>

            {syncSuccess.synced ? (
              <div className="mt-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs flex items-start gap-2">
                <span className="text-base shrink-0">🔔</span>
                <span className="leading-relaxed">
                  <strong>Sincronizado con Google Calendar:</strong> Se creó el evento en tu calendario y la alarma sonará en tu celular (Android / iPhone).
                </span>
              </div>
            ) : (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-start gap-2">
                <span className="text-base shrink-0">⏰</span>
                <span className="leading-relaxed">
                  <strong>Recordatorio agendado en CRM:</strong> Para que suene en tu celular personal, abre Google Calendar o descarga la invitación abajo.
                </span>
              </div>
            )}
          </div>

          {/* Acciones */}
          <div className="w-full flex flex-col gap-2 pt-1">
            {syncSuccess.directCalendarUrl && (
              <a
                href={syncSuccess.directCalendarUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition shadow-md cursor-pointer"
              >
                <ExternalLink size={14} />
                <span>Abrir en Google Calendar</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => {
                const parts = syncSuccess.dateStr.split(' ');
                const datePart = parts[0];
                const timePart = parts[1] || '10:00';
                const d = new Date(`${datePart}T${timePart}:00-05:00`);
                downloadIcsFile({
                  title: syncSuccess.title,
                  description: `Seguimiento comercial con ${syncSuccess.leadName}. Agendado desde CRM Meraki.`,
                  location: selectedProject || lead?.project || 'Meraki',
                  startDate: isNaN(d.getTime()) ? new Date() : d,
                  durationMinutes: syncSuccess.title.includes('Visita') ? 120 : 45,
                });
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-semibold flex items-center justify-center gap-2 transition border border-zinc-700 cursor-pointer"
            >
              <Download size={14} />
              <span>Descargar Invitación .ics para Celular</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setSyncSuccess(null);
                onClose();
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition shadow-lg cursor-pointer mt-1"
            >
              Listo / Continuar
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[150] flex items-center justify-center bg-black/85 backdrop-blur-sm p-0 sm:p-4 overflow-hidden sm:overflow-y-auto"
        onClick={onClose}
      >
        <div
          className="w-full max-w-2xl h-dvh sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-3xl border-0 sm:border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden text-zinc-100 flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] sm:px-6 sm:py-4 sm:pt-4 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="hidden sm:flex items-center gap-1.5 shrink-0">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
              </div>
              <span className="text-xs sm:text-xs font-mono font-semibold text-zinc-200 truncate">
                📋 Ficha Técnica & Seguimiento
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="hidden sm:inline-flex text-[11px] bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2.5 py-0.5 rounded-full font-medium">
                Alimenta Bitácora & Recordatorio
              </span>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center rounded-xl bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 hover:text-white transition-colors cursor-pointer text-base sm:text-sm font-bold shadow-sm active:scale-95"
                aria-label="Cerrar"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Lead Summary Bar */}
          <div className="px-4 py-2.5 sm:px-6 sm:py-3.5 bg-zinc-900/50 border-b border-zinc-800/80 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-sm sm:text-base text-zinc-100 flex items-center gap-2 truncate">
                  <span className="truncate">{leadName}</span>
                  {appointmentId && (
                    <span className="shrink-0 text-[10px] bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 px-2 py-0.5 rounded-full font-mono">
                      Cita Calendario
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-xs text-zinc-400 shrink-0">📞 {leadPhone}</span>
                  <span className="text-zinc-600 hidden sm:inline">•</span>

                  {/* Selector Interactivo de Proyecto de Interés */}
                  <div className="inline-flex items-center gap-1.5 bg-zinc-900/90 hover:bg-zinc-850 border border-zinc-700/80 hover:border-emerald-500/60 rounded-xl px-2.5 py-1 transition-all shadow-sm">
                    <span className="text-xs shrink-0">🏙️</span>
                    <span className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider hidden sm:inline">
                      Proyecto:
                    </span>
                    <select
                      value={selectedProject}
                      onChange={(e) => handleProjectChange(e.target.value)}
                      disabled={updatingProject}
                      className="bg-transparent text-emerald-300 font-bold text-xs outline-none cursor-pointer pr-1"
                      title="Haz clic para actualizar el proyecto de interés del prospecto"
                    >
                      <option value="" className="bg-zinc-900 text-zinc-400">Sin definir / Por definir</option>
                      {MERAKI_PROJECTS.map((proj) => (
                        <option key={proj.id} value={proj.id} className="bg-zinc-900 text-zinc-100">
                          {proj.id}
                        </option>
                      ))}
                      {selectedProject && !MERAKI_PROJECTS.some((p) => p.id === selectedProject) && (
                        <option value={selectedProject} className="bg-zinc-900 text-zinc-100">
                          {selectedProject} (Actual)
                        </option>
                      )}
                    </select>
                    {updatingProject ? (
                      <span className="text-[10px] text-zinc-400 animate-pulse">Guardando…</span>
                    ) : projectSavedToast ? (
                      <span className="text-[10px] text-emerald-400 font-bold animate-in fade-in">✓ Guardado</span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0 bg-zinc-900/80 border border-zinc-800/80 rounded-xl px-2.5 py-1">
                <span className="text-[9px] text-zinc-400 block uppercase font-bold tracking-wider">Asesor</span>
                <span className="text-xs font-semibold text-emerald-400 block truncate max-w-[120px] sm:max-w-none">
                  {advisorName}
                </span>
              </div>
            </div>
          </div>

          {/* Pestañas: Diligenciar vs Historial de Seguimientos */}
          <div className="flex border-b border-zinc-800 bg-zinc-900/60 px-2 sm:px-6 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('form')}
              className={`flex-1 sm:flex-initial py-2.5 sm:py-3 px-3 sm:px-4 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'form'
                  ? 'border-emerald-500 text-emerald-400 bg-zinc-800/40'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>📝</span>
              <span>Diligenciar Ficha</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex-1 sm:flex-initial py-2.5 sm:py-3 px-3 sm:px-4 text-xs font-bold border-b-2 flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'history'
                  ? 'border-emerald-500 text-emerald-400 bg-zinc-800/40'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <span>📜</span>
              <span>Historial</span>
              {totalFollowUpsCount > 0 && (
                <span className="rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] font-mono">
                  {totalFollowUpsCount}
                </span>
              )}
            </button>
          </div>

          {/* Contenido según pestaña */}
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-5 flex-1 min-h-0">
            {activeTab === 'form' ? (
              <>
                {/* Banner de Último Seguimiento Realizado */}
                {lastFollowUpSummary && (
                  <div className="bg-gradient-to-r from-emerald-950/40 via-zinc-900 to-zinc-900 rounded-2xl p-3.5 border border-emerald-500/30 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl shrink-0">🕒</span>
                      <div className="min-w-0">
                        <p className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider">
                          Último Seguimiento Realizado
                        </p>
                        <p className="text-xs text-zinc-200 font-medium truncate">
                          <span className="text-emerald-300 font-semibold">{lastFollowUpSummary.title}</span>
                          {lastFollowUpSummary.result && <span className="text-zinc-300"> ({lastFollowUpSummary.result})</span>}
                          <span className="text-zinc-500 text-[11px]"> · {lastFollowUpSummary.author} ({lastFollowUpSummary.date})</span>
                        </p>
                        {lastFollowUpSummary.next && (
                          <p className="text-[11px] text-amber-300/90 font-medium mt-0.5 truncate">
                            🎯 Próximo paso previo: {lastFollowUpSummary.next}
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveTab('history')}
                      className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 underline shrink-0 cursor-pointer"
                    >
                      Ver todo ({totalFollowUpsCount}) →
                    </button>
                  </div>
                )}

                {/* Selector Prominente de Proyecto de Interés en el Formulario */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-xl shrink-0">🏡</span>
                    <div className="min-w-0">
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-300">
                        Proyecto de Interés
                      </label>
                      <p className="text-[11px] text-zinc-500 truncate">
                        Club o desarrollo sobre el cual se realiza este seguimiento comercial
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={selectedProject}
                      onChange={(e) => handleProjectChange(e.target.value)}
                      disabled={updatingProject}
                      className="w-full sm:w-auto rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-emerald-300 focus:border-emerald-500 focus:outline-none cursor-pointer transition-colors"
                    >
                      <option value="">Sin definir / Por definir</option>
                      {MERAKI_PROJECTS.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.label || proj.id}
                        </option>
                      ))}
                      {selectedProject && !MERAKI_PROJECTS.some((p) => p.id === selectedProject) && (
                        <option value={selectedProject}>{selectedProject} (Personalizado)</option>
                      )}
                    </select>
                    {updatingProject && (
                      <span className="text-[11px] text-zinc-400 animate-pulse">Guardando…</span>
                    )}
                    {projectSavedToast && (
                      <span className="text-[11px] text-emerald-400 font-bold shrink-0">✓ Guardado</span>
                    )}
                  </div>
                </div>

                {/* 1. Tipo de Gestión Realizada */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    1. ¿Qué gestión realizaste con este prospecto?
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {formActions.map((opt, idx) => {
                      const isOddLast = idx === formActions.length - 1 && formActions.length % 2 !== 0;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => handleActionTypeChange(opt.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                            isOddLast
                              ? 'col-span-2 sm:col-span-1 flex flex-row sm:flex-col items-center sm:items-start gap-2.5 sm:gap-1'
                              : 'flex flex-col gap-1'
                          } ${
                            actionType === opt.id
                              ? 'bg-emerald-950/40 border-emerald-500 text-emerald-200 shadow-md shadow-emerald-950/50 ring-1 ring-emerald-500/50'
                              : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                          }`}
                        >
                          <span className="text-base">{opt.icon}</span>
                          <span className="text-xs font-bold leading-tight">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Resultado / Estado de la Gestión */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                    2. Resultado de la gestión
                  </label>

                  {(actionType === 'cita_reunion' || actionType === 'visita_terreno') ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setAttended(true)}
                        className={`py-3 px-4 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          attended
                            ? 'bg-emerald-600/20 border-emerald-500 text-emerald-300 shadow-lg shadow-emerald-950/40'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <span>✓</span> SÍ ASISTIÓ
                      </button>
                      <button
                        type="button"
                        onClick={() => setAttended(false)}
                        className={`py-3 px-4 rounded-xl border text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                          !attended
                            ? 'bg-rose-600/20 border-rose-500 text-rose-300 shadow-lg shadow-rose-950/40'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <span>✕</span> NO ASISTIÓ (NO-SHOW)
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {(fichaConfig.results[actionType] || DEFAULT_FICHA_CONFIG.results[actionType] || QUICK_RESULTS[actionType as FollowUpActionType] || []).map((qRes) => (
                        <button
                          key={qRes}
                          type="button"
                          onClick={() => handleResultChange(qRes)}
                          className={`p-2.5 rounded-xl border text-left text-xs font-medium transition-colors cursor-pointer ${
                            result === qRes
                              ? 'bg-zinc-800 border-emerald-500 text-emerald-300'
                              : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                          }`}
                        >
                          • {qRes}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {isNoInteresado ? (
                  /* Tarjeta informativa en lugar del paso 3 y 5: Caso Concluido */
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-3.5 flex items-start gap-3">
                      <span className="text-xl shrink-0 mt-0.5">🛑</span>
                      <div className="space-y-1 min-w-0">
                        <p className="text-xs font-bold text-rose-300">
                          Caso Concluido / Sin Próximo Contacto (Descarte)
                        </p>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Al registrar como no interesado, <strong>no se requiere próximo paso ni fecha de agendamiento</strong>. El prospecto se archivará en el embudo bajo <strong className="text-zinc-200">No Interesado</strong> sin tareas pendientes.
                        </p>
                      </div>
                    </div>

                    {/* Opción complementaria opcional: Invitar al Plan de Referidos Meraki */}
                    <label className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-start gap-3 cursor-pointer hover:bg-emerald-500/15 transition-colors">
                      <input
                        type="checkbox"
                        checked={inviteReferralProgram}
                        onChange={(e) => setInviteReferralProgram(e.target.checked)}
                        className="mt-1 rounded border-emerald-500/50 bg-zinc-900 text-emerald-500 focus:ring-0"
                      />
                      <div className="space-y-0.5 min-w-0">
                        <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <span>🎁</span>
                          <span>Invitar al Plan de Referidos Meraki (Opcional vía WhatsApp)</span>
                        </p>
                        <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                          Abrirá WhatsApp con la invitación para ganar hasta $3.000.000 COP refiriendo amigos.
                        </p>
                      </div>
                    </label>
                  </div>
                ) : (
                  <>
                    {/* 3. Conclusión & Próximo Paso Obligatorio */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                        3. Conclusión & Próximo Paso Comercial
                      </label>
                      <div className="space-y-1.5 mb-3">
                        {nextStepOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => handleNextActionChange(opt.label, opt.id)}
                            className={`w-full py-2 px-3 rounded-xl border text-left text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                              nextAction === opt.label
                                ? 'bg-zinc-800 border-amber-500 text-amber-200'
                                : 'bg-zinc-900/70 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span>{opt.icon}</span>
                              <span>{opt.label}</span>
                            </span>
                            {nextAction === opt.label && <span className="text-amber-400">●</span>}
                          </button>
                        ))}
                      </div>

                      {/* Agendar Fecha y Hora del Próximo Contacto (Móvil-friendly) */}
                      {(() => {
                        const currentStepConfig = nextStepOptions.find((s) => s.label === nextAction || s.id === nextAction);
                        const isNoFollowUpAction =
                          currentStepConfig?.isDesistimiento ||
                          currentStepConfig?.requiresSchedule === false ||
                          nextAction?.includes('Desistimiento') ||
                          nextAction?.includes('Sin Próximo Contacto') ||
                          nextAction?.includes('Plan de Referidos') ||
                          pipelineStage.startsWith('no_interesado');
                        return isNoFollowUpAction ? (
                        <div className="space-y-2.5">
                          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-start gap-3 text-zinc-300">
                            <span className="text-xl shrink-0 mt-0.5">🛑</span>
                            <div className="space-y-1">
                              <p className="text-xs font-bold text-zinc-200">
                                Sin Próximo Contacto (Caso Concluido / Descarte)
                              </p>
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                Al ser un <strong>desistimiento o conclusión final</strong>, no se programará ningún recordatorio a futuro. La ficha quedará guardada en la bitácora y el prospecto avanzará en el embudo sin tareas pendientes.
                              </p>
                            </div>
                          </div>

                          {/* Tarjeta Plan de Referidos Meraki */}
                          <label className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-start gap-3 cursor-pointer hover:bg-emerald-500/15 transition-colors">
                            <input
                              type="checkbox"
                              checked={inviteReferralProgram || nextAction?.includes('Plan de Referidos')}
                              onChange={(e) => setInviteReferralProgram(e.target.checked)}
                              className="mt-1 rounded border-emerald-500/50 bg-zinc-900 text-emerald-500 focus:ring-0"
                            />
                            <div className="space-y-1">
                              <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                                <span>🎁</span>
                                <span>Invitar al Plan de Referidos Meraki (WhatsApp + Etiqueta CRM)</span>
                              </p>
                              <p className="text-[11px] text-emerald-200/80 leading-relaxed">
                                Aunque el cliente no compre en este momento, al guardar la ficha se etiquetará como <strong>Plan de Referidos</strong> y se abrirá WhatsApp con el mensaje de invitación para que gane comisión si refiere a un amigo o familiar.
                              </p>
                            </div>
                          </label>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/90 flex items-center gap-1.5">
                              <span>⏰</span> Agendar Próximo Contacto (Opcional)
                            </span>
                            {nextDate && (
                              <button
                                type="button"
                                onClick={() => setNextDate('')}
                                className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors cursor-pointer"
                              >
                                ✕ Quitar recordatorio
                              </button>
                            )}
                          </div>

                          {/* Botones rápidos de Fecha */}
                          <div>
                            <span className="block text-[10px] text-zinc-400 mb-1.5 font-medium">
                              Fecha rápida:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {DATE_PRESETS.map((preset) => {
                                const val = preset.getVal();
                                const isSelected = nextDate === val;
                                return (
                                  <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => setNextDate(val)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm shadow-amber-500/20 font-semibold'
                                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/80 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-600'
                                    }`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Botones rápidos de Hora */}
                          <div>
                            <span className="block text-[10px] text-zinc-400 mb-1.5 font-medium">
                              Hora habitual:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {TIME_PRESETS.map((t) => {
                                const isSelected = nextTime === t.value;
                                return (
                                  <button
                                    key={t.value}
                                    type="button"
                                    onClick={() => setNextTime(t.value)}
                                    className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-sm shadow-amber-500/20 font-semibold'
                                        : 'bg-zinc-800/80 text-zinc-300 border-zinc-700/80 hover:bg-zinc-800 hover:text-zinc-100 hover:border-zinc-600'
                                    }`}
                                  >
                                    {t.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Selectores de Fecha y Hora manuales (optimizados para móvil iOS / iPhone y Desktop) */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-zinc-800/70">
                            <div>
                              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300 mb-1.5">
                                <Calendar size={13} className="text-amber-400 shrink-0" />
                                <span>Fecha personalizada:</span>
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  type="date"
                                  value={nextDate}
                                  onChange={(e) => setNextDate(e.target.value)}
                                  style={{ colorScheme: 'dark', minHeight: '40px' }}
                                  className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 focus:outline-none transition-all cursor-pointer font-medium"
                                />
                                {!nextDate && (
                                  <span className="pointer-events-none absolute left-3 text-xs text-zinc-500 flex items-center gap-1.5">
                                    <span>📅</span>
                                    <span>Toca para elegir fecha...</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            <div>
                              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300 mb-1.5">
                                <Clock size={13} className="text-amber-400 shrink-0" />
                                <span>Hora personalizada:</span>
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  type="time"
                                  value={nextTime}
                                  onChange={(e) => setNextTime(e.target.value)}
                                  style={{ colorScheme: 'dark', minHeight: '40px' }}
                                  className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 focus:outline-none transition-all cursor-pointer font-medium"
                                />
                              </div>
                            </div>
                          </div>

                          {/* Previsualización amigable del recordatorio */}
                          {nextDate ? (
                            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col gap-1 text-xs text-amber-200">
                              <div className="flex items-center justify-between">
                                <span className="flex items-center gap-1.5 font-semibold">
                                  <span>🔔</span>
                                  <span>Agendado para: {formatFriendlySchedule(nextDate, nextTime)}</span>
                                </span>
                                <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold uppercase">Programado</span>
                              </div>
                              <p className="text-[11px] text-amber-300/80 flex items-center gap-1">
                                <span>📅</span>
                                <span>Sincronización automática con Google Calendar (alarma sonora en tu celular)</span>
                              </p>
                            </div>
                          ) : (
                            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800/80 text-[11px] text-zinc-400 flex items-center gap-2">
                              <span className="text-zinc-500 font-semibold">✓</span>
                              <span>Sin recordatorio programado (Opcional: puedes guardar directamente sin fecha).</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    </div>

                    {/* 5. Etapa en el Embudo de Ventas (Pipeline) */}
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center justify-between">
                        <span>5. Etapa en el Embudo Comercial (Pipeline)</span>
                        <span className="text-[10px] text-zinc-500 font-normal">Avanza la columna del lead</span>
                      </label>
                      <select
                        value={pipelineStage}
                        onChange={(e) => setPipelineStage(e.target.value)}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none cursor-pointer"
                      >
                        <option value="">Mantener etapa actual / Auto-deducir según gestión</option>
                        {PIPELINE_STAGES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label} ({s.probabilityLabel}) — Fase {s.group.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}

                {/* 6. Observaciones */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-1.5 flex items-center justify-between">
                    <span>
                      {isNoInteresado
                        ? '3. Observaciones / Comentarios Adicionales (Opcional)'
                        : '6. Resumen de la Conversación (Bitácora)'}
                    </span>
                    {isNoInteresado && (
                      <span className="text-[10px] text-zinc-500 font-normal">Opcional para complementar el motivo</span>
                    )}
                  </label>
                  <textarea
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      isNoInteresado
                        ? 'Escribe notas adicionales sobre la respuesta del prospecto (opcional)...'
                        : 'Escribe los acuerdos clave, presupuesto, dudas del cliente, terreno de interés...'
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </>
            ) : (
              /* Pestaña: Historial de Seguimientos */
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-zinc-800">
                  <p className="text-xs text-zinc-400">
                    Historial cronológico de gestiones, llamadas, citas y notas con este contacto.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('form')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/25 transition-colors cursor-pointer"
                  >
                    <span>+</span> Diligenciar Nueva Ficha
                  </button>
                </div>

                {loadingNotes ? (
                  <div className="py-12 flex justify-center text-xs text-zinc-500">
                    <Spinner />
                    <span className="ml-2">Cargando bitácora de seguimientos...</span>
                  </div>
                ) : totalFollowUpsCount === 0 ? (
                  <div className="py-12 text-center text-zinc-500">
                    <p className="text-3xl mb-2">📜</p>
                    <p className="text-xs font-medium text-zinc-400">No hay seguimientos registrados aún para este prospecto.</p>
                    <p className="text-[11px] text-zinc-600 mt-1 max-w-sm mx-auto">
                      Registra una nueva gestión diligenciando la Ficha Técnica oficial.
                    </p>
                    <div className="flex items-center justify-center flex-wrap gap-3 mt-4">
                      <button
                        type="button"
                        onClick={() => setActiveTab('form')}
                        className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 transition-colors cursor-pointer"
                      >
                        Registrar primer seguimiento
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Lista de Fichas y Notas del CRM */}
                    {fichaNotes.map((n) => {
                      const aType = n.actionType || 'seguimiento_general';
                      const color = ACTION_COLORS[aType] || ACTION_COLORS.seguimiento_general;
                      const opt = formActions.find((o) => o.id === aType) || ALL_ACTION_DISPLAY.find((o) => o.id === aType);

                      const observationsText = (n as any).notes || (n.text && n.text.includes('• Observaciones:') ? n.text.split(/• Observaciones:\s*/i)[1]?.trim() : '');
                      const cleanSummaryText = n.text
                        ? n.text.replace(/^📋 FICHA TÉCNICA[^\n]*\n?/i, '').replace(/\n?• Observaciones:[\s\S]*$/i, '').trim()
                        : '';
                      const displayNextAction = (n as any).nextAction || n.nextAction || (n.text ? n.text.match(/• Próximo paso:\s*([^\n(]+)/)?.[1]?.trim() : '');
                      const displayNextDate = (n as any).nextActionDate || n.nextActionDate || (n.text ? n.text.match(/• Próximo paso:[^(]*\(([^)]+)\)/)?.[1]?.trim() : '');

                      return (
                        <div
                          key={n.id}
                          className="relative pl-5 pb-4 border-l-2 border-zinc-800 last:border-l-transparent last:pb-0"
                        >
                          <span className="absolute -left-[7px] top-1.5 w-3 h-3 rounded-full bg-zinc-950 border-2 border-emerald-500"></span>

                          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/60 p-4 space-y-2.5 hover:border-zinc-700 transition-colors">
                            {/* Header del seguimiento */}
                            <div className="flex items-center justify-between flex-wrap gap-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold border ${color.bg} ${color.text} ${color.border}`}>
                                  <span>{opt?.icon || '💬'}</span>
                                  <span>{opt?.label || 'Seguimiento'}</span>
                                </span>
                                {n.result && (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                                    {n.result}
                                  </span>
                                )}
                                {n.kind === 'reminder' && (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    ⏰ Recordatorio
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <div className="text-right text-[11px] text-zinc-400">
                                  <span className="font-semibold text-zinc-300">{n.authorName}</span>
                                  {n.createdAt && <span> · {formatFullDateTime(n.createdAt)}</span>}
                                </div>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteNote(n.id)}
                                    disabled={deletingNoteId === n.id}
                                    title="Eliminar este seguimiento (Solo Administradores)"
                                    className="p-1 rounded-lg text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer disabled:opacity-30"
                                  >
                                    <Trash2 size={13} className={deletingNoteId === n.id ? 'animate-spin' : ''} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Contenido / Resumen corto */}
                            {cleanSummaryText && (
                              <div className="text-xs text-zinc-300 leading-relaxed bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/60 whitespace-pre-wrap">
                                {cleanSummaryText}
                              </div>
                            )}

                            {/* Resumen de la Conversación (Observaciones del Punto 6) */}
                            {observationsText && (
                              <div className="rounded-xl border border-emerald-500/35 bg-emerald-950/20 p-3 space-y-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                                  <span>📝</span>
                                  <span>Resumen de la Conversación (Bitácora):</span>
                                </span>
                                <p className="text-xs text-zinc-100 leading-relaxed whitespace-pre-wrap pl-1 font-normal">
                                  {observationsText}
                                </p>
                              </div>
                            )}

                            {/* Próximo Paso Programado */}
                            {displayNextAction && (
                              <div className="flex items-center gap-2 text-xs bg-amber-500/10 border border-amber-500/25 px-3 py-2 rounded-xl text-amber-200">
                                <span>🎯 Próximo Paso:</span>
                                <span className="font-bold">{displayNextAction}</span>
                                {displayNextDate && (
                                  <span className="text-zinc-400 text-[11px] font-mono ml-auto">
                                    📅 {displayNextDate}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Fijo con Botón Guardar (Siempre visible y accesible con el pulgar) */}
          {activeTab === 'form' && (
            <div className="p-3 sm:p-4 bg-zinc-900/95 border-t border-zinc-800/90 backdrop-blur-md shrink-0 flex flex-col gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {error && (
                <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-500/40 text-rose-200 text-xs shadow-md flex items-start gap-2 animate-in fade-in duration-150">
                  <span className="text-base shrink-0 mt-0.5">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-rose-300">No se pudo guardar la ficha técnica</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-rose-200/90 whitespace-pre-wrap">{error}</p>
                  </div>
                </div>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className={`w-full py-3 sm:py-3.5 ${
                  isNoInteresado
                    ? 'bg-gradient-to-r from-rose-600 via-rose-700 to-zinc-800 hover:from-rose-500 hover:to-zinc-700'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500'
                } active:scale-[0.99] text-white font-bold rounded-xl text-xs sm:text-sm transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50`}
              >
                {saving ? (
                  <>
                    <Spinner />
                    <span>{isNoInteresado ? 'Guardando Descarte...' : 'Guardando Ficha y Programando Recordatorio...'}</span>
                  </>
                ) : (
                  <>
                    <span>{isNoInteresado ? '🛑' : '💾'}</span>
                    <span>{isNoInteresado ? 'Guardar Ficha & Registrar Descarte' : 'Guardar Ficha & Registrar en Bitácora'}</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
