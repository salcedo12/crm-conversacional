import { useEffect, useRef, useState } from 'react';
import { Spinner }              from '@/shared/components/Spinner';
import { EmptyState }           from '@/shared/components/EmptyState';
import { MessageBubble }        from './MessageBubble';
import { ConversationHeader }   from './ConversationHeader';
import { MessageComposer }      from './MessageComposer';
import { TemplatePickerModal }  from './TemplatePickerModal';
import { isWindowOpen }         from '../utils/conversationWindow';
import type { Lead }            from '../types';
import type { MediaUploadResult } from '../services/media.service';
import { useMessages }          from '../hooks/useMessages';
import { sendManualMessage, pauseAi, resumeAi } from '../services/messages.service';

interface ChatWindowProps {
  lead:      Lead;
  companyId: string;
  onBack?:   () => void;
}

export function ChatWindow({ lead, companyId, onBack }: ChatWindowProps) {
  const { messages, loading } = useMessages(companyId, lead.id);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const windowTs   = lead.lastInboundAt ?? lead.lastMessageAt ?? null;
  const windowOpen = isWindowOpen(windowTs);

  const handleSend = async (content: string, media?: MediaUploadResult) => {
    await sendManualMessage(companyId, lead.id, content, media?.downloadUrl, media?.contentType);
  };

  const handlePauseAi  = async () => pauseAi(companyId, lead.id);
  const handleResumeAi = async () => resumeAi(companyId, lead.id);

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Header con indicador 24h */}
      <ConversationHeader
        lead={lead}
        onBack={onBack}
        onPauseAi={handlePauseAi}
        onResumeAi={handleResumeAi}
        onOpenTemplates={() => setShowTemplates(true)}
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {loading && (
          <div className="flex justify-center p-6"><Spinner /></div>
        )}

        {!loading && messages.length === 0 && (
          <EmptyState
            icon="💬"
            title="Sin mensajes aún"
            subtitle="Los mensajes de esta conversación aparecerán aquí"
          />
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Compositor o aviso de ventana cerrada */}
      {windowOpen || !lead.lastInboundAt ? (
        <MessageComposer
          leadId={lead.id}
          companyId={companyId}
          onSend={handleSend}
        />
      ) : (
        /* Ventana cerrada — solo se pueden enviar plantillas */
        <div className="px-4 py-4 border-t border-zinc-800 bg-zinc-950 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="font-medium">Ventana de 24h cerrada</span>
          </div>
          <p className="text-xs text-zinc-500 text-center max-w-xs">
            Han pasado más de 24h desde el último mensaje del lead.
            Solo puedes enviar plantillas pre-aprobadas por Meta.
          </p>
          <button
            onClick={() => setShowTemplates(true)}
            className="
              flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
              bg-violet-600 hover:bg-violet-500 text-white transition-colors shadow
            "
          >
            📋 Enviar plantilla de WhatsApp
          </button>
        </div>
      )}

      {/* Modal de plantillas */}
      {showTemplates && (
        <TemplatePickerModal
          companyId={companyId}
          leadId={lead.id}
          onClose={() => setShowTemplates(false)}
          onSent={() => setShowTemplates(false)}
        />
      )}
    </div>
  );
}
