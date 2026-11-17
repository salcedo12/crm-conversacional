import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { AlertTriangle, ShieldAlert, ClipboardList, Eye } from 'lucide-react';
import { Spinner }              from '@/shared/components/Spinner';
import { EmptyState }           from '@/shared/components/EmptyState';
import { useAuth }              from '@/features/auth/hooks/useAuth';
import { isAdminRole, isViewerRole } from '@/features/auth/types';
import { MessageBubble }        from './MessageBubble';
import { ConversationHeader }   from './ConversationHeader';
import { MessageComposer }      from './MessageComposer';
import type { DeliveryChannel } from './MessageComposer';
import { TemplatePickerModal }  from './TemplatePickerModal';
import { FichaTecnicaModal }    from '@/features/calendar/components/FichaTecnicaModal';
import { RequestLeadTransferModal } from '@/features/leads/components/RequestLeadTransferModal';
import { isWindowOpen }         from '../utils/conversationWindow';
import type { Lead }            from '../types';
import type { MediaUploadResult } from '../services/media.service';
import { useMessages }          from '../hooks/useMessages';
import { sendManualMessage, pauseAi, resumeAi, reactToMessage } from '../services/messages.service';
import { listAdvisorWhatsappConnections, getMyMessagingLine } from '@/features/config/services/advisorWhatsapp.service';
import type { AdvisorWhatsappStatus } from '@/features/config/services/advisorWhatsapp.service';
import type { Message } from '../types';
import { markLeadRead }         from '../services/notifications.service';
import { inboxLabel }           from '../utils/inboxes';

interface ChatWindowProps {
  lead:      Lead;
  companyId: string;
  /** Nombres de asesores por uid, para etiquetar quién envió cada mensaje. */
  advisorNames?: Map<string, string>;
  onOpenLeadDetails?: () => void;
  onBack?:   () => void;
  onMarkedRead?: (leadId: string, readAtMillis: number) => void;
}

