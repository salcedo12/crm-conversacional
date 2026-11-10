import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardList,
  Calendar as CalendarIcon,
  AlarmClock,
  MessageSquare,
  Phone,
  CheckCircle2,
  AlertTriangle,
  Building2,
  User,
} from 'lucide-react';
import { useAuth }  from '@/features/auth/hooks/useAuth';
import { isAdminRole } from '@/features/auth/types';
import { listAdvisors, type Advisor } from '@/features/leads/services/advisors.service';
import { Spinner }  from '@/shared/components/Spinner';
import { Button }   from '@/shared/components/Button';
import { EventModal } from '../components/EventModal';
import { FichaTecnicaModal } from '../components/FichaTecnicaModal';
import {
  listCalendarEvents,
  cancelAppointment,
  deleteCalendarEvent,
  completeLeadFollowUp,
  sendMorningAgendaSummaryNow,
  type CalendarEvent,
} from '../services/calendar.service';

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const fmtTime = (ms: number) => new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit' }).format(ms);
const fmtDateShort = (ms: number) => new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', month: 'short' }).format(ms);
const dayKey  = (d: Date | number) => { const x = new Date(d); return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; };

function formatRelativeTime(targetMs: number): string {
  const diffMin = Math.round((targetMs - Date.now()) / 60000);
  if (diffMin < 0) {
    const absMin = Math.abs(diffMin);
    if (absMin < 60) return `Vencido hace ${absMin} min`;
    const hours = Math.floor(absMin / 60);
    if (hours < 24) return `Vencido hace ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Vencido hace ${days} día(s)`;
  }
  if (diffMin === 0) return 'Ahora mismo';
  if (diffMin < 60) return `En ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  if (hours < 24) return `En ${hours}h`;
  const days = Math.floor(hours / 24);
  return `En ${days} día(s)`;
}

/** Lunes de la semana que contiene `d` (inicio de grilla). */
function startOfGrid(monthStart: Date): Date {
  const d = new Date(monthStart);
  const dow = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dow);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function CalendarPage() {
  const { companyId, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'pending' | 'calendar'>('pending');
  const [viewDate, setViewDate] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); return d; });
  const [events,   setEvents]   = useState<CalendarEvent[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showGoogleNotice, setShowGoogleNotice] = useState(true);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<Date | null>(null);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [dayDetail, setDayDetail] = useState<{ date: Date; events: CalendarEvent[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [fichaAppt, setFichaAppt] = useState<CalendarEvent | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [sendingSummary, setSendingSummary] = useState(false);

  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [advisorFilter, setAdvisorFilter] = useState<string>('all');

  useEffect(() => {
    if (!companyId || !isAdmin) return;
    listAdvisors(companyId).then(setAdvisors).catch(() => {});
  }, [companyId, isAdmin]);

  const advisorMap = useMemo(
    () => new Map(advisors.map((a) => [a.id, a.displayName])),
    [advisors]
  );

  const copyMeet = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard no disponible */
    }
  };

  // 42 días (6 semanas) desde el lunes de la primera semana
  const gridDays = useMemo(() => {
    const start = startOfGrid(viewDate);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [viewDate]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    try {
      const from = gridDays[0];
      const to   = new Date(gridDays[41]); to.setHours(23, 59, 59);
      const r = await listCalendarEvents(companyId, from, to);
      setEvents(r.events);
      setConnected(r.connected);
    } catch {
      setError('No se pudieron cargar los eventos.');
    } finally {
      setLoading(false);
    }
  }, [companyId, gridDays]);

  useEffect(() => { load(); }, [load]);

  const filteredEvents = useMemo(() => {
    if (!isAdmin || advisorFilter === 'all') return events;
    return events.filter((ev) => ev.advisorId === advisorFilter);
  }, [events, isAdmin, advisorFilter]);

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const e of filteredEvents) (map[dayKey(e.start)] ??= []).push(e);
    for (const k in map) map[k].sort((a, b) => a.start - b.start);
    return map;
  }, [filteredEvents]);

  // Clasificación para la Bandeja Rápida de "Mis Pendientes de Hoy / Vencidos"
  const pendingGroups = useMemo(() => {
    const nowMs = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const next7DaysEnd = new Date(todayEnd.getTime() + 7 * 86400000);

    // Solo tareas accionables del CRM (citas programadas sin ficha o recordatorios activos)
    const actionable = filteredEvents.filter((ev) => {
      if (ev.source === 'google') return false;
      if (ev.status === 'canceled' || ev.status === 'completed') return false;
      if (ev.postCitaStatus === 'reported' || ev.attended !== undefined) return false;
      return true;
    });

    const overdue: CalendarEvent[] = [];
    const today: CalendarEvent[] = [];
    const upcoming: CalendarEvent[] = [];

    for (const ev of actionable) {
      const isToday = ev.start >= todayStart.getTime() && ev.start <= todayEnd.getTime();
      if (ev.start < nowMs) {
        overdue.push(ev);
      } else if (isToday) {
        today.push(ev);
      } else if (ev.start <= next7DaysEnd.getTime()) {
        upcoming.push(ev);
      }
    }

    overdue.sort((a, b) => a.start - b.start);
    today.sort((a, b) => a.start - b.start);
    upcoming.sort((a, b) => a.start - b.start);

    return {
      overdue,
      today,
      upcoming,
      urgentCount: overdue.length + today.length,
    };
  }, [filteredEvents]);

  const handleMarkFollowUpDone = async (ev: CalendarEvent) => {
    if (!companyId || !ev.leadId) return;
    setCompletingId(ev.id);
    try {
      await completeLeadFollowUp(companyId, ev.leadId);
      setEvents((prev) => prev.filter((item) => item.id !== ev.id));
    } catch {
      alert('No se pudo marcar el seguimiento como realizado.');
    } finally {
      setCompletingId(null);
    }
  };

  const handleSendMorningSummary = async () => {
    if (!companyId || sendingSummary) return;
    setSendingSummary(true);
    try {
      const res = await sendMorningAgendaSummaryNow(companyId, isAdmin ? advisorFilter : undefined);
      if (res.advisorsNotified > 0) {
        alert(`☀️ Resumen matutino enviado a ${res.advisorsNotified} asesor(es) (${res.totalItems} compromisos incluidos).`);
      } else {
        alert('No hay compromisos pendientes para hoy o vencidos para enviar en este momento.');
      }
    } catch {
      alert('No se pudo enviar el resumen matutino.');
    } finally {
      setSendingSummary(false);
    }
  };

  const handleDelete = async (ev: CalendarEvent) => {
    if (!companyId) return;
    if (!confirm(ev.source === 'crm' ? '¿Cancelar esta cita?' : '¿Eliminar este evento de Google Calendar?')) return;
    try {
      if (ev.source === 'crm') await cancelAppointment(companyId, ev.id);
      else                     await deleteCalendarEvent(companyId, ev.id);
      setSelected(null);
      load();
    } catch {
      alert('No se pudo eliminar/cancelar.');
    }
  };

  const todayKey = dayKey(new Date());
  const goMonth = (delta: number) => setViewDate((d) => { const n = new Date(d); n.setMonth(n.getMonth() + delta); return n; });
  const goToday = () => { const d = new Date(); d.setDate(1); d.setHours(0,0,0,0); setViewDate(d); };

  const renderTaskCard = (ev: CalendarEvent, category: 'overdue' | 'today' | 'upcoming') => {
    const isReminder = ev.source === 'reminder';
    const advisorName = ev.advisorId ? advisorMap.get(ev.advisorId) : null;

    return (
      <div
        key={`${ev.source}-${ev.id}`}
        className={`rounded-xl border p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          category === 'overdue'
            ? 'border-rose-500/35 bg-rose-950/20 hover:border-rose-500/60'
            : category === 'today'
            ? 'border-amber-500/35 bg-amber-950/15 hover:border-amber-500/60'
            : 'border-zinc-800 bg-zinc-900/70 hover:border-zinc-700'
        }`}
      >
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {/* Hora Destacada */}
          <div
            className={`shrink-0 rounded-xl px-3 py-2 text-center border min-w-[84px] ${
              category === 'overdue'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                : category === 'today'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                : 'border-zinc-700 bg-zinc-800/80 text-zinc-200'
            }`}
          >
            <div className="text-xs font-bold">{fmtTime(ev.start)}</div>
            <div className="text-[10px] opacity-80 mt-0.5">{fmtDateShort(ev.start)}</div>
          </div>

          {/* Información del Prospecto y Tarea */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                  isReminder
                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    : 'bg-violet-500/15 text-violet-300 border-violet-500/30'
                }`}
              >
                {isReminder ? '⏰ Seguimiento / Llamada' : '📅 Cita Agendada'}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  category === 'overdue'
                    ? 'bg-rose-500/20 text-rose-300 font-semibold'
                    : category === 'today'
                    ? 'bg-amber-500/20 text-amber-200'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {formatRelativeTime(ev.start)}
              </span>
              {isAdmin && advisorName && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-300 border border-sky-500/30">
                  👤 {advisorName}
                </span>
              )}
            </div>

            <h4 className="text-sm font-semibold text-zinc-100 truncate">
              {ev.nextAction || ev.title}
            </h4>

            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
              {ev.leadName && (
                <span className="flex items-center gap-1 text-zinc-200 font-medium">
                  <User size={12} className="text-zinc-500" /> {ev.leadName}
                </span>
              )}
              {ev.leadPhone && (
                <span className="flex items-center gap-1">
                  <Phone size={11} className="text-zinc-500" /> {ev.leadPhone}
                </span>
              )}
              {ev.project && (
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <Building2 size={12} /> {ev.project}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Botones de Acción Rápida (Evacuar 1 por 1) */}
        <div className="flex flex-wrap items-center gap-1.5 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-800/80">
          {ev.leadPhone && (
            <a
              href={`tel:${ev.leadPhone.replace(/\D/g, '')}`}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs border border-zinc-700 flex items-center gap-1"
              title="Llamar por teléfono"
            >
              <Phone size={12} /> Llamar
            </a>
          )}
          {ev.leadId && (
            <button
              type="button"
              onClick={() => navigate(`/dashboard/inbox?lead=${ev.leadId}`)}
              className="px-2.5 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-200 text-xs border border-violet-500/30 flex items-center gap-1 cursor-pointer"
              title="Abrir conversación en el Inbox del CRM"
            >
              <MessageSquare size={12} /> Chat CRM
            </button>
          )}
          <button
            type="button"
            onClick={() => setFichaAppt(ev)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer"
            title="Registrar gestión en Ficha Técnica y programar siguiente paso"
          >
            <ClipboardList size={13} /> Ficha Técnica
          </button>
          {isReminder && ev.leadId && (
            <button
              type="button"
              disabled={completingId === ev.id}
              onClick={() => handleMarkFollowUpDone(ev)}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-emerald-500/20 hover:text-emerald-300 hover:border-emerald-500/40 text-zinc-400 text-xs border border-zinc-700 flex items-center gap-1 cursor-pointer transition-colors"
              title="Marcar este recordatorio como ya realizado"
            >
              <CheckCircle2 size={12} /> {completingId === ev.id ? '...' : 'Hecho'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header con Selector de Pestañas */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          {/* Switcher de Vista */}
          <div className="flex items-center rounded-xl bg-zinc-900 p-1 border border-zinc-800">
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'pending'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <AlarmClock size={14} className={pendingGroups.urgentCount > 0 ? 'text-amber-400' : ''} />
              <span>Mis Pendientes de Hoy</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold ${
                  pendingGroups.overdue.length > 0
                    ? 'bg-rose-500 text-white'
                    : pendingGroups.urgentCount > 0
                    ? 'bg-amber-500/30 text-amber-200'
                    : 'bg-zinc-800 text-zinc-400'
                }`}
              >
                {pendingGroups.urgentCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeTab === 'calendar'
                  ? 'bg-violet-600/25 text-violet-200 border border-violet-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <CalendarIcon size={14} />
              <span>Calendario Mensual</span>
            </button>
          </div>

          {activeTab === 'calendar' && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h2 className="text-xs sm:text-sm font-semibold text-zinc-100 truncate">
                {MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}
              </h2>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => goMonth(-1)} className="px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800">◀</button>
                <button onClick={goToday} className="px-2.5 py-1 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800 border border-zinc-700">Hoy</button>
                <button onClick={() => goMonth(1)} className="px-2 py-1 rounded-lg text-zinc-400 hover:bg-zinc-800">▶</button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && advisors.length > 0 && (
            <select
              value={advisorFilter}
              onChange={(e) => setAdvisorFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="all">👥 Todos los asesores</option>
              {advisors.map((adv) => (
                <option key={adv.id} value={adv.id}>
                  {adv.displayName}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={handleSendMorningSummary}
            disabled={sendingSummary}
            title="El resumen se envía automáticamente todos los días a las 8:00 AM. Haz clic para enviarlo ahora mismo por WhatsApp/Push/Correo."
            className="rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition-colors cursor-pointer disabled:opacity-50"
          >
            {sendingSummary ? 'Enviando...' : '☀️ Enviar Resumen WhatsApp'}
          </button>
          <Button size="sm" onClick={() => setCreateFor(new Date())}>
            <span className="sm:hidden">+ Evento</span><span className="hidden sm:inline">+ Nuevo evento</span>
          </Button>
        </div>
      </div>

      {/* Aviso si no hay Google conectado */}
      {connected === false && showGoogleNotice && (
        <div className="mx-3 sm:mx-5 mt-3 rounded-xl bg-zinc-900/90 border border-zinc-800 px-4 py-2.5 shrink-0 flex items-center justify-between gap-3 text-xs text-zinc-300 shadow-sm">
          <div className="flex items-center gap-2 min-w-0">
            <span>📅</span>
            <span>
              Mostrando citas y recordatorios del CRM. Puedes vincular <strong>Google Calendar</strong> en Configuración si deseas sincronizar también tus eventos externos.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowGoogleNotice(false)}
            className="text-zinc-500 hover:text-zinc-300 text-xs px-1.5 py-0.5 rounded cursor-pointer"
            title="Ocultar aviso"
          >
            ✕
          </button>
        </div>
      )}
      {error && <p className="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 shrink-0">{error}</p>}

      {/* Contenido Principal */}
      <div className="flex-1 overflow-auto p-3 sm:p-5">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : activeTab === 'pending' ? (
          <div className="max-w-5xl mx-auto space-y-6">
            {/* Resumen Rápido de Bandeja */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-rose-300 uppercase tracking-wider">🚨 Vencidos / En Mora</p>
                  <p className="text-2xl font-bold text-rose-200 mt-0.5">{pendingGroups.overdue.length}</p>
                  <p className="text-[11px] text-rose-300/70">Requieren Ficha Técnica o contacto ya</p>
                </div>
                <AlertTriangle size={26} className="text-rose-400/70" />
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-amber-300 uppercase tracking-wider">⚡ Programados para Hoy</p>
                  <p className="text-2xl font-bold text-amber-200 mt-0.5">{pendingGroups.today.length}</p>
                  <p className="text-[11px] text-amber-300/70">Ordenados por hora de llamada/cita</p>
                </div>
                <AlarmClock size={26} className="text-amber-400/70" />
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">📆 Próximos 7 Días</p>
                  <p className="text-2xl font-bold text-zinc-100 mt-0.5">{pendingGroups.upcoming.length}</p>
                  <p className="text-[11px] text-zinc-500">Agenda futura confirmada</p>
                </div>
                <CalendarIcon size={26} className="text-zinc-500" />
              </div>
            </div>

            {pendingGroups.overdue.length === 0 && pendingGroups.today.length === 0 && pendingGroups.upcoming.length === 0 && (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                  <CheckCircle2 size={24} />
                </div>
                <h3 className="text-sm font-semibold text-zinc-100">¡Estás 100% al día con tus seguimientos!</h3>
                <p className="mt-1 text-xs text-zinc-400 max-w-md mx-auto">
                  No tienes llamadas ni citas vencidas o pendientes para hoy. Cuando registres una Ficha Técnica con próximo paso, aparecerá aquí ordenada por hora.
                </p>
              </div>
            )}

            {/* 1. Vencidos */}
            {pendingGroups.overdue.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                    <AlertTriangle size={14} /> Vencidos / En Mora ({pendingGroups.overdue.length})
                  </h3>
                  <span className="text-[11px] text-rose-300/80">Evacúalos primero para evitar bloqueo SLA</span>
                </div>
                <div className="space-y-2">
                  {pendingGroups.overdue.map((ev) => renderTaskCard(ev, 'overdue'))}
                </div>
              </div>
            )}

            {/* 2. Para Hoy */}
            {pendingGroups.today.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1.5">
                    <AlarmClock size={14} /> Para Hoy ({pendingGroups.today.length})
                  </h3>
                  <span className="text-[11px] text-zinc-400">Ordenados cronológicamente por hora</span>
                </div>
                <div className="space-y-2">
                  {pendingGroups.today.map((ev) => renderTaskCard(ev, 'today'))}
                </div>
              </div>
            )}

            {/* 3. Próximos 7 días */}
            {pendingGroups.upcoming.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <CalendarIcon size={14} /> Próximos 7 Días ({pendingGroups.upcoming.length})
                </h3>
                <div className="space-y-2">
                  {pendingGroups.upcoming.map((ev) => renderTaskCard(ev, 'upcoming'))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Grilla Mensual Clásica */
          <div className="grid grid-cols-7 gap-px bg-zinc-800 border border-zinc-800 rounded-xl overflow-hidden">
            {WEEKDAYS.map((w) => (
              <div key={w} className="bg-zinc-950 px-2 py-1.5 text-center text-[11px] font-medium text-zinc-500">{w}</div>
            ))}
            {gridDays.map((d) => {
              const k = dayKey(d);
              const inMonth = d.getMonth() === viewDate.getMonth();
              const isToday = k === todayKey;
              const dayEvents = byDay[k] ?? [];
              return (
                <div
                  key={k}
                  onClick={() => setCreateFor(d)}
                  className={`min-h-[64px] sm:min-h-[96px] bg-zinc-950 p-1 sm:p-1.5 cursor-pointer hover:bg-zinc-900 transition-colors ${inMonth ? '' : 'opacity-40'}`}
                >
                  <div className={`text-[11px] mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-violet-600 text-white font-semibold' : 'text-zinc-400'}`}>
                    {d.getDate()}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={`${ev.source}-${ev.id}`}
                        onClick={(e) => { e.stopPropagation(); setSelected(ev); }}
                        className={`text-left text-[10px] px-1.5 py-0.5 rounded truncate font-medium
                          ${ev.status === 'canceled' ? 'line-through opacity-50 ' : ''}
                          ${ev.source === 'reminder'
                            ? 'bg-amber-500/25 text-amber-200 border border-amber-500/40 shadow-sm'
                            : ev.source === 'crm'
                            ? 'bg-violet-600/25 text-violet-200'
                            : 'bg-sky-600/25 text-sky-200'}`}
                        title={ev.title}
                      >
                        {!ev.allDay && <span className="opacity-70">{fmtTime(ev.start)} </span>}{ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDayDetail({ date: d, events: dayEvents });
                        }}
                        className="w-fit text-left text-[9px] text-zinc-500 pl-1 hover:text-violet-300"
                      >
                        +{dayEvents.length - 3} más
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal crear */}
      {createFor && companyId && (
        <EventModal companyId={companyId} defaultDate={createFor} onClose={() => setCreateFor(null)} onCreated={load} />
      )}

      {/* Eventos del dia */}
      {dayDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]" onClick={() => setDayDetail(null)}>
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase text-zinc-500">Eventos del dia</p>
                <h3 className="text-sm font-semibold text-zinc-100">
                  {new Intl.DateTimeFormat('es-CO', { dateStyle: 'full' }).format(dayDetail.date)}
                </h3>
              </div>
              <button onClick={() => setDayDetail(null)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800">x</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto pr-1">
              <div className="flex flex-col gap-2">
                {dayDetail.events.map((ev) => (
                  <button
                    key={`${ev.source}-${ev.id}`}
                    type="button"
                    onClick={() => {
                      setDayDetail(null);
                      setSelected(ev);
                    }}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors hover:border-violet-500/40
                      ${ev.source === 'reminder' ? 'border-amber-500/30 bg-amber-500/10' : ev.source === 'crm' ? 'border-violet-500/20 bg-violet-600/10' : 'border-sky-500/20 bg-sky-600/10'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`min-w-0 truncate text-xs font-medium ${ev.status === 'canceled' ? 'line-through text-zinc-500' : 'text-zinc-100'}`}>
                        {ev.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-500">
                        {ev.allDay ? 'Todo el dia' : `${fmtTime(ev.start)}-${fmtTime(ev.end)}`}
                      </span>
                    </div>
                    {ev.leadName && <p className="mt-1 truncate text-[11px] text-zinc-500">{ev.leadName}</p>}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setDayDetail(null)}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Detalle evento */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]" onClick={() => setSelected(null)}>
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-5 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] px-2 py-0.5 rounded-full border ${
                selected.source === 'reminder'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                  : selected.source === 'crm'
                  ? 'bg-violet-600/20 text-violet-300 border-violet-500/30 font-semibold'
                  : 'bg-sky-600/20 text-sky-300 border-sky-500/30'
              }`}>
                {selected.source === 'reminder' ? '⏰ Recordatorio de Seguimiento' : selected.source === 'crm' ? 'Cita CRM' : 'Google Calendar'}
              </span>
              {selected.status && <span className="text-[10px] text-zinc-500">{selected.status}</span>}
            </div>
            <h3 className="text-sm font-semibold text-zinc-100">{selected.title}</h3>
            <p className="text-xs text-zinc-400">
              {new Intl.DateTimeFormat('es-CO', { dateStyle: 'full' }).format(selected.start)}
              {!selected.allDay && ` · ${fmtTime(selected.start)}–${fmtTime(selected.end)}`}
            </p>
            {selected.leadName && <p className="text-xs text-zinc-300 font-medium">👤 Prospecto: {selected.leadName}</p>}
            {selected.project && <p className="text-[11px] text-zinc-400">🏢 Proyecto: {selected.project}</p>}

            {/* Acciones directas de llamada / WhatsApp si tiene teléfono */}
            {selected.leadPhone && (
              <div className="flex items-center gap-2 pt-1 border-t border-zinc-800/80">
                <span className="text-xs text-zinc-400">📞 {selected.leadPhone}</span>
                <a
                  href={`tel:${selected.leadPhone.replace(/\D/g, '')}`}
                  className="px-2 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-[11px] border border-zinc-700 cursor-pointer"
                >
                  Llamar
                </a>
                <a
                  href={`https://wa.me/${selected.leadPhone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[11px] border border-emerald-500/30 cursor-pointer"
                >
                  WhatsApp
                </a>
                {selected.leadId && (
                  <button
                    type="button"
                    onClick={() => navigate(`/dashboard/inbox?lead=${selected.leadId}`)}
                    className="px-2 py-1 rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 text-[11px] border border-violet-500/30 cursor-pointer"
                  >
                    Chat CRM
                  </button>
                )}
              </div>
            )}
            {selected.meetLink && (
              <div className="flex flex-col gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-emerald-400">🎥</span>
                  <input
                    readOnly
                    value={selected.meetLink}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 rounded border border-emerald-500/25 bg-emerald-950/30 px-2 py-1 font-mono text-[11px] text-emerald-200 outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <a
                    href={selected.meetLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/25"
                  >
                    Unirse a Meet
                  </a>
                  <button
                    onClick={() => copyMeet(selected.meetLink!)}
                    className="inline-flex items-center gap-1.5 rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200 hover:bg-emerald-500/20"
                  >
                    {copied ? 'Copiado' : 'Copiar enlace'}
                  </button>
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 justify-between items-center mt-2 border-t border-zinc-800 pt-3">
              <div>
                {(selected.source === 'crm' || selected.source === 'reminder') && selected.status !== 'canceled' && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 font-medium cursor-pointer"
                    onClick={() => setFichaAppt(selected)}
                  >
                    <ClipboardList size={14} /> Diligenciar Ficha Técnica
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>Cerrar</Button>
                {selected.status !== 'canceled' && (
                  <Button variant="secondary" size="sm" onClick={() => handleDelete(selected)}>
                    {selected.source === 'crm' ? 'Cancelar cita' : 'Eliminar'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ficha Técnica Post-Cita / Seguimiento */}
      {fichaAppt && companyId && (
        <FichaTecnicaModal
          isOpen={!!fichaAppt}
          onClose={() => setFichaAppt(null)}
          onSuccess={() => {
            setFichaAppt(null);
            setSelected(null);
            load();
          }}
          companyId={companyId}
          appointment={{
            id: fichaAppt.source === 'reminder' ? undefined : fichaAppt.id,
            leadId: fichaAppt.leadId,
            leadName: fichaAppt.leadName,
            leadPhone: fichaAppt.leadPhone,
            title: fichaAppt.title,
            project: fichaAppt.project,
          }}
        />
      )}
    </div>
  );
}
