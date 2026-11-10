import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Send,
  Sparkles,
  Bot,
  User,
  Loader2,
  Trash2,
  HelpCircle,
  TrendingUp,
  PhoneOff,
  MapPin,
  FileSpreadsheet,
  MessageSquareWarning,
} from 'lucide-react';
import {
  sendQueryToCommercialAssistant,
  AssistantChatMessage,
} from '../services/commercialAssistant.service';
import { CommercialAssistantMessage } from './CommercialAssistantMessage';

interface CommercialAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  companyId: string;
  periodLabel?: string;
  startDate?: number;
  endDate?: number;
}

const QUICK_PROMPTS = [
  {
    icon: MessageSquareWarning,
    label: 'Chats sin respuesta vs Fichas sin marcar',
    prompt: 'Audita las conversaciones de chat en todo el sistema: ¿Qué prospectos de Meta Ads nunca contestaron en WhatsApp y qué asesores tienen esas fichas sin marcar?',
  },
  {
    icon: PhoneOff,
    label: 'Leads de pauta que no contestaron (Global)',
    prompt: '¿Cuáles pautas o campañas de Meta Ads trajeron prospectos que quedaron como "no contesta" y qué asesor los tiene asignados en todo el sistema?',
  },
  {
    icon: MapPin,
    label: 'Visitas a proyectos / sala de ventas',
    prompt: '¿Cuántas visitas a sala de ventas o proyectos se registraron en las bitácoras, qué asesores las atendieron y qué resultados tuvieron?',
  },
  {
    icon: TrendingUp,
    label: 'Avance frente a metas (100 capt / 3 ventas)',
    prompt: 'Hazme un diagnóstico rápido de los 11 asesores: ¿Quiénes cumplieron las metas oficiales (100 captaciones y 3 ventas) y quiénes están en estado crítico?',
  },
  {
    icon: FileSpreadsheet,
    label: 'Motivos de desistimiento',
    prompt: '¿Cuáles son los principales motivos de desistimiento registrados en el sistema y qué asesor tuvo más cancelaciones?',
  },
];

export const CommercialAssistantDrawer: React.FC<CommercialAssistantDrawerProps> = ({
  isOpen,
  onClose,
  companyId,
  periodLabel,
  startDate,
  endDate,
}) => {
  const [messages, setMessages] = useState<AssistantChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `### 🤖 Copiloto de Inteligencia Comercial Meraki\nHola. Soy tu asistente ejecutivo impulsado por **GPT-4o**. Estoy conectado en tiempo real a las bases de datos de Firestore y SmartHome para auditar:\n\n* **📢 Pautas y Anuncios**: Rendimiento de Meta Ads, ganchos persuasivos y atribución.\n* **📞 Auditoría de Chats y Fichas**: Prospectos que nunca contestaron vs fichas sin marcar por los asesores.\n* **📍 Visitas a Proyectos**: Bitácoras en sala de ventas y proyectos como Río Claro o Casa Club.\n* **🎯 Cumplimiento de Metas**: Ranking de los 11 asesores frente a 100 captaciones y 3 ventas.\n\nElige una de las auditorías rápidas arriba o escribe tu consulta comercial.`,
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  if (!isOpen) return null;

  const handleSend = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || loading) return;

    const userMsg: AssistantChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      // Filtrar historial para enviar al backend (solo roles user y assistant)
      const payloadMessages = newHistory.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const reply = await sendQueryToCommercialAssistant({
        companyId,
        messages: payloadMessages,
        periodContext: {
          periodLabel,
          startDate,
          endDate,
        },
      });

      const assistantMsg: AssistantChatMessage = {
        id: `ai_${Date.now()}`,
        role: 'assistant',
        content: reply,
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      const errMsg: AssistantChatMessage = {
        id: `err_${Date.now()}`,
        role: 'assistant',
        content: `⚠️ Ocurrió un error al procesar tu consulta con GPT-4o: ${err?.message || 'Error de conexión.'}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = () => {
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        role: 'assistant',
        content: `Historial reiniciado. Pregúntame sobre cualquier métrica de asesores, pauta, llamadas, visitas o ventas en Meraki.`,
        timestamp: Date.now(),
      },
    ]);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-3xl lg:max-w-4xl bg-zinc-950 border-l border-zinc-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-300">
        {/* ENCABEZADO */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Bot size={22} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-100">Copiloto de Inteligencia Comercial</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  GPT-4o
                </span>
              </div>
              <p className="text-[11px] text-zinc-400">
                Auditoría en vivo de pauta, bitácoras, llamadas y asesores en Firestore
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleClearHistory}
              title="Limpiar conversación"
              className="p-2 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Cerrar panel"
              className="p-2 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* PILLS DE PREGUNTAS RÁPIDAS */}
        <div className="p-3 bg-zinc-900/40 border-b border-zinc-800/80 overflow-x-auto flex gap-2 no-scrollbar">
          {QUICK_PROMPTS.map((qp, idx) => {
            const Icon = qp.icon;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => handleSend(qp.prompt)}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium bg-zinc-800/80 hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300 border border-zinc-700/60 hover:border-amber-500/40 whitespace-nowrap transition-all disabled:opacity-50"
              >
                <Icon size={12} className="text-amber-400" />
                <span>{qp.label}</span>
              </button>
            );
          })}
        </div>

        {/* HISTORIAL DE MENSAJES */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((m) => {
            const isUser = m.role === 'user';
            return (
              <div
                key={m.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 mt-0.5">
                    <Sparkles size={16} />
                  </div>
                )}

                <div className={`max-w-[92%] sm:max-w-[88%] ${isUser ? 'ml-auto' : ''}`}>
                  <CommercialAssistantMessage
                    content={m.content}
                    isUser={isUser}
                    timestamp={m.timestamp}
                  />
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 flex-shrink-0 mt-0.5">
                    <User size={16} />
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="flex gap-3 justify-start items-center">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 flex-shrink-0 animate-pulse">
                <Bot size={16} />
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3.5 text-xs text-amber-400 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin text-amber-400" />
                <span>Consultando datos en Firestore y analizando con GPT-4o...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* INPUT DE ENVÍO */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-900/90">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pregunta sobre leads de pauta, llamadas, visitas, desistimientos..."
              disabled={loading}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="p-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-xl transition-all font-bold shadow-lg shadow-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              title="Enviar consulta"
            >
              <Send size={16} />
            </button>
          </form>

          <p className="text-[10px] text-zinc-500 mt-2 flex items-center justify-between">
            <span>Metas oficiales: 100 captaciones/mes y 3 ventas/mes por asesor.</span>
            <span className="flex items-center gap-1">
              <HelpCircle size={10} /> Consultas en tiempo real
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};