export function ChatWindow({ lead, companyId, advisorNames, onOpenLeadDetails, onBack, onMarkedRead }: ChatWindowProps) {
  const { user, role, platformAdmin } = useAuth();
  const isAdmin = platformAdmin || isAdminRole(role);
  // "Solo lectura": ve todas las conversaciones completas (como un admin), pero sin
  // compositor, plantillas, reacciones ni control de la IA.
  const readOnly = !platformAdmin && isViewerRole(role);
  const canSeeAll = isAdmin || readOnly;
  const isAssignedToOther = !canSeeAll && !!lead.assignedTo && !!user?.uid && lead.assignedTo !== user.uid;
  const { messages, loading, loadingMore, hasMore, loadMore } = useMessages(companyId, isAssignedToOther ? null : lead.id);

  // Muro de Privacidad de Chats en Reasignaciones (Protocolo Meraki)
  // Si el usuario es un asesor (no admin), y el lead fue asignado o reasignado, se ocultan los mensajes
  // anteriores a la asignación para proteger la confidencialidad de la gestión previa.
  const isReassigned = !canSeeAll && !!lead.advisorAssignedAt;
  const cutoffTime = isReassigned && lead.advisorAssignedAt ? lead.advisorAssignedAt.toMillis() : 0;

  const { visibleMessages, hiddenCount } = useMemo(() => {
    if (!cutoffTime) return { visibleMessages: messages, hiddenCount: 0 };
    const millisOf = (msg: Message) => msg.createdAt
      ? (typeof msg.createdAt.toMillis === 'function'
          ? msg.createdAt.toMillis()
          : (msg.createdAt.seconds ? msg.createdAt.seconds * 1000 : 0))
      : 0;
    // El muro protege la gestión de OTRO asesor. Si antes del corte solo hubo cliente,
    // IA y avisos del sistema, no hay nada que proteger: el asesor debe ver lo que la
    // IA habló con el cliente para saber en qué va la conversación.
    const priorHumanAdvisor = messages.some(
      (msg) => msg.senderType === 'advisor' && millisOf(msg) < cutoffTime
    );
    if (!priorHumanAdvisor) return { visibleMessages: messages, hiddenCount: 0 };
    const visible: Message[] = [];
    let hidden = 0;
    for (const msg of messages) {
      const msgMillis = millisOf(msg);
      if (msgMillis >= cutoffTime) {
        visible.push(msg);
      } else {
        hidden++;
      }
    }
    return { visibleMessages: visible, hiddenCount: hidden };
  }, [messages, cutoffTime]);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const scrollRef             = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef   = useRef<number | null>(null);
  const loadingOlderRef       = useRef(false);
  const markedReadKeyRef      = useRef<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFichaModal, setShowFichaModal] = useState(false);
  const [showReassignModal, setShowReassignModal] = useState(false);
  const [advisorWhatsappAvailable, setAdvisorWhatsappAvailable] = useState(false);
  const [advisorWhatsappPhone, setAdvisorWhatsappPhone] = useState<string | null>(null);
  const [advisorWhatsappStatus, setAdvisorWhatsappStatus] = useState<AdvisorWhatsappStatus | null>(null);

  // Al cargar mensajes anteriores, conservar la posición visual (no saltar al fondo);
  // en cualquier otro cambio (mensaje nuevo / apertura), bajar al último mensaje.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (loadingOlderRef.current && el && prevScrollHeightRef.current != null) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current;
      loadingOlderRef.current = false;
      prevScrollHeightRef.current = null;
      return;
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages]);

  const handleLoadMore = () => {
    const el = scrollRef.current;
    prevScrollHeightRef.current = el ? el.scrollHeight : null;
    loadingOlderRef.current = true;
    loadMore();
  };

  useEffect(() => {
    if (!companyId || !lead.lastInboundAt || isAssignedToOther) return;
    const readAtMillis = lead.lastInboundAt.toMillis();
    const markKey = `${companyId}:${lead.id}:${readAtMillis}`;
    if (markedReadKeyRef.current === markKey) return;

    markedReadKeyRef.current = markKey;
    onMarkedRead?.(lead.id, readAtMillis);
    // Solo lectura no escribe en el lead: su marca de leído queda solo local.
    if (readOnly) return;
    markLeadRead(companyId, lead.id, readAtMillis).catch((err) => {
      console.warn('[ChatWindow] No se pudo marcar el lead como leido:', err);
    });
  }, [companyId, lead.id, lead.lastInboundAt, onMarkedRead, isAssignedToOther, readOnly]);

  const isWhatsapp = !lead.channel || lead.channel === 'whatsapp';
  // La ventana de 24h SOLO la abre un mensaje entrante real del lead. Un lead sin
  // lastInboundAt (contacto agregado manualmente / importado) está fuera de ventana:
  // el primer mensaje debe ser una plantilla, no texto libre (WhatsApp lo rechaza).
  const windowOpen = isWindowOpen(lead.lastInboundAt ?? null);
  const companyLineBlocked = isWhatsapp && !windowOpen;
  // Un lead que entró POR USUARIO (sin número visible) SOLO lo alcanza la línea que
  // contactó (el 317): su identidad de WhatsApp está atada a esa WABA. Ninguna línea
  // personal —Baileys (solo teléfonos) ni coexistencia (otra WABA)— puede escribirle.
  // Por eso "Mi WhatsApp" se deshabilita cuando el lead no tiene teléfono.
  const leadHasPhone = !!lead.phone;
  const advisorAvailableForLead = advisorWhatsappAvailable && leadHasPhone;
  const canUseComposer = !isWhatsapp || windowOpen || advisorAvailableForLead;
  const defaultDeliveryChannel: DeliveryChannel = companyLineBlocked && advisorAvailableForLead
    ? 'advisor_whatsapp'
    : 'company_whatsapp';

  useEffect(() => {
    if (!companyId || !user?.uid) {
      setAdvisorWhatsappAvailable(false);
      setAdvisorWhatsappPhone(null);
      setAdvisorWhatsappStatus(null);
      return;
    }

    let cancelled = false;
    const refreshAdvisorWhatsapp = () => {
      // "Mi WhatsApp" puede ser: (a) la línea de COEXISTENCIA YCloud del asesor
      // (su propio número por la API oficial) o (b) el puente Baileys (legado).
      // Se prefiere la coexistencia; el envío real lo decide el backend.
      Promise.all([
        listAdvisorWhatsappConnections(companyId, user.uid).catch(() => []),
        getMyMessagingLine(companyId).catch(() => null),
      ])
      .then(([connections, line]) => {
        if (cancelled) return;
        const connection = connections[0];
        const baileysConnected = connection?.status === 'connected';
        // Disponible si tiene línea de coexistencia O el puente Baileys conectado.
        setAdvisorWhatsappAvailable(!!line || baileysConnected);
        setAdvisorWhatsappStatus(line ? 'connected' : (connection?.status ?? 'disconnected'));
        setAdvisorWhatsappPhone(line ? line.number : (baileysConnected ? connection?.phone ?? null : null));
      })
      .catch((err) => {
        console.warn('[ChatWindow] No se pudo revisar WhatsApp del asesor:', err);
        if (!cancelled) {
          setAdvisorWhatsappAvailable(false);
          setAdvisorWhatsappPhone(null);
          setAdvisorWhatsappStatus('error');
        }
      });
    };

    refreshAdvisorWhatsapp();
    const timer = window.setInterval(refreshAdvisorWhatsapp, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [companyId, user?.uid]);

  const advisorWhatsappNotice = (() => {
    if (advisorWhatsappAvailable) return null;
    if (advisorWhatsappStatus === 'stale') return 'Tu WhatsApp personal perdio conexion. Puedes seguir respondiendo por Ventas 317 o reconectarlo en Configuracion.';
    if (advisorWhatsappStatus === 'qr_pending') return 'Tu WhatsApp personal tiene un QR pendiente por escanear. Mientras tanto se enviara por Ventas 317.';
    if (advisorWhatsappStatus === 'configuration_required') return 'El puente de WhatsApp personal aun no esta configurado en el servidor.';
    if (advisorWhatsappStatus === 'error') return 'No se pudo validar tu WhatsApp personal. Puedes responder por Ventas 317 y revisar Configuracion.';
    return 'Tu WhatsApp personal no esta conectado. Puedes responder por Ventas 317 o conectarlo en Configuracion.';
  })();

  const handleSend = async (
    content: string,
    media?: MediaUploadResult,
    deliveryChannel: 'company_whatsapp' | 'advisor_whatsapp' = 'company_whatsapp'
  ) => {
    await sendManualMessage(
      companyId,
      lead.id,
      content,
      deliveryChannel,
      media?.downloadUrl,
      media?.contentType,
      media?.fileName
    );
  };

  const handlePauseAi  = async () => pauseAi(companyId, lead.id);
  const handleResumeAi = async () => resumeAi(companyId, lead.id);

  const handleReact = async (message: Message, emoji: string) => {
    try {
      await reactToMessage(companyId, lead.id, message.id, emoji);
    } catch (err) {
      console.error('[ChatWindow] No se pudo reaccionar:', err);
      alert('No se pudo enviar la reacción. Intenta de nuevo.');
    }
  };

  if (isAssignedToOther) {
    const isTimeout = (lead.advisorReassignmentCount ?? 0) > 0 || !!lead.lastAutoReassignedAt;
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center p-8 bg-zinc-900 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-500 text-3xl">
          ⏱️
        </div>
        <h3 className="text-lg font-bold text-zinc-100 mb-2">
          {isTimeout ? 'Prospecto reasignado por tiempo' : 'Prospecto no disponible'}
        </h3>
        <p className="text-sm text-zinc-400 max-w-md leading-relaxed mb-6">
          {isTimeout
            ? 'Este dato fue reasignado automáticamente porque no se realizó el primer contacto dentro de los 5 minutos reglamentarios. Por privacidad comercial entre asesores, la conversación ya no se encuentra accesible.'
            : 'Este prospecto ya no está asignado a tu cuenta. Solo puedes acceder a las conversaciones de tus propios leads.'}
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition shadow"
          >
            ← Volver a mi bandeja
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-900">
      {/* Header con indicador 24h */}
      <ConversationHeader
        lead={lead}
        onBack={onBack}
        onPauseAi={handlePauseAi}
        onResumeAi={handleResumeAi}
        onOpenTemplates={() => setShowTemplates(true)}
        onOpenLeadDetails={onOpenLeadDetails}
        onOpenFicha={() => setShowFichaModal(true)}
        onRequestReassign={!isAdmin && !readOnly ? () => setShowReassignModal(true) : undefined}
        readOnly={readOnly}
      />

      {/* Messages area */}
      <div ref={scrollRef} className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
        {loading && (
          <div className="flex justify-center p-6"><Spinner /></div>
        )}

        {/* Solo al tope del hilo: aparece cuando el asesor sube hasta arriba, para
            no gastar lecturas con un botón siempre visible que se toca sin querer. */}
        {!loading && hasMore && (
          <div className="flex justify-center pb-1">
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="
                rounded-full border border-zinc-700 bg-zinc-800/80 px-4 py-1.5 text-xs
                font-medium text-zinc-300 transition-colors hover:bg-zinc-700
                disabled:cursor-not-allowed disabled:opacity-60
              "
            >
              {loadingMore ? 'Cargando…' : 'Cargar 50 mensajes anteriores'}
            </button>
          </div>
        )}

        {hiddenCount > 0 && (
          <div className="my-4 mx-auto max-w-md p-3.5 bg-zinc-900/90 border border-zinc-800 rounded-2xl text-center shadow-lg">
            <div className="flex items-center justify-center gap-1.5 text-amber-400 font-medium text-xs mb-1">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Gestión previa protegida por confidencialidad</span>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed mb-2.5">
              {hiddenCount} mensaje(s) de gestiones anteriores están reservados por política de privacidad. 
              Revisa la <strong>Ficha Técnica</strong> y el <strong>Resumen IA</strong> para conocer todos los antecedentes y acuerdos del cliente.
            </p>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowFichaModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span>Ver Ficha Técnica</span>
              </button>
            </div>
          </div>
        )}

        {!loading && visibleMessages.length === 0 && (
          <EmptyState
            icon="💬"
            title="Sin mensajes aún"
            subtitle="Los mensajes de esta conversación aparecerán aquí"
          />
        )}

        {visibleMessages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            advisorName={msg.advisorId ? advisorNames?.get(msg.advisorId) : undefined}
            companyLineLabel={inboxLabel(lead.inboxId)}
            companyLinePhone={lead.inboxId}
            advisorWhatsappPhone={advisorWhatsappPhone}
            onReact={readOnly ? undefined : handleReact}
          />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Compositor o aviso de ventana cerrada (Messenger/Instagram: siempre abierto, no hay plantillas) */}
      {readOnly ? (
        <div className="flex shrink-0 items-center justify-center gap-2 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] text-xs text-zinc-600 dark:text-zinc-400">
          <Eye size={14} className="shrink-0" />
          <span>Modo solo lectura: puedes ver la conversación, pero no enviar mensajes.</span>
        </div>
      ) : canUseComposer ? (
        <>
          {companyLineBlocked && advisorWhatsappAvailable && (
            <div className="flex shrink-0 items-start justify-between gap-3 border-t border-amber-500/30 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-500/30 px-4 py-2 text-xs text-zinc-900 dark:text-zinc-100">
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <p>
                  <strong className="text-zinc-950 dark:text-white">Ventana de 24h cerrada</strong> para {inboxLabel(lead.inboxId)}. Puedes responder desde Mi WhatsApp o enviar una plantilla por la línea oficial.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowTemplates(true)}
                className="shrink-0 font-bold text-[#B7871C] hover:text-[#947018] dark:text-amber-300 dark:hover:text-amber-200 underline underline-offset-2"
              >
                Usar plantilla
              </button>
            </div>
          )}
          {isWhatsapp && advisorWhatsappNotice && leadHasPhone && (
            <div className="flex shrink-0 items-start gap-2 border-t border-amber-500/30 bg-amber-50/90 dark:bg-amber-950/40 dark:border-amber-500/30 px-4 py-2 text-xs text-zinc-900 dark:text-zinc-100">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>{advisorWhatsappNotice}</p>
            </div>
          )}
          {isWhatsapp && advisorWhatsappAvailable && !leadHasPhone && (
            <div className="flex shrink-0 items-start gap-2 border-t border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs text-sky-200">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <p>
                Este lead entró por <strong>usuario de WhatsApp</strong> (sin número visible). Solo se puede
                responder por <strong>{inboxLabel(lead.inboxId)}</strong> — el WhatsApp personal no puede escribirle.
              </p>
            </div>
          )}
          <MessageComposer
            leadId={lead.id}
            companyId={companyId}
            onSend={handleSend}
            companyLineLabel={inboxLabel(lead.inboxId)}
            advisorWhatsappAvailable={advisorAvailableForLead}
            defaultDeliveryChannel={defaultDeliveryChannel}
            companyLineDisabled={companyLineBlocked}
            companyLineDisabledReason="La linea oficial solo puede enviar plantillas fuera de la ventana de 24h"
          />
        </>
      ) : (
        /* Ventana cerrada — solo se pueden enviar plantillas */
        <div className="flex shrink-0 flex-col items-center gap-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-xs">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="font-bold">Ventana de 24h cerrada</span>
          </div>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 text-center max-w-xs">
            Han pasado más de 24h desde el último mensaje del lead.
            Solo puedes enviar plantillas pre-aprobadas por Meta.
          </p>
          <button
            onClick={() => setShowTemplates(true)}
            className="
              flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
              bg-[#B7871C] hover:bg-[#947018] text-white transition-colors shadow-md cursor-pointer
            "
          >
            📋 Enviar plantilla oficial de WhatsApp
          </button>
        </div>
      )}

      {/* Modal de plantillas */}
      {showTemplates && (
        <TemplatePickerModal
          companyId={companyId}
          leadId={lead.id}
          inboxId={lead.inboxId}
          onClose={() => setShowTemplates(false)}
          onSent={() => setShowTemplates(false)}
        />
      )}

      {/* Modal de Ficha Técnica desde la Bandeja */}
      {showFichaModal && (
        <FichaTecnicaModal
          isOpen={showFichaModal}
          onClose={() => setShowFichaModal(false)}
          companyId={companyId}
          lead={{
            id: lead.id,
            name: lead.name,
            phone: lead.phone,
            project: lead.projectInterest?.[0] || lead.metadata?.project,
            advisorName: lead.assignedTo ? advisorNames?.get(lead.assignedTo) : undefined,
            bitacoras: (lead as any).bitacoras,
            metadata: lead.metadata,
          }}
        />
      )}

      {showReassignModal && (
        <RequestLeadTransferModal
          isOpen={showReassignModal}
          onClose={() => setShowReassignModal(false)}
          companyId={companyId}
          leadId={lead.id}
          leadName={lead.name}
          leadPhone={lead.phone}
          currentAdvisorId={lead.assignedTo}
          currentAdvisorName={advisorNames?.get(lead.assignedTo || '') || (lead.assignedTo === user?.uid ? 'Asignado a ti' : 'Sin asignar')}
          currentUserId={user?.uid}
        />
      )}
    </div>
  );
}
